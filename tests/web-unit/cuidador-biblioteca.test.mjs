// Pruebas de la lógica pura de la biblioteca del cuidador (C2): filas, filtros, búsqueda, orden, selección y
// teclado de la tabla. No necesita navegador: el DOM de mountLibrary se prueba en las pruebas de interfaz.
// Los datos son el catálogo público del repositorio (frontend/web/data/songs.json) y valoraciones ficticias.
// Ejecución: node --test tests/web-unit/cuidador-biblioteca.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildRows,
  cachedSongIds,
  clampPreference,
  countByFilter,
  deselectVisible,
  FAMILIARITY_LEGEND,
  familiarityText,
  familiarityValue,
  filterRows,
  FILTERS,
  formatDuration,
  headerSelectionState,
  matchesQuery,
  memorySongIds,
  mount,
  mountLibrary,
  nextRowIndex,
  pickFields,
  preferenceLabel,
  PREFERENCES,
  presentationCode,
  presentationLabel,
  PRESENTATIONS,
  retainVisible,
  routes,
  selectionSummary,
  selectVisible,
  SORT_KEYS,
  sortRows,
  toggleId,
  UNDO_MS,
} from '../../frontend/web/js/cuidador/biblioteca.js';

const CATALOG_PATH = fileURLToPath(new URL('../../frontend/web/data/songs.json', import.meta.url));
const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));

// Filas ficticias para las pruebas de orden y filtros.
function row(id, overrides = {}) {
  return {
    id,
    title: `Canción ${id}`,
    artist: '',
    durationS: 120,
    familiarity: 0,
    preference: 0,
    presentation: 'C0',
    hasLink: false,
    hasMemory: false,
    cached: true,
    playing: false,
    ...overrides,
  };
}

describe('formato de valores', () => {
  test('la duración usa m:ss, h:mm:ss y un guion largo si falta', () => {
    assert.equal(formatDuration(177.685), '2:58');
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(59.6), '1:00');
    assert.equal(formatDuration(3600), '1:00:00');
    assert.equal(formatDuration(3725), '1:02:05');
    assert.equal(formatDuration(null), '—');
    assert.equal(formatDuration(-1), '—');
    assert.equal(formatDuration(Number.NaN), '—');
  });

  test('la familiaridad se muestra como «N de 5» y 0 es sin valorar; fuera de rango cuenta como 0', () => {
    assert.equal(familiarityText(0), 'Sin valorar');
    assert.equal(familiarityText(3), '3 de 5');
    assert.equal(familiarityText(5), '5 de 5');
    assert.equal(familiarityValue(7), 0);
    assert.equal(familiarityValue(-2), 0);
    assert.equal(familiarityValue('4'), 0);
    assert.equal(FAMILIARITY_LEGEND.length, 5);
  });

  test('la preferencia tiene tres niveles y el texto de cada uno', () => {
    assert.deepEqual(PREFERENCES.map((item) => item.value), [-1, 0, 1]);
    assert.equal(preferenceLabel(-1), 'No le gusta');
    assert.equal(preferenceLabel(0), 'Le da igual');
    assert.equal(preferenceLabel(1), 'Le gusta');
    assert.equal(preferenceLabel(2), 'Le gusta');
    assert.equal(preferenceLabel(undefined), 'Le da igual');
    assert.equal(clampPreference(-2), -1);
  });

  test('la presentación usa C0, C1 o C2; lo demás se muestra como C0', () => {
    assert.deepEqual(PRESENTATIONS.map((item) => item.code), ['C0', 'C1', 'C2']);
    assert.equal(presentationCode('C2'), 'C2');
    assert.equal(presentationCode('X9'), 'C0');
    assert.equal(presentationLabel('C0'), 'Solo canción');
    assert.equal(presentationLabel('C1'), 'Recuerdo');
    assert.equal(presentationLabel('C2'), 'Foto y recuerdo');
    assert.equal(presentationLabel('C1', { long: true }), 'Canción y recuerdo');
    assert.equal(presentationLabel('C2', { long: true }), 'Canción, foto y recuerdo');
  });
});

