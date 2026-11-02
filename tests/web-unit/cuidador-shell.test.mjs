// Pruebas del marco del cuidador (frontend/web/js/cuidador/shell.js): funciones puras de alias, tiempos,
// atajos de una tecla, carpetas, atributos de pantalla y destinos. No hay DOM: el marco y el reproductor
// se prueban en la suite de extremo a extremo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAV_DESTINATIONS,
  displayAttributes,
  folderRows,
  formatClock,
  initialOf,
  isTypingTarget,
  nowTitleModel,
  progressFraction,
  progressValueText,
  ratioToSeconds,
  sectionOfRoute,
  shortcutAction,
  spokenTime,
  truncateAlias,
  volumeValueText,
} from '../../frontend/web/js/cuidador/shell.js';

test('el alias se trunca a 24 caracteres contando caracteres, con «…» al final', () => {
  assert.equal(truncateAlias('Carmen'), 'Carmen');
  assert.equal(truncateAlias('  Ana  '), 'Ana');
  const exact = 'a'.repeat(24);
  assert.equal(truncateAlias(exact), exact);
  const long = 'a'.repeat(30);
  const cut = truncateAlias(long);
  assert.equal(Array.from(cut).length, 24);
  assert.ok(cut.endsWith('…'));
  assert.equal(truncateAlias(null), '');
});

test('la inicial se escribe en mayúscula y «?» si no hay texto', () => {
  assert.equal(initialOf('ángel'), 'Á');
  assert.equal(initialOf('maría'), 'M');
  assert.equal(initialOf(''), '?');
  assert.equal(initialOf(undefined), '?');
});

test('los tiempos se muestran como m:ss o h:mm:ss, y nunca son negativos', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(42.9), '0:42');
  assert.equal(formatClock(192), '3:12');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(Number.NaN), '0:00');
  assert.equal(formatClock(-5), '0:00');
});

test('la duración se lee en español sin partes a cero', () => {
  assert.equal(spokenTime(72), '1 minuto 12 segundos');
  assert.equal(spokenTime(225), '3 minutos 45 segundos');
  assert.equal(spokenTime(0), '0 segundos');
  assert.equal(spokenTime(1), '1 segundo');
  assert.equal(spokenTime(120), '2 minutos');
  assert.equal(spokenTime(3600), '1 hora');
  assert.equal(spokenTime(3660), '1 hora 1 minuto');
  assert.equal(spokenTime(7322), '2 horas 2 minutos 2 segundos');
});

test('el valor de la barra de progreso sigue el ejemplo del DESIGN 6.1 (P-6)', () => {
  assert.equal(progressValueText(72, 225), '1 minuto 12 segundos de 3 minutos 45 segundos');
  assert.equal(progressValueText(10, 0), 'Sin canción');
});

test('la fracción y la posición de la barra se acotan entre 0 y 1', () => {
  assert.equal(progressFraction(50, 200), 0.25);
  assert.equal(progressFraction(300, 200), 1);
  assert.equal(progressFraction(-5, 200), 0);
  assert.equal(progressFraction(5, 0), 0);
  assert.equal(ratioToSeconds(0.5, 200), 100);
  assert.equal(ratioToSeconds(2, 200), 200);
  assert.equal(ratioToSeconds(-1, 200), 0);
  assert.equal(ratioToSeconds(0.5, 0), 0);
  assert.equal(ratioToSeconds(Number.NaN, 200), 0);
});

test('el texto del volumen indica el paso y el máximo de 10', () => {
  assert.equal(volumeValueText(6), 'Volumen 6 de 10');
  assert.equal(volumeValueText(0), 'Volumen 0 de 10');
});

test('sin pista, la barra dice «No suena nada»; con pista, título y artista limpios', () => {
  assert.deepEqual(nowTitleModel(null), { title: 'No suena nada', artist: '', initial: '?', hasTrack: false });
  assert.deepEqual(nowTitleModel({ title: '  Hold Me ', artist: '' }), { title: 'Hold Me', artist: '', initial: 'H', hasTrack: true });
  assert.equal(nowTitleModel({ title: '', artist: 'X' }).title, 'Sin título');
});

test('cada ruta del cuidador pertenece a una sección de la navegación', () => {
  assert.equal(sectionOfRoute('biblioteca'), 'biblioteca');
  assert.equal(sectionOfRoute('perfil'), 'perfiles');
  assert.equal(sectionOfRoute('recuerdo'), 'perfiles');
  assert.equal(sectionOfRoute('lista'), 'perfiles');
  assert.equal(sectionOfRoute('observaciones'), 'perfiles');
  assert.equal(sectionOfRoute('ajustes'), 'ajustes');
  assert.equal(sectionOfRoute('escuchar'), null);
  assert.equal(sectionOfRoute('constructor'), null);
});

test('los destinos de la navegación son los cuatro del contrato, con sus data-testid', () => {
  assert.deepEqual(
    NAV_DESTINATIONS.map((item) => [item.key, item.testid]),
    [
      ['inicio', 'c-nav-inicio'],
      ['biblioteca', 'c-nav-biblioteca'],
      ['perfiles', 'c-nav-perfiles'],
      ['ajustes', 'c-nav-ajustes'],
    ],
  );
});

