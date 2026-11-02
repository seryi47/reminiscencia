// Pruebas de crypto.js: sobres cifrados, contraseñas y PIN. Solo datos ficticios; sin IndexedDB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_ITERATIONS,
  base64ToBytes,
  bytesToBase64,
  constantTimeEqual,
  decryptJson,
  encryptJson,
  hashPin,
  randomId,
  verifyPin,
} from '../../frontend/web/js/crypto.js';

const PASSPHRASE = 'frase de prueba 2026';
const OTHER_PASSPHRASE = 'otra frase distinta';
const CONTENT = { alias: 'Persona de prueba', memories: [{ title: 'Recuerdo de prueba', text: 'Texto ficticio' }] };
const DECRYPT_FAILURE = { name: 'Error', message: 'Contraseña incorrecta o copia dañada' };

// Un único sobre compartido por las pruebas que solo lo leen (cada cifrado tarda por PBKDF2).
let cachedEnvelope = null;
function sampleEnvelope() {
  cachedEnvelope ??= encryptJson(CONTENT, PASSPHRASE);
  return cachedEnvelope;
}

// Cambia el primer byte de un valor en base64 y lo devuelve en base64.
function flipFirstByte(text) {
  const bytes = base64ToBytes(text);
  bytes[0] ^= 0x01;
  return bytesToBase64(bytes);
}

test('cifrado y descifrado devuelven el mismo contenido', async () => {
  const envelope = await encryptJson(CONTENT, PASSPHRASE);
  assert.deepEqual(await decryptJson(envelope, PASSPHRASE), CONTENT);
});

test('una contraseña incorrecta falla sin revelar la causa', async () => {
  await assert.rejects(decryptJson(await sampleEnvelope(), OTHER_PASSPHRASE), DECRYPT_FAILURE);
});

test('un sobre alterado falla con el mismo mensaje', async () => {
  const envelope = await sampleEnvelope();
  const tampered = [
    { ...envelope, data: flipFirstByte(envelope.data) },
    { ...envelope, cipher: { ...envelope.cipher, iv: flipFirstByte(envelope.cipher.iv) } },
    { ...envelope, kdf: { ...envelope.kdf, salt: flipFirstByte(envelope.kdf.salt) } },
    { ...envelope, kdf: { ...envelope.kdf, iterations: BACKUP_ITERATIONS + 1 } },
    { ...envelope, data: envelope.data.slice(0, -4) },
  ];
  for (const copy of tampered) {
    await assert.rejects(decryptJson(copy, PASSPHRASE), DECRYPT_FAILURE);
  }
});

test('formato, versión o algoritmo no reconocidos fallan igual que una contraseña incorrecta', async () => {
  const envelope = await sampleEnvelope();
  await assert.rejects(decryptJson(null, PASSPHRASE), DECRYPT_FAILURE);
  await assert.rejects(decryptJson({ format: 'otra-cosa', version: 1 }, PASSPHRASE), DECRYPT_FAILURE);
  await assert.rejects(decryptJson({ ...envelope, version: 2 }, PASSPHRASE), DECRYPT_FAILURE);
  await assert.rejects(decryptJson({ ...envelope, cipher: { ...envelope.cipher, name: 'AES-CBC' } }, PASSPHRASE), DECRYPT_FAILURE);
});

test('el sobre guarda formato, iteraciones, sal e IV', async () => {
  const envelope = await sampleEnvelope();
  assert.equal(envelope.format, 'reminiscencia-backup');
  assert.equal(envelope.version, 1);
  assert.equal(envelope.kdf.name, 'PBKDF2');
  assert.equal(envelope.kdf.hash, 'SHA-256');
  assert.equal(envelope.kdf.iterations, 600000);
  assert.equal(envelope.cipher.name, 'AES-GCM');
  assert.equal(base64ToBytes(envelope.kdf.salt).length, 16);
  assert.equal(base64ToBytes(envelope.cipher.iv).length, 12);
  assert.equal(typeof envelope.data, 'string');
});

test('el sobre no contiene el texto en claro', async () => {
  const text = JSON.stringify(await sampleEnvelope());
  assert.equal(text.includes('Persona de prueba'), false);
  assert.equal(text.includes('Recuerdo de prueba'), false);
});

test('cada cifrado usa sal e IV nuevos', async () => {
  const first = await sampleEnvelope();
  const second = await encryptJson(CONTENT, PASSPHRASE);
  assert.notEqual(first.kdf.salt, second.kdf.salt);
  assert.notEqual(first.cipher.iv, second.cipher.iv);
  assert.notEqual(first.data, second.data);
});

test('una contraseña de menos de 10 caracteres se rechaza antes de cifrar', async () => {
  const message = 'La contraseña de la copia debe tener al menos 10 caracteres.';
  await assert.rejects(encryptJson(CONTENT, 'corta'), { message });
  await assert.rejects(encryptJson(CONTENT, undefined), { message });
});

test('la contraseña se normaliza (NFC): acentos compuestos y descompuestos abren la misma copia', async () => {
  const composed = 'contraseña ñandú 2026';
  const decomposed = composed.normalize('NFD');
  assert.notEqual(composed, decomposed);
  const envelope = await encryptJson(CONTENT, composed);
  assert.deepEqual(await decryptJson(envelope, decomposed), CONTENT);
});

test('PIN: el mismo PIN produce un hash distinto cada vez', async () => {
  const first = await hashPin('4821');
  const second = await hashPin('4821');
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(first.iterations, 310000);
  assert.equal(first.algo, 'PBKDF2-SHA-256');
});

test('PIN: verifica el PIN correcto y rechaza los incorrectos', async () => {
  const record = await hashPin('4821');
  assert.equal(await verifyPin('4821', record), true);
  assert.equal(await verifyPin('4822', record), false);
  assert.equal(await verifyPin('482', record), false);
});

test('PIN: registros incompletos, alterados o de otro tipo nunca verifican', async () => {
  const record = await hashPin('4821');
  assert.equal(await verifyPin('4821', null), false);
  assert.equal(await verifyPin('4821', { ...record, algo: 'MD5' }), false);
  assert.equal(await verifyPin('4821', { ...record, iterations: 1 }), false);
  assert.equal(await verifyPin('4821', { ...record, hash: '' }), false);
  assert.equal(await verifyPin('4821', { ...record, salt: '' }), false);
  assert.equal(await verifyPin(4821, record), false);
});

test('randomId: 32 caracteres hexadecimales y sin repeticiones', () => {
  const ids = Array.from({ length: 50 }, () => randomId());
  for (const id of ids) assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(new Set(ids).size, ids.length);
});

test('base64: ida y vuelta de bytes y rechazo de texto que no es base64', () => {
  const bytes = Uint8Array.from({ length: 100000 }, (_, i) => (i * 7) % 256);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  assert.throws(() => base64ToBytes('no es base64 !!'), { message: 'Datos en base64 no válidos.' });
});

test('constantTimeEqual compara contenido y longitud', () => {
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});
