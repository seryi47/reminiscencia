// Pruebas de la lógica de Ajustes del cuidador (frontend/web/js/cuidador/ajustes.js): validación de la contraseña
// de la copia y del PIN nuevo, cuenta atrás del bloqueo, resúmenes de copia y de almacenamiento, y los textos
// fijos del contrato (C5 y DESIGN 8.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from '../../frontend/web/js/offline-core.js';
import {
  PASSPHRASE_MIN_LENGTH,
  REGISTRY_TEXT,
  SHORTCUT_CHOICES,
  TEXT_SCALE_CHOICES,
  backupFileName,
  lockoutSecondsLeft,
  offlineText,
  previewSummary,
  scaleValueOf,
  validateNewPin,
  validatePassphrase,
} from '../../frontend/web/js/cuidador/ajustes.js';

test('el texto del registro del estudio es el del DESIGN 8.4', () => {
  assert.equal(REGISTRY_TEXT, 'Se guardan eventos de escucha en este navegador para el estudio. No se usan nombres reales.');
});

test('la escala de texto ofrece 1, 1,25, 1,50 y 1,75 (DESIGN 5.3)', () => {
  assert.deepEqual(TEXT_SCALE_CHOICES.map((choice) => choice.value), ['1', '1.25', '1.5', '1.75']);
  assert.deepEqual(TEXT_SCALE_CHOICES.map((choice) => choice.label), ['Normal 1,00', 'Grande 1,25', 'Muy grande 1,50', 'Máximo 1,75']);
  assert.equal(scaleValueOf(1.25), '1.25');
  assert.equal(scaleValueOf(1), '1');
  assert.equal(scaleValueOf(9), '1');
});

test('los atajos de una tecla son «activados» o «desactivados» (DESIGN 7.4)', () => {
  assert.deepEqual(SHORTCUT_CHOICES.map((choice) => choice.value), ['activados', 'desactivados']);
});

test('la contraseña de la copia tiene al menos 10 caracteres y se repite igual', () => {
  assert.equal(PASSPHRASE_MIN_LENGTH, 10);
  assert.match(validatePassphrase('123456789', '123456789'), /al menos 10 caracteres/);
  assert.match(validatePassphrase('', ''), /al menos 10 caracteres/);
  assert.match(validatePassphrase('1234567890', '1234567891'), /no coinciden/);
  assert.equal(validatePassphrase('1234567890', '1234567890'), null);
});

test('el PIN nuevo tiene de 4 a 6 dígitos y se repite igual', () => {
  assert.equal(validateNewPin('1234', '1234'), null);
  assert.equal(validateNewPin('123456', '123456'), null);
  assert.equal(validateNewPin('123', '123'), 'El PIN debe tener entre 4 y 6 dígitos.');
  assert.equal(validateNewPin('1234567', '1234567'), 'El PIN debe tener entre 4 y 6 dígitos.');
  assert.equal(validateNewPin('1234', '1235'), 'Los dos PIN no coinciden.');
});

test('la cuenta atrás del bloqueo redondea hacia arriba y llega a 0 al terminar', () => {
  assert.equal(lockoutSecondsLeft(null, 0), 0);
  assert.equal(lockoutSecondsLeft(10000, 4000), 6);
  assert.equal(lockoutSecondsLeft(10000, 10000), 0);
  assert.equal(lockoutSecondsLeft(10500, 10000), 1);
  assert.equal(lockoutSecondsLeft(5000, 9000), 0);
});

test('el resumen de la vista previa de la copia pluraliza cada parte', () => {
  assert.equal(
    previewSummary({ profiles: 3, memories: 42, photos: 118, studyEvents: 1204 }),
    '3 perfiles, 42 recuerdos, 118 fotografías, 1204 eventos',
  );
  assert.equal(previewSummary({ profiles: 1, memories: 1, photos: 1, studyEvents: 1 }), '1 perfil, 1 recuerdo, 1 fotografía, 1 evento');
  assert.equal(previewSummary({}), '0 perfiles, 0 recuerdos, 0 fotografías, 0 eventos');
});

test('el fichero de copia se nombra con el día local y sin datos personales', () => {
  assert.equal(backupFileName(new Date(2026, 10, 2, 9, 30)), 'reminiscencia-copia-2026-11-02.rmc');
});

test('el estado de la biblioteca sin conexión se resume en español', () => {
  assert.equal(offlineText({ count: 0, audioBytes: 0 }), 'No hay canciones guardadas para escuchar sin internet.');
  assert.equal(offlineText({ count: 1, audioBytes: 1536 }), `1 canción guardada para escuchar sin internet, ${formatBytes(1536)} de audio.`);
  assert.equal(offlineText({ count: 2, audioBytes: 0 }), `2 canciones guardadas para escuchar sin internet, ${formatBytes(0)} de audio.`);
  assert.equal(offlineText(null), 'No hay canciones guardadas para escuchar sin internet.');
});
