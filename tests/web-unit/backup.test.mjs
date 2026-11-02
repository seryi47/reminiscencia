// Pruebas de backup.js: ida y vuelta de la copia cifrada, combinación, límites, validación y compatibilidad
// con copias de la versión 1 (sin registro del estudio). Sin IndexedDB: el almacén de pruebas implementa
// exportAll/importAll en memoria y usa planMerge real. Datos ficticios; las fotografías se generan en memoria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ToBytes,
  bytesToBase64,
  decryptJson,
  encryptJson,
} from '../../frontend/web/js/crypto.js';
import {
  buildBackup,
  DEFAULT_MAX_BYTES,
  previewBackup,
  readBackup,
  restoreBackup,
} from '../../frontend/web/js/backup.js';
import { planMerge } from '../../frontend/web/js/store.js';

const PASSPHRASE = 'frase de prueba 2026';
const OTHER_PASSPHRASE = 'otra frase distinta';
const T0 = 1700000000000;
const COLLECTIONS = ['profiles', 'songLinks', 'memories', 'photos', 'playlists', 'observations', 'history', 'studyEvents'];
const SONG = 'S0123456789abcdef';
const DECRYPT_FAILURE = { name: 'Error', message: 'Contraseña incorrecta o copia dañada' };

const PROFILE = {
  id: 'perfil-prueba-01',
  alias: 'Persona de prueba',
  code: 'CP-001',
  options: { volumeLimit: 80, repeatList: false, resumeOnOpen: true, seekOnTap: false },
  createdAt: T0,
  updatedAt: T0,
};

// Imagen PNG de prueba generada en código: firma PNG más un patrón determinista. No es una fotografía real.
function generatedPhoto(size = 4096) {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  for (let i = 8; i < size; i += 1) bytes[i] = (i * 31 + 7) % 256;
  return new Blob([bytes], { type: 'image/png' });
}

function sampleContent() {
  return {
    profiles: [PROFILE],
    songLinks: [{ profileId: PROFILE.id, songId: SONG, familiarity: 4, preference: 2, notes: 'Nota de prueba', updatedAt: T0 }],
    memories: [{
      id: 'recuerdo-prueba-01',
      profileId: PROFILE.id,
      title: 'Recuerdo de prueba',
      text: 'Texto ficticio\ncon dos líneas.',
      year: null,
      people: ['Persona de prueba'],
      songIds: [SONG],
      photoIds: ['foto-prueba-01'],
      createdAt: T0,
      updatedAt: T0 + 500,
    }],
    photos: [{
      id: 'foto-prueba-01',
      profileId: PROFILE.id,
      mime: 'image/png',
      caption: 'Imagen generada en código',
      createdAt: T0,
      blob: generatedPhoto(),
    }],
    playlists: [{ id: 'lista-prueba-01', profileId: PROFILE.id, name: 'Lista de prueba', songIds: [SONG], createdAt: T0, updatedAt: T0 }],
    observations: [{ id: 'obs-prueba-01', profileId: PROFILE.id, at: T0, text: 'Observación ficticia', songId: SONG }],
    history: [{ id: 'hist-prueba-01', profileId: PROFILE.id, songId: SONG, at: T0, listenedS: 42, completed: false }],
    studyEvents: [
      {
        id: 'evento-prueba-01',
        participantCode: 'CP-001',
        type: 'track-end',
        at: '2026-11-02T18:30:00+01:00',
        sessionId: 'sesion-prueba-01',
        profileId: PROFILE.id,
        songId: SONG,
        presentation: 'C1',
        condition: 'segun-cancion',
        origin: 'lista',
        seconds: 120,
        completed: true,
        trackSeconds: 240,
      },
      {
        id: 'evento-prueba-02',
        participantCode: 'CP-001',
        type: 'session-start',
        at: '2026-11-02T18:00:00+01:00',
        sessionId: 'sesion-prueba-01',
        profileId: PROFILE.id,
        songId: null,
        presentation: null,
        condition: 'segun-cancion',
        origin: null,
        seconds: null,
        completed: null,
        trackSeconds: null,
      },
    ],
  };
}

