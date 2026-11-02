// Copias cifradas (.rmc) de Reminiscencia: todo el contenido de los perfiles en un único
// fichero JSON cifrado con AES-GCM (ver crypto.js). Aquí se decide qué entra en la copia,
// cómo se codifican las fotografías (base64 dentro del contenido cifrado) y qué se acepta al importar.
// Nunca se incluyen el hash del PIN ni los ajustes del dispositivo.
// Nada se escribe en el almacenamiento hasta que la copia se ha descifrado y validado.

import {
  assertPassphrase,
  base64ToBytes,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  bytesToBase64,
  decryptJson,
  encryptJson,
} from './crypto.js';
import {
  BACKUP_PAYLOAD_VERSION,
  isPlainObject,
  PHOTO_MAX_BYTES,
  validateBackup,
} from './schema.js';

export const DEFAULT_MAX_BYTES = 300 * 1024 * 1024;

const NOT_A_BACKUP = 'El archivo no es una copia de Reminiscencia.';
const CONTENT_LISTS = ['profiles', 'songLinks', 'memories', 'photos', 'playlists', 'observations', 'history'];

function checkMaxBytes(maxBytes) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('El límite de tamaño de la copia no es válido.');
  }
}

function limitError(maxBytes) {
  const megabytes = maxBytes / (1024 * 1024);
  const label = megabytes >= 1
    ? `${Math.round(megabytes)} MB`
    : `${Math.max(1, Math.round(maxBytes / 1024))} KB`;
  return new Error(`La copia supera el límite de ${label}.`);
}

// Construye la copia cifrada. Devuelve un Blob con el sobre en JSON.
export async function buildBackup(store, passphrase, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  checkMaxBytes(maxBytes);
  assertPassphrase(passphrase);
  const data = await store.exportAll();
  // Antes de codificar nada se estima el tamaño: base64 ocupa 4/3 del binario.
  const binaryBytes = data.photos.reduce((total, photo) => total + photo.blob.size, 0);
  if (Math.ceil(binaryBytes / 3) * 4 > maxBytes) throw limitError(maxBytes);

  const photos = [];
  for (const photo of data.photos) {
    photos.push({
      id: photo.id,
      profileId: photo.profileId,
      mime: photo.mime,
      caption: photo.caption,
      createdAt: photo.createdAt,
      data: bytesToBase64(new Uint8Array(await photo.blob.arrayBuffer())),
    });
  }
  const payload = {
    payloadVersion: BACKUP_PAYLOAD_VERSION,
    exportedAt: Date.now(),
    profiles: data.profiles,
    songLinks: data.songLinks,
    memories: data.memories,
    photos,
    playlists: data.playlists,
    observations: data.observations,
    history: data.history,
  };
  const envelope = await encryptJson(payload, passphrase);
  const file = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
  if (file.size > maxBytes) throw limitError(maxBytes);
  return file;
}

function decodePhoto(photo) {
  let bytes;
  try {
    bytes = base64ToBytes(photo.data);
  } catch {
    throw new Error('La copia está dañada: una fotografía no se puede leer.');
  }
  if (bytes.length > PHOTO_MAX_BYTES) throw new Error('La copia está dañada: una fotografía supera el tamaño máximo.');
  return {
    id: photo.id,
    profileId: photo.profileId,
    mime: photo.mime,
    caption: photo.caption,
    createdAt: photo.createdAt,
    blob: new Blob([bytes], { type: photo.mime }),
  };
}

// Lee, descifra y valida una copia sin escribir nada. Devuelve el contenido listo para importar.
export async function readBackup(file, passphrase, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  checkMaxBytes(maxBytes);
  if (!(file instanceof Blob)) throw new Error('Selecciona un archivo de copia.');
  if (file.size > maxBytes) throw limitError(maxBytes);

  let envelope;
  try {
    envelope = JSON.parse(await file.text());
  } catch {
    throw new Error(NOT_A_BACKUP);
  }
  if (!isPlainObject(envelope) || envelope.format !== BACKUP_FORMAT) throw new Error(NOT_A_BACKUP);
  if (envelope.version !== BACKUP_VERSION) throw new Error('Esta copia es de una versión que no se puede abrir.');

  const payload = await decryptJson(envelope, passphrase);
  const problems = validateBackup(payload);
  if (problems.length > 0) throw new Error(`La copia está dañada o es incompatible: ${problems[0]}`);

  const content = {};
  for (const name of CONTENT_LISTS) {
    content[name] = name === 'photos' ? payload.photos.map(decodePhoto) : payload[name];
  }
  return content;
}

// Cuenta lo que contiene una copia (vista previa antes de importar). No escribe nada.
export async function previewBackup(file, passphrase, options) {
  const content = await readBackup(file, passphrase, options);
  return Object.fromEntries(CONTENT_LISTS.map((name) => [name, content[name].length]));
}

// Importa una copia en el almacén. mode: 'merge' (combinar, por defecto) o 'replace' (sustituir).
export async function restoreBackup(store, file, passphrase, { mode = 'merge', maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (mode !== 'merge' && mode !== 'replace') throw new Error('Modo de importación no válido.');
  const content = await readBackup(file, passphrase, { maxBytes });
  return store.importAll(content, { mode });
}
