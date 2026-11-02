// Pruebas de la lógica pura de Escuchar (frontend/web/js/paciente/escuchar.js): formato de tiempos y volumen,
// presentación C0/C1/C2 (DESIGN 8.2 y 8.3), recuerdos y fotografías (P-9, P-10) y pistas de la cola.
// No hay DOM: las funciones son puras y los datos son ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canVolumeDown,
  canVolumeUp,
  clampIndex,
  formatClock,
  initialOf,
  memoriesForSong,
  memoryAbsenceText,
  memoryMetaLine,
  NO_MEMORY_TEXT,
  nextIndex,
  photoAltText,
  photoCounter,
  playbackLabels,
  progressDescription,
  progressPercent,
  resolvePresentation,
  seekFromPointer,
  spokenDuration,
  spokenVolume,
  trackFromSong,
  yearLabel,
  zoomStep,
  ZOOM_LEVELS,
} from '../../frontend/web/js/paciente/escuchar.js';

test('formatClock escribe m:ss y trata los valores no válidos como 0:00', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(72), '1:12');
  assert.equal(formatClock(225.9), '3:45');
  assert.equal(formatClock(NaN), '0:00');
  assert.equal(formatClock(-5), '0:00');
  assert.equal(formatClock(undefined), '0:00');
});

test('spokenDuration lee la duración en español con singular y plural', () => {
  assert.equal(spokenDuration(0), '0 segundos');
  assert.equal(spokenDuration(1), '1 segundo');
  assert.equal(spokenDuration(60), '1 minuto');
  assert.equal(spokenDuration(72), '1 minuto 12 segundos');
  assert.equal(spokenDuration(120), '2 minutos');
  assert.equal(spokenDuration(61), '1 minuto 1 segundo');
});

test('progressDescription coincide con el ejemplo de DESIGN P-6', () => {
  assert.equal(progressDescription(72, 225), '1 minuto 12 segundos de 3 minutos 45 segundos');
});

test('spokenVolume y los límites del volumen respetan el paso de 0 a 10 y el límite del perfil', () => {
  assert.equal(spokenVolume(6), 'Volumen 6 de 10');
  assert.equal(spokenVolume(15), 'Volumen 10 de 10');
  assert.equal(spokenVolume(-2), 'Volumen 0 de 10');
  assert.equal(canVolumeDown(0), false);
  assert.equal(canVolumeDown(3), true);
  assert.equal(canVolumeUp(5, 5), false);
  assert.equal(canVolumeUp(4, 5), true);
  assert.equal(canVolumeUp(10), false);
});

test('progressPercent y el toque sobre la pista calculan la posición', () => {
  assert.equal(progressPercent(45, 180), 25);
  assert.equal(progressPercent(0, 0), 0);
  assert.equal(progressPercent(999, 180), 100);
  assert.equal(seekFromPointer(150, 100, 200, 180), 45);
  assert.equal(seekFromPointer(50, 100, 200, 180), 0);
  assert.equal(seekFromPointer(400, 100, 200, 180), 180);
  assert.equal(seekFromPointer(120, 100, 0, 180), null);
});

test('initialOf toma la primera letra o cifra del título en mayúscula', () => {
  assert.equal(initialOf('2 to 2'), '2');
  assert.equal(initialOf('  ñandú'), 'Ñ');
  assert.equal(initialOf('¿Qué?'), 'Q');
  assert.equal(initialOf(''), '');
  assert.equal(initialOf(undefined), '');
});

test('resolvePresentation: con Solo audio siempre C0; si no, la asociación o C0 por defecto', () => {
  assert.equal(resolvePresentation('segun-cancion', { presentation: 'C2' }), 'C2');
  assert.equal(resolvePresentation('segun-cancion', { presentation: 'C1' }), 'C1');
  assert.equal(resolvePresentation('solo-audio', { presentation: 'C2' }), 'C0');
  assert.equal(resolvePresentation('segun-cancion', null), 'C0');
  assert.equal(resolvePresentation('segun-cancion', { presentation: 'X' }), 'C0');
});

test('memoriesForSong devuelve los recuerdos que contienen la canción, en su orden', () => {
  const memories = [
    { id: 'M1', songIds: ['S1', 'S2'] },
    { id: 'M2', songIds: ['S2'] },
    { id: 'M3', songIds: [] },
  ];
  assert.deepEqual(memoriesForSong(memories, 'S2').map((memory) => memory.id), ['M1', 'M2']);
  assert.deepEqual(memoriesForSong(memories, 'S9'), []);
  assert.deepEqual(memoriesForSong(null, 'S1'), []);
});

test('nextIndex da la vuelta y clampIndex mantiene el índice dentro de la lista', () => {
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(2, 3), 0);
  assert.equal(nextIndex(0, 0), 0);
  assert.equal(clampIndex(5, 3), 2);
  assert.equal(clampIndex(-1, 3), 0);
  assert.equal(clampIndex(1, 0), 0);
});

test('textos del recuerdo: año, personas, texto alternativo y contador de fotografías', () => {
  assert.equal(yearLabel(1974), '1974');
  assert.equal(yearLabel(null), 'Año aproximado');
  assert.equal(memoryMetaLine({ year: 1974, people: ['Hermana', 'Tío'] }), '1974 · Hermana, Tío');
  assert.equal(memoryMetaLine({ year: null, people: [] }), 'Año aproximado');
  assert.equal(photoAltText({ caption: ' Playa ' }, { title: 'Verano' }), 'Playa');
  assert.equal(photoAltText({ caption: '' }, { title: 'Verano' }), 'Fotografía del recuerdo «Verano»');
  assert.equal(photoCounter(0, 3), '1 de 3');
  assert.equal(photoCounter(0, 0), '');
  assert.equal(memoryAbsenceText(true), 'Cargando…');
  assert.equal(memoryAbsenceText(false), NO_MEMORY_TEXT);
  assert.equal(NO_MEMORY_TEXT, 'Sin recuerdo guardado');
});

test('zoomStep recorre los niveles del recuerdo ampliado sin salirse', () => {
  assert.deepEqual(ZOOM_LEVELS, [1, 1.5, 2, 3]);
  assert.equal(zoomStep(0, -1), 0);
  assert.equal(zoomStep(3, 1), 3);
  assert.equal(zoomStep(1, 1), 2);
});

test('trackFromSong usa la misma forma de pista que las listas y no inventa portada', () => {
  const track = trackFromSong({
    id: 'S1234567890abcdef',
    title: 'Ejemplo',
    artist: '',
    year: null,
    audio: 'audio/S1234567890abcdef.opus',
    folder_id: null,
  });
  assert.deepEqual(track, {
    id: 'S1234567890abcdef',
    title: 'Ejemplo',
    artist: '',
    year: null,
    coverUrl: null,
    audioUrl: 'audio/S1234567890abcdef.opus',
    folderId: null,
  });
});

test('playbackLabels dice Pausar mientras suena y Reproducir en pausa', () => {
  assert.deepEqual(playbackLabels(true), { toggle: 'Pausar', icon: 'pausar' });
  assert.deepEqual(playbackLabels(false), { toggle: 'Reproducir', icon: 'reproducir' });
});