const emptyContent = () => Object.fromEntries(COLLECTIONS.map((name) => [name, []]));
const KEYS = { songLinks: (record) => `${record.profileId}/${record.songId}` };
const keyOf = (name) => KEYS[name] ?? ((record) => record.id);

// Almacén de pruebas: misma interfaz de contenido que store.js (exportAll / importAll).
class MemoryStore {
  constructor() {
    this.data = emptyContent();
  }

  async exportAll() {
    return Object.fromEntries(COLLECTIONS.map((name) => [name, [...this.data[name]]]));
  }

  async importAll(content, { mode = 'merge' } = {}) {
    const written = {};
    const skipped = {};
    for (const name of COLLECTIONS) {
      const incoming = content[name];
      const existing = mode === 'replace' ? [] : this.data[name];
      const toWrite = planMerge(existing, incoming, keyOf(name));
      const keys = new Set(toWrite.map(keyOf(name)));
      this.data[name] = [...existing.filter((record) => !keys.has(keyOf(name)(record))), ...toWrite];
      written[name] = toWrite.length;
      skipped[name] = incoming.length - toWrite.length;
    }
    return { mode, written, skipped };
  }
}

async function filledStore(content = sampleContent()) {
  const store = new MemoryStore();
  await store.importAll(content, { mode: 'replace' });
  return store;
}

async function assertSameContent(actual, expected) {
  for (const name of COLLECTIONS.filter((n) => n !== 'photos')) {
    assert.deepEqual(actual[name], expected[name], `Diferencia en ${name}`);
  }
  assert.equal(actual.photos.length, expected.photos.length);
  for (const [index, photo] of expected.photos.entries()) {
    const copy = actual.photos[index];
    assert.equal(copy.id, photo.id);
    assert.equal(copy.profileId, photo.profileId);
    assert.equal(copy.mime, photo.mime);
    assert.equal(copy.caption, photo.caption);
    assert.equal(copy.createdAt, photo.createdAt);
    assert.equal(copy.blob.type, photo.blob.type);
    assert.deepEqual(
      new Uint8Array(await copy.blob.arrayBuffer()),
      new Uint8Array(await photo.blob.arrayBuffer()),
    );
  }
}

test('ida y vuelta: la copia restaurada es idéntica al original, incluidas la fotografía y los eventos del estudio', async () => {
  const source = await filledStore();
  const file = await buildBackup(source, PASSPHRASE);
  const target = new MemoryStore();
  const summary = await restoreBackup(target, file, PASSPHRASE, { mode: 'replace' });
  assert.deepEqual(summary.written, {
    profiles: 1, songLinks: 1, memories: 1, photos: 1, playlists: 1, observations: 1, history: 1, studyEvents: 2,
  });
  await assertSameContent(await target.exportAll(), await source.exportAll());
});

test('la copia no incluye el hash del PIN ni los ajustes del dispositivo, y no muestra texto en claro', async () => {
  const file = await buildBackup(await filledStore(), PASSPHRASE);
  const envelope = JSON.parse(await file.text());
  const payload = await decryptJson(envelope, PASSPHRASE);
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['exportedAt', 'history', 'memories', 'observations', 'payloadVersion', 'photos', 'playlists', 'profiles', 'songLinks', 'studyEvents'],
  );
  assert.equal(payload.payloadVersion, 2);
  assert.equal(JSON.stringify(envelope).includes('Persona de prueba'), false);
  assert.equal(JSON.stringify(envelope).includes('Recuerdo de prueba'), false);
});

test('los eventos del estudio se exportan sin clave local ni fecha derivada, pero con su identificador', async () => {
  const source = await filledStore();
  // Simula lo que devuelve el almacén real: clave local (seq) y fecha derivada (day).
  source.data.studyEvents = source.data.studyEvents.map((event, index) => ({
    ...event,
    seq: index + 1,
    day: event.at.slice(0, 10),
  }));
  const file = await buildBackup(source, PASSPHRASE);
  const payload = await decryptJson(JSON.parse(await file.text()), PASSPHRASE);
  assert.equal(payload.studyEvents.length, 2);
  for (const event of payload.studyEvents) {
    assert.equal('seq' in event, false);
    assert.equal('day' in event, false);
    assert.equal(typeof event.id, 'string');
  }
  assert.equal(payload.studyEvents[0].id, 'evento-prueba-01');
});

