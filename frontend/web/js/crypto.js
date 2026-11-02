// Primitivas criptográficas de Reminiscencia sobre WebCrypto (sin dependencias).
// - PIN: PBKDF2-SHA-256 con sal aleatoria de 16 bytes. El PIN nunca se guarda en claro.
// - Copias: clave AES-GCM de 256 bits derivada de la contraseña con PBKDF2-SHA-256.
//   La sal, el IV y las iteraciones viajan en el sobre; la cabecera se autentica como
//   datos adicionales (AAD), de modo que alterarla hace fallar el descifrado.
// Los errores de descifrado no revelan si falló la contraseña o si el contenido está dañado.

export const BACKUP_FORMAT = 'reminiscencia-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_ITERATIONS = 600000;
export const PIN_ITERATIONS = 310000;
export const MIN_PASSPHRASE_LENGTH = 10;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;
const TAG_BITS = 128;
const MIN_ITERATIONS = 100000;
const MAX_ITERATIONS = 2000000;
const DECRYPT_ERROR = 'Contraseña incorrecta o copia dañada';

const subtle = () => globalThis.crypto.subtle;

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

// Identificador aleatorio de 128 bits en hexadecimal (32 caracteres).
export function randomId() {
  return Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(text) {
  if (typeof text !== 'string') throw new Error('Datos en base64 no válidos.');
  let binary;
  try {
    binary = atob(text);
  } catch {
    throw new Error('Datos en base64 no válidos.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Comparación en tiempo constante: no se corta al primer byte distinto.
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

// Lanza un Error en español si la contraseña de la copia es demasiado corta.
export function assertPassphrase(passphrase) {
  const length = typeof passphrase === 'string' ? Array.from(passphrase.normalize('NFC')).length : 0;
  if (length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`La contraseña de la copia debe tener al menos ${MIN_PASSPHRASE_LENGTH} caracteres.`);
  }
}

async function importPassphrase(passphrase) {
  if (typeof passphrase !== 'string') throw new TypeError('La contraseña debe ser texto.');
  // NFC: la misma contraseña escrita con acentos compuestos o descompuestos produce la misma clave.
  const bytes = new TextEncoder().encode(passphrase.normalize('NFC'));
  return subtle().importKey('raw', bytes, 'PBKDF2', false, ['deriveKey', 'deriveBits']);
}

// Deriva la clave AES-GCM de 256 bits a partir de la contraseña, la sal y las iteraciones.
export async function deriveKey(passphrase, saltBytes, iterations) {
  const material = await importPassphrase(passphrase);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function deriveBits(passphrase, saltBytes, iterations, lengthBits) {
  const material = await importPassphrase(passphrase);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    material,
    lengthBits,
  );
  return new Uint8Array(bits);
}

// Datos adicionales autenticados: toda la cabecera del sobre, en un orden fijo.
function headerAad(envelope) {
  const { format, version, kdf, cipher } = envelope;
  const header = [format, version, kdf.name, kdf.hash, kdf.iterations, kdf.salt, cipher.name, cipher.iv];
  return new TextEncoder().encode(header.join('|'));
}

// Cifra cualquier valor serializable en JSON y devuelve el sobre (objeto plano).
export async function encryptJson(value, passphrase) {
  assertPassphrase(passphrase);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const envelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: BACKUP_ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
  };
  const key = await deriveKey(passphrase, salt, BACKUP_ITERATIONS);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const sealed = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: headerAad(envelope), tagLength: TAG_BITS },
    key,
    plain,
  );
  return { ...envelope, data: bytesToBase64(new Uint8Array(sealed)) };
}

// Descifra un sobre. Cualquier fallo (contraseña, alteración, formato) lanza el mismo error.
export async function decryptJson(envelope, passphrase) {
  try {
    return await openEnvelope(envelope, passphrase);
  } catch {
    throw new Error(DECRYPT_ERROR);
  }
}

async function openEnvelope(envelope, passphrase) {
  if (!envelope || envelope.format !== BACKUP_FORMAT || envelope.version !== BACKUP_VERSION) {
    throw new Error('Formato no reconocido.');
  }
  const { kdf, cipher } = envelope;
  if (kdf?.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || cipher?.name !== 'AES-GCM') {
    throw new Error('Algoritmo no reconocido.');
  }
  if (!Number.isSafeInteger(kdf.iterations) || kdf.iterations < MIN_ITERATIONS || kdf.iterations > MAX_ITERATIONS) {
    throw new Error('Iteraciones fuera de rango.');
  }
  const salt = base64ToBytes(kdf.salt);
  const iv = base64ToBytes(cipher.iv);
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new Error('Tamaño de sal o IV no válido.');
  const key = await deriveKey(passphrase, salt, kdf.iterations);
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv, additionalData: headerAad(envelope), tagLength: TAG_BITS },
    key,
    base64ToBytes(envelope.data),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

// Hash de PIN. Con sal omitida genera una sal aleatoria nueva (cada llamada da un hash distinto).
export async function hashPin(pin, saltB64 = bytesToBase64(randomBytes(SALT_BYTES))) {
  if (typeof pin !== 'string') throw new TypeError('El PIN debe ser texto.');
  const hash = await deriveBits(pin, base64ToBytes(saltB64), PIN_ITERATIONS, KEY_BITS);
  return {
    algo: 'PBKDF2-SHA-256',
    iterations: PIN_ITERATIONS,
    salt: saltB64,
    hash: bytesToBase64(hash),
  };
}

// Comprueba un PIN contra un registro de hashPin. Cualquier registro incompleto es un «no».
export async function verifyPin(pin, record) {
  try {
    if (typeof pin !== 'string' || !record || record.algo !== 'PBKDF2-SHA-256') return false;
    if (!Number.isSafeInteger(record.iterations)
      || record.iterations < MIN_ITERATIONS || record.iterations > MAX_ITERATIONS) return false;
    const expected = base64ToBytes(record.hash);
    const salt = base64ToBytes(record.salt);
    // Un hash vacío o una sal vacía nunca debe validar: se exige el tamaño exacto.
    if (expected.length !== KEY_BITS / 8 || salt.length !== SALT_BYTES) return false;
    const actual = await deriveBits(pin, salt, record.iterations, KEY_BITS);
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}