describe('filas de la tabla', () => {
  test('una canción sin valoración sale con familiaridad 0, preferencia 0 y presentación C0', () => {
    const [first] = buildRows([{ id: 'Sabcdef0123456789', title: 'Tema', duration_s: 90 }]);
    assert.deepEqual(first, {
      id: 'Sabcdef0123456789',
      title: 'Tema',
      artist: '',
      durationS: 90,
      familiarity: 0,
      preference: 0,
      presentation: 'C0',
      hasLink: false,
      hasMemory: false,
      cached: false,
      playing: false,
    });
  });

  test('las valoraciones del perfil, los recuerdos, las copias y la canción que suena se reflejan en la fila', () => {
    const songs = [{ id: 'Sabcdef0123456789', title: 'Tema', duration_s: 90 }, { id: 'Sfedcba9876543210', title: 'Otro', duration_s: 60 }];
    const rows = buildRows(songs, {
      links: [{ songId: 'Sabcdef0123456789', familiarity: 4, preference: 1, presentation: 'C2' }],
      memorySongIds: new Set(['Sabcdef0123456789']),
      cachedIds: new Set(['Sfedcba9876543210']),
      playingId: 'Sfedcba9876543210',
    });
    assert.equal(rows[0].familiarity, 4);
    assert.equal(rows[0].preference, 1);
    assert.equal(rows[0].presentation, 'C2');
    assert.equal(rows[0].hasMemory, true);
    assert.equal(rows[0].cached, false);
    assert.equal(rows[1].cached, true);
    assert.equal(rows[1].playing, true);
    assert.equal(rows[0].playing, false);
  });

  test('las filas ignoran canciones sin identificador y datos que no son números', () => {
    const rows = buildRows([null, { title: 'Sin id' }, { id: 'Sabcdef0123456789', title: 7, duration_s: 'x' }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, '');
    assert.equal(rows[0].durationS, null);
  });

  test('el catálogo real del repositorio se convierte en nueve filas sin valoraciones', () => {
    const rows = buildRows(catalog);
    assert.equal(rows.length, catalog.length);
    assert.ok(rows.every((item) => item.familiarity === 0 && item.presentation === 'C0' && item.cached === false));
    assert.equal(rows.find((item) => item.id === 'S5aac103b6eb2ecf4').title, 'Charleston (Fox Trot)');
  });

  test('los recuerdos aportan las canciones que enlazan, y las copias se leen de las URL de la caché', () => {
    const memories = [{ songIds: ['Sabcdef0123456789'] }, { songIds: null }, null, { songIds: ['Sfedcba9876543210'] }];
    assert.deepEqual([...memorySongIds(memories)].sort(), ['Sabcdef0123456789', 'Sfedcba9876543210']);
    assert.deepEqual([...memorySongIds(undefined)], []);
    const songs = [{ id: 'Sabcdef0123456789' }, { id: 'Sfedcba9876543210' }];
    const cached = cachedSongIds(songs, [
      'https://reminiscencia.example/audio/Sabcdef0123456789.opus',
      '/audio/no-esta-en-el-catalogo.opus',
    ]);
    assert.deepEqual([...cached], ['Sabcdef0123456789']);
  });
});

describe('filtros de C-8', () => {
  const rows = [
    row('A', { familiarity: 0, cached: true }),
    row('B', { familiarity: 3, hasMemory: true, cached: false }),
    row('C', { familiarity: 0, hasMemory: true, cached: false }),
  ];

  test('cada filtro selecciona su conjunto y «Todas» devuelve todo', () => {
    assert.deepEqual(filterRows(rows, 'todas').map((item) => item.id), ['A', 'B', 'C']);
    assert.deepEqual(filterRows(rows, 'sin-familiaridad').map((item) => item.id), ['A', 'C']);
    assert.deepEqual(filterRows(rows, 'con-recuerdo').map((item) => item.id), ['B', 'C']);
    assert.deepEqual(filterRows(rows, 'sin-conexion').map((item) => item.id), ['B', 'C']);
  });

  test('el recuento de cada filtro sirve para el texto entre paréntesis', () => {
    assert.deepEqual(countByFilter(rows), { todas: 3, 'sin-familiaridad': 2, 'con-recuerdo': 2, 'sin-conexion': 2 });
    assert.deepEqual(FILTERS.map((item) => item.label), ['Todas', 'Sin familiaridad', 'Con recuerdo', 'Sin conexión']);
  });
});

describe('búsqueda', () => {
  const song = row('X', { title: 'Canción de María', artist: 'Orquesta Serena' });

  test('no distingue mayúsculas ni tildes', () => {
    assert.equal(matchesQuery(song, 'cancion'), true);
    assert.equal(matchesQuery(song, 'MARIA'), true);
    assert.equal(matchesQuery(song, 'orquesta'), true);
  });

  test('cada palabra debe aparecer; una búsqueda vacía lo deja todo', () => {
    assert.equal(matchesQuery(song, 'maria serena'), true);
    assert.equal(matchesQuery(song, 'maria inexistente'), false);
    assert.equal(matchesQuery(song, '   '), true);
    assert.equal(matchesQuery(song, ''), true);
  });
});

describe('orden de la tabla', () => {
  const rows = [
    row('Sc', { title: 'Zeta', durationS: 200, familiarity: 2, preference: 1, presentation: 'C2' }),
    row('Sa', { title: 'Árbol', durationS: null, familiarity: 5, preference: -1, presentation: 'C0' }),
    row('Sb', { title: 'Beta', durationS: 90, familiarity: 0, preference: 0, presentation: 'C1' }),
    row('Sd', { title: 'Track 10', durationS: 90, familiarity: 2, preference: 0, presentation: 'C1' }),
    row('Se', { title: 'Track 2', durationS: 30, familiarity: 2, preference: 1, presentation: 'C0' }),
  ];
  const ids = (list) => list.map((item) => item.id);

  test('por título, en orden de idioma y con números naturales', () => {
    assert.deepEqual(ids(sortRows(rows, 'title', 'asc')), ['Sa', 'Sb', 'Se', 'Sd', 'Sc']);
    assert.deepEqual(ids(sortRows(rows, 'title', 'desc')), ['Sc', 'Sd', 'Se', 'Sb', 'Sa']);
  });

  test('la duración sin dato va siempre al final, en ambos sentidos', () => {
    assert.equal(sortRows(rows, 'duration', 'asc').at(-1).id, 'Sa');
    assert.equal(sortRows(rows, 'duration', 'desc').at(-1).id, 'Sa');
    assert.deepEqual(ids(sortRows(rows, 'duration', 'asc')).slice(0, 2), ['Se', 'Sb']);
  });

  test('familiaridad y preferencia ordenan por valor; la presentación sigue C0, C1, C2', () => {
    assert.equal(sortRows(rows, 'familiarity', 'desc')[0].id, 'Sa');
    assert.equal(sortRows(rows, 'preference', 'asc')[0].id, 'Sa');
    assert.deepEqual(ids(sortRows(rows, 'presentation', 'asc')).slice(-1), ['Sc']);
    assert.equal(sortRows(rows, 'presentation', 'asc')[0].presentation, 'C0');
  });

  test('en empate se usa el título y luego el identificador, de forma estable', () => {
    const tied = [row('Sz', { title: 'Igual' }), row('Sy', { title: 'Igual' })];
    assert.deepEqual(ids(sortRows(tied, 'title', 'asc')), ['Sy', 'Sz']);
    assert.deepEqual(ids(sortRows(tied, 'duration', 'asc')), ['Sy', 'Sz']);
  });

  test('no modifica el array original y reconoce las claves de orden de C-4', () => {
    const copy = [...rows];
    sortRows(rows, 'title', 'desc');
    assert.deepEqual(rows, copy);
    assert.deepEqual(SORT_KEYS, ['title', 'duration', 'familiarity', 'preference', 'presentation']);
  });
});

describe('teclado de la tabla', () => {
  test('las flechas, Inicio y Fin mueven el índice dentro de los límites', () => {
    assert.equal(nextRowIndex(-1, 'ArrowDown', 5), 0);
    assert.equal(nextRowIndex(1, 'ArrowDown', 5), 2);
    assert.equal(nextRowIndex(4, 'ArrowDown', 5), 4);
    assert.equal(nextRowIndex(0, 'ArrowUp', 5), 0);
    assert.equal(nextRowIndex(3, 'ArrowUp', 5), 2);
    assert.equal(nextRowIndex(2, 'Home', 5), 0);
    assert.equal(nextRowIndex(2, 'End', 5), 4);
  });

  test('sin filas o con una tecla que no mueve la fila, no hay destino', () => {
    assert.equal(nextRowIndex(0, 'ArrowDown', 0), null);
    assert.equal(nextRowIndex(0, 'Enter', 5), null);
    assert.equal(nextRowIndex(0, 'a', 5), null);
  });

  test('las funciones de selección no modifican el conjunto anterior', () => {
    const base = new Set(['A']);
    assert.deepEqual([...toggleId(base, 'B')].sort(), ['A', 'B']);
    assert.deepEqual([...toggleId(new Set(['A', 'B']), 'A')], ['B']);
    assert.deepEqual([...base], ['A']);
  });

  test('Ctrl o Cmd+A selecciona las filas visibles sin tocar las que ya estaban marcadas fuera de la vista', () => {
    const selected = selectVisible(new Set(['fuera']), ['A', 'B']);
    assert.deepEqual([...selected].sort(), ['A', 'B', 'fuera']);
    assert.deepEqual([...deselectVisible(new Set(['A', 'B', 'fuera']), ['A'])].sort(), ['B', 'fuera']);
  });

  test('la selección solo cuenta las filas visibles al filtrar o buscar', () => {
    assert.deepEqual([...retainVisible(new Set(['A', 'B', 'C']), ['B', 'D'])], ['B']);
  });
});

describe('estado de la casilla de cabecera y resumen de la selección', () => {
  test('todas, algunas o ninguna de las visibles', () => {
    assert.equal(headerSelectionState(new Set(), []), 'ninguna');
    assert.equal(headerSelectionState(new Set(['A']), ['A', 'B']), 'algunas');
    assert.equal(headerSelectionState(new Set(['A', 'B', 'X']), ['A', 'B']), 'todas');
    assert.equal(headerSelectionState(new Set(['X']), ['A', 'B']), 'ninguna');
  });

  test('el resumen usa el singular y el plural de «seleccionada»', () => {
    assert.equal(selectionSummary(1), '1 seleccionada');
    assert.equal(selectionSummary(3), '3 seleccionadas');
    assert.equal(selectionSummary(0), '0 seleccionadas');
  });
});

describe('deshacer y constantes', () => {
  test('pickFields copia solo los campos indicados, para poder deshacer un cambio', () => {
    const source = { id: 'Sabcdef0123456789', familiarity: 4, preference: 1, presentation: 'C2' };
    assert.deepEqual(pickFields(source, ['familiarity', 'presentation']), { familiarity: 4, presentation: 'C2' });
  });

  test('el aviso de deshacer dura 10 segundos (DESIGN D25)', () => {
    assert.equal(UNDO_MS, 10000);
  });
});

describe('contrato de montaje', () => {
  test('la ruta biblioteca apunta a mountLibrary y mount es el mismo punto de entrada', () => {
    assert.equal(routes.biblioteca, mountLibrary);
    assert.equal(mount, mountLibrary);
    assert.equal(typeof mountLibrary, 'function');
  });
});

describe('canalización sobre el catálogo real', () => {
  test('filtrar, buscar y ordenar el catálogo deja las filas esperadas', () => {
    const rows = buildRows(catalog, {
      links: [
        { songId: 'S5aac103b6eb2ecf4', familiarity: 5, preference: 1, presentation: 'C1' },
        { songId: 'S63dd0f83182c55e7', familiarity: 2, preference: -1 },
      ],
      cachedIds: new Set(['S63dd0f83182c55e7']),
    });
    // Dos canciones del perfil de prueba tienen familiaridad; el resto sigue sin valorar.
    const sinFamiliaridad = sortRows(filterRows(rows, 'sin-familiaridad'), 'title', 'asc');
    assert.equal(sinFamiliaridad.length, rows.length - 2);
    const charlestons = sortRows(rows.filter((item) => matchesQuery(item, 'charleston')), 'title', 'asc');
    assert.deepEqual(charlestons.map((item) => item.title), ['Charleston (Fox Trot)', 'Charleston Rag']);
    const sinCopia = filterRows(rows, 'sin-conexion');
    assert.equal(sinCopia.length, rows.length - 1);
    assert.ok(!sinCopia.some((item) => item.id === 'S63dd0f83182c55e7'));
    assert.equal(countByFilter(rows)['sin-familiaridad'], rows.length - 2);
  });
});