test('combinar conserva la versión local cuando es más reciente', async () => {
  const file = await buildBackup(await filledStore(), PASSPHRASE);
  const target = new MemoryStore();
  const localMemory = { ...sampleContent().memories[0], title: 'Título local', updatedAt: T0 + 9000 };
  await target.importAll({ ...emptyContent(), profiles: [PROFILE], memories: [localMemory] }, { mode: 'replace' });
  const summary = await restoreBackup(target, file, PASSPHRASE);
  assert.equal(summary.mode, 'merge');
  assert.equal(summary.skipped.memories, 1);
  const memories = (await target.exportAll()).memories;
  assert.equal(memories.length, 1);
  assert.equal(memories[0].title, 'Título local');
});

test('combinar sustituye la versión local más antigua por la de la copia', async () => {
  const file = await buildBackup(await filledStore(), PASSPHRASE);
  const target = new MemoryStore();
  const olderMemory = { ...sampleContent().memories[0], title: 'Título antiguo', updatedAt: T0 - 9000 };
  await target.importAll({ ...emptyContent(), profiles: [PROFILE], memories: [olderMemory] }, { mode: 'replace' });
  await restoreBackup(target, file, PASSPHRASE, { mode: 'merge' });
  assert.equal((await target.exportAll()).memories[0].title, 'Recuerdo de prueba');
});

test('sustituir elimina lo que había en el dispositivo', async () => {
  const file = await buildBackup(await filledStore(), PASSPHRASE);
  const target = await filledStore();
  const current = await target.exportAll();
  const extra = { id: 'recuerdo-local-extra', profileId: PROFILE.id, title: 'Solo local', text: '', year: null, people: [], songIds: [], photoIds: [], createdAt: T0, updatedAt: T0 };
  await target.importAll({ ...current, memories: [...current.memories, extra] }, { mode: 'merge' });
  assert.equal((await target.exportAll()).memories.length, 2);
  await restoreBackup(target, file, PASSPHRASE, { mode: 'replace' });
  const titles = (await target.exportAll()).memories.map((memory) => memory.title);
  assert.deepEqual(titles, ['Recuerdo de prueba']);
});

test('contraseña incorrecta: falla sin revelar la causa y no escribe nada', async () => {
  const file = await buildBackup(await filledStore(), PASSPHRASE);
  const target = new MemoryStore();
  await assert.rejects(restoreBackup(target, file, OTHER_PASSPHRASE, { mode: 'replace' }), DECRYPT_FAILURE);
  assert.equal((await target.exportAll()).profiles.length, 0);
});

test('una copia alterada no se importa', async () => {
  const file = await buildBackup(await filledStore(), PASSPHRASE);
  const envelope = JSON.parse(await file.text());
  const bytes = base64ToBytes(envelope.data);
  bytes[10] ^= 0xff;
  const tampered = new Blob([JSON.stringify({ ...envelope, data: bytesToBase64(bytes) })]);
  const target = new MemoryStore();
  await assert.rejects(restoreBackup(target, tampered, PASSPHRASE), DECRYPT_FAILURE);
  assert.equal((await target.exportAll()).memories.length, 0);
});

test('un archivo que no es una copia se rechaza con un mensaje claro', async () => {
  const message = 'El archivo no es una copia de Reminiscencia.';
  await assert.rejects(readBackup(new Blob(['hola']), PASSPHRASE), { message });
  await assert.rejects(readBackup(new Blob([JSON.stringify({ format: 'otra-cosa' })]), PASSPHRASE), { message });
  await assert.rejects(readBackup('no es un archivo', PASSPHRASE), { message: 'Selecciona un archivo de copia.' });
});