test('las carpetas cuentan sus canciones del catálogo y dejan 0 si no tienen ninguna', () => {
  const rows = folderRows(
    [{ id: 'f1', name: 'Años 50' }, { id: 'f2' }],
    [{ folder_id: 'f1' }, { folder_id: 'f1' }, { folder_id: null }],
  );
  assert.deepEqual(rows, [
    { id: 'f1', name: 'Años 50', count: 2 },
    { id: 'f2', name: 'f2', count: 0 },
  ]);
  assert.deepEqual(folderRows([], []), []);
});

test('las preferencias de pantalla se convierten en atributos de <html> (tokens.css)', () => {
  assert.deepEqual(
    displayAttributes({ textScale: 1.25, contrast: 'alto', theme: 'oscuro', reduceMotion: 'si' }),
    { escala: '1.25', contraste: 'alto', tema: 'oscuro', movimiento: 'reducido' },
  );
  assert.equal(displayAttributes({ textScale: 1, contrast: 'normal', theme: 'auto', reduceMotion: 'no' }).movimiento, 'normal');
  assert.equal(displayAttributes({ textScale: 1.5, contrast: 'normal', theme: 'auto', reduceMotion: 'sistema' }).movimiento, null);
  assert.equal(displayAttributes({ textScale: 1.5, contrast: 'normal', theme: 'auto', reduceMotion: 'sistema' }).escala, '1.5');
  assert.equal(displayAttributes({ textScale: 1.75, contrast: 'normal', theme: 'auto', reduceMotion: 'sistema' }).escala, '1.75');
});

// Atajos de una tecla (DESIGN 7.4): solo con el foco en la barra o el panel, y nunca en campos ni controles nativos.
test('la barra de progreso gestiona ← y → y deja ↑ y ↓ al volumen', () => {
  const slider = { tagName: 'DIV', role: 'slider' };
  assert.equal(shortcutAction({ key: 'ArrowRight' }, slider, true), null);
  assert.equal(shortcutAction({ key: 'ArrowLeft' }, slider, true), null);
  assert.equal(shortcutAction({ key: 'ArrowUp' }, slider, true), 'volume-up');
  assert.equal(shortcutAction({ key: 'ArrowDown' }, slider, true), 'volume-down');
  assert.equal(shortcutAction({ key: ' ' }, slider, true), 'toggle');
});

test('con el foco en el propio contenedor, las teclas actúan: espacio, saltos y volumen', () => {
  const bar = { tagName: 'SECTION' };
  assert.equal(shortcutAction({ key: ' ' }, bar, true), 'toggle');
  assert.equal(shortcutAction({ key: 'ArrowLeft' }, bar, true), 'seek-back');
  assert.equal(shortcutAction({ key: 'ArrowRight' }, bar, true), 'seek-forward');
  assert.equal(shortcutAction({ key: 'ArrowUp' }, bar, true), 'volume-up');
  assert.equal(shortcutAction({ key: 'ArrowDown' }, bar, true), 'volume-down');
});

test('los atajos respetan la preferencia «desactivados», los modificadores y las teclas que no son atajos', () => {
  const bar = { tagName: 'SECTION' };
  assert.equal(shortcutAction({ key: ' ' }, bar, false), null);
  assert.equal(shortcutAction({ key: 'ArrowUp', ctrlKey: true }, bar, true), null);
  assert.equal(shortcutAction({ key: 'ArrowUp', metaKey: true }, bar, true), null);
  assert.equal(shortcutAction({ key: 'ArrowUp', altKey: true }, bar, true), null);
  assert.equal(shortcutAction({ key: 'a' }, bar, true), null);
});

test('los botones y las opciones nativas no activan atajos (la tecla ya tiene su función)', () => {
  assert.equal(shortcutAction({ key: ' ' }, { tagName: 'BUTTON' }, true), null);
  assert.equal(shortcutAction({ key: 'ArrowRight' }, { tagName: 'BUTTON' }, true), null);
  assert.equal(shortcutAction({ key: 'ArrowUp' }, { tagName: 'DIV', role: 'radio' }, true), null);
  assert.equal(shortcutAction({ key: ' ' }, { tagName: 'A', href: '#x' }, true), null);
});

test('el control de volumen usa sus flechas nativas, pero el espacio pausa o reanuda', () => {
  const range = { tagName: 'INPUT', type: 'range' };
  assert.equal(shortcutAction({ key: 'ArrowUp' }, range, true), null);
  assert.equal(shortcutAction({ key: 'ArrowDown' }, range, true), null);
  assert.equal(shortcutAction({ key: ' ' }, range, true), 'toggle');
});

test('nunca se activa un atajo dentro de un campo de texto', () => {
  assert.equal(shortcutAction({ key: ' ' }, { tagName: 'INPUT', type: 'text' }, true), null);
  assert.equal(shortcutAction({ key: 'ArrowLeft' }, { tagName: 'TEXTAREA' }, true), null);
  assert.equal(shortcutAction({ key: ' ' }, { tagName: 'DIV', isContentEditable: true }, true), null);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: '' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isTypingTarget({ tagName: 'A', href: '#' }), false);
});