test('el límite de tamaño se aplica al crear la copia y al leerla', async () => {
  assert.equal(DEFAULT_MAX_BYTES, 300 * 1024 * 1024);
  const source = await filledStore();
  await assert.rejects(buildBackup(source, PASSPHRASE, { maxBytes: 1000 }), /supera el límite de/);
  const file = await buildBackup(source, PASSPHRASE);
  const target = new MemoryStore();
  await assert.rejects(restoreBackup(target, file, PASSPHRASE, { maxBytes: 100 }), /supera el límite de/);
  assert.equal((await target.exportAll()).profiles.length, 0);
});

test('una copia cifrada con contenido inválido no se importa', async () => {
  const badPayload = {
    payloadVersion: 1,
    exportedAt: T0,
    profiles: [PROFILE],
    songLinks: [],
    memories: [{ ...sampleContent().memories[0], year: 123 }],
    photos: [],
    playlists: [],
    observations: [],
    history: [],
  };
  const envelope = await encryptJson(badPayload, PASSPHRASE);
  const file = new Blob([JSON.stringify(envelope)]);
  const target = new MemoryStore();
  await assert.rejects(restoreBackup(target, file, PASSPHRASE), /La copia está dañada o es incompatible/);
  assert.equal((await target.exportAll()).profiles.length, 0);
});

test('una copia de la versión 1 (sin eventos del estudio) se importa y deja el registro vacío', async () => {
  const v1Payload = {
    payloadVersion: 1,
    exportedAt: T0,
    profiles: [PROFILE],
    songLinks: [],
    memories: [],
    photos: [],
    playlists: [],
    observations: [],
    history: [],
  };
  const file = new Blob([JSON.stringify(await encryptJson(v1Payload, PASSPHRASE))]);
  const target = new MemoryStore();
  const summary = await restoreBackup(target, file, PASSPHRASE, { mode: 'replace' });
  assert.equal(summary.written.profiles, 1);
  assert.equal(summary.written.studyEvents, 0);
  assert.equal((await target.exportAll()).profiles.length, 1);
  assert.deepEqual(await previewBackup(file, PASSPHRASE), {
    profiles: 1, songLinks: 0, memories: 0, photos: 0, playlists: 0, observations: 0, history: 0, studyEvents: 0,
  });
});

test('una copia de una versión de contenido desconocida se rechaza sin escribir nada', async () => {
  const futurePayload = {
    payloadVersion: 3,
    exportedAt: T0,
    profiles: [PROFILE],
    songLinks: [],
    memories: [],
    photos: [],
    playlists: [],
    observations: [],
    history: [],
    studyEvents: [],
  };
  const file = new Blob([JSON.stringify(await encryptJson(futurePayload, PASSPHRASE))]);
  const target = new MemoryStore();
  await assert.rejects(
    restoreBackup(target, file, PASSPHRASE),
    /La versión del contenido de la copia no es compatible/,
  );
  assert.equal((await target.exportAll()).profiles.length, 0);
});

test('la vista previa cuenta el contenido, incluidos los eventos del estudio, sin escribir nada', async () => {
  const file = await buildBackup(await filledStore(), PASSPHRASE);
  const counts = await previewBackup(file, PASSPHRASE);
  assert.deepEqual(counts, {
    profiles: 1, songLinks: 1, memories: 1, photos: 1, playlists: 1, observations: 1, history: 1, studyEvents: 2,
  });
});

test('una contraseña de menos de 10 caracteres no llega a exportar', async () => {
  await assert.rejects(
    buildBackup(await filledStore(), 'corta'),
    { message: 'La contraseña de la copia debe tener al menos 10 caracteres.' },
  );
});

test('un modo de importación desconocido se rechaza antes de leer la copia', async () => {
  const file = await buildBackup(await filledStore(), PASSPHRASE);
  await assert.rejects(
    restoreBackup(new MemoryStore(), file, PASSPHRASE, { mode: 'borrar' }),
    { message: 'Modo de importación no válido.' },
  );
});
