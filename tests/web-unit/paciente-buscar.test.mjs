// Pruebas de la lógica de búsqueda y de agrupación de la pantalla Buscar del modo paciente (buscar.js).
// Son funciones puras: no necesitan DOM. Los datos son ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,
  NO_SONGS_TEXT,
  ORIGIN_SEARCH,
  SEARCH_HELP_TEXT,
  categoryLabel,
  decadeOf,
  decadeTitle,
  emptyCategoryText,
  filterSongs,
  groupByArtist,
  groupByCategory,
  groupByDecade,
  groupByFolder,
  groupByList,
  noResultsText,
  normalizeSearchText,
  resolveResults,
  routes,
  searchTerms,
  songMatches,
  wordsOf,
} from '../../frontend/web/js/paciente/buscar.js';

// Canciones ficticias con identificador único (S + 16 caracteres hexadecimales).
let counter = 0;
function song(title, extra = {}) {
  counter += 1;
  return {
    id: `S${String(counter).padStart(16, '0')}`,
    title,
    artist: '',
    year: null,
    folder_id: null,
    ...extra,
  };
}

const titlesOf = (items) => items.map((item) => item.title);

test('la búsqueda ignora mayúsculas, acentos y espacios sobrantes', () => {
  assert.equal(normalizeSearchText('  Canción   DE  Prueba '), 'cancion de prueba');
  assert.equal(normalizeSearchText('Árbol'), 'arbol');
  assert.equal(normalizeSearchText(undefined), '');
  assert.deepEqual(searchTerms('   '), []);
  assert.deepEqual(searchTerms('Vals lento'), ['vals', 'lento']);
});

test('la búsqueda encuentra por título o por artista, y cada palabra debe aparecer', () => {
  const songs = [
    song('Vals de la tarde', { artist: 'Artista Uno' }),
    song('Canción del mar', { artist: 'Artista Dos' }),
    song('Nocturno'),
  ];
  assert.equal(filterSongs(songs, '').length, 3, 'sin texto, todas');
  assert.deepEqual(titlesOf(filterSongs(songs, 'tarde')), ['Vals de la tarde']);
  assert.deepEqual(titlesOf(filterSongs(songs, 'artista dos')), ['Canción del mar']);
  assert.deepEqual(titlesOf(filterSongs(songs, 'cancion MAR')), ['Canción del mar']);
  assert.deepEqual(titlesOf(filterSongs(songs, 'tarde mar')), [], 'las dos palabras deben estar');
  assert.equal(songMatches(songs[2], 'nocturno'), true);
});

test('las palabras se separan por espacios, signos y paréntesis; los acentos no cambian la palabra', () => {
  assert.deepEqual(wordsOf('Charleston (Fox-Trot)!'), ['charleston', 'fox', 'trot']);
  assert.deepEqual(wordsOf('Canción ñandú'), ['cancion', 'nandu']);
  assert.deepEqual(searchTerms('  Vals,  lento. '), ['vals', 'lento']);
});

test('una palabra de menos de tres letras solo coincide completa: «a» no trae a todos los artistas', () => {
  const songs = [
    song('Uno', { artist: 'Artista A' }),
    song('Dos', { artist: 'Artista B' }),
    song('Tres', { artist: 'Artista AB' }),
  ];
  assert.deepEqual(titlesOf(filterSongs(songs, 'Artista A')), ['Uno']);
  assert.deepEqual(titlesOf(filterSongs(songs, 'a')), ['Uno']);
  assert.deepEqual(titlesOf(filterSongs(songs, 'ha')), [], 'dos letras no valen como inicio de palabra');
});

test('con tres letras o más, una palabra vale como inicio de otra palabra', () => {
  const songs = [song('Charleston (Fox Trot)'), song('Nocturno')];
  assert.deepEqual(titlesOf(filterSongs(songs, 'fox')), ['Charleston (Fox Trot)']);
  assert.deepEqual(titlesOf(filterSongs(songs, 'char')), ['Charleston (Fox Trot)']);
  assert.deepEqual(titlesOf(filterSongs(songs, 'noct')), ['Nocturno']);
});

test('la década de un año es su decenio; sin año válido no hay década', () => {
  assert.equal(decadeOf(1925), 1920);
  assert.equal(decadeOf(1930), 1930);
  assert.equal(decadeOf(2026), 2020);
  assert.equal(decadeOf(null), null);
  assert.equal(decadeOf(0), null);
  assert.equal(decadeOf(1925.5), null);
  assert.equal(decadeOf('1925'), null);
  assert.equal(decadeTitle(1920), 'Años 1920');
  assert.equal(decadeTitle(null), 'Sin año indicado');
});

test('por década: de la más antigua a la más reciente, y las canciones sin año al final', () => {
  const songs = [
    song('A', { year: 1931 }),
    song('B', { year: null }),
    song('C', { year: 1925 }),
    song('D', { year: 1938 }),
    song('E', { year: null }),
  ];
  const groups = groupByDecade(songs);
  assert.deepEqual(groups.map((group) => group.title), ['Años 1920', 'Años 1930', 'Sin año indicado']);
  assert.deepEqual(titlesOf(groups[0].songs), ['C']);
  assert.deepEqual(titlesOf(groups[1].songs), ['A', 'D']);
  assert.deepEqual(titlesOf(groups[2].songs), ['B', 'E']);
});

test('por artista: agrupa sin distinguir mayúsculas ni acentos, ordena por nombre y deja sin artista al final', () => {
  const songs = [
    song('1', { artist: 'Lola' }),
    song('2', { artist: 'ana' }),
    song('3', { artist: '' }),
    song('4', { artist: 'LOLA' }),
    song('5', { artist: 'Álvaro' }),
  ];
  const groups = groupByArtist(songs);
  assert.deepEqual(groups.map((group) => group.title), ['Álvaro', 'ana', 'Lola', 'Sin artista indicado']);
  const lola = groups.find((group) => group.title === 'Lola');
  assert.deepEqual(titlesOf(lola.songs), ['1', '4'], 'Lola y LOLA forman un solo grupo');
});

test('por carpeta: solo las carpetas con canciones coincidentes, ordenadas por nombre', () => {
  const folders = [
    { id: 'f2', name: 'Boleros' },
    { id: 'f1', name: 'Años veinte' },
    { id: 'f3', name: 'Sin canciones' },
  ];
  const songs = [
    song('1', { folder_id: 'f1' }),
    song('2', { folder_id: 'f2' }),
    song('3', { folder_id: 'f1' }),
  ];
  const groups = groupByFolder(songs, folders);
  assert.deepEqual(groups.map((group) => group.title), ['Años veinte', 'Boleros']);
  assert.deepEqual(titlesOf(groups[0].songs), ['1', '3']);
});

test('por lista: en el orden de cada lista, sin listas vacías ni canciones que no coinciden', () => {
  const a = song('uno');
  const b = song('dos');
  const c = song('tres');
  const lists = [
    { id: 'L1', name: 'Domingos', songIds: [b.id, a.id] },
    { id: 'L2', name: 'Vacía', songIds: [] },
    { id: 'L3', name: 'Solo tres', songIds: [c.id] },
  ];
  // La canción «tres» no coincide con la búsqueda, así que no aparece en ningún grupo.
  const groups = groupByList([a, b], lists);
  assert.deepEqual(groups.map((group) => group.title), ['Domingos']);
  assert.deepEqual(titlesOf(groups[0].songs), ['dos', 'uno']);
});

test('las categorías son «Por artista», «Por década», «Por carpeta» y «Por lista»', () => {
  assert.deepEqual(CATEGORIES.map((category) => category.label), ['Por artista', 'Por década', 'Por carpeta', 'Por lista']);
  assert.deepEqual(CATEGORIES.map((category) => category.id), ['artist', 'decade', 'folder', 'list']);
  assert.equal(categoryLabel('decade'), 'Por década');
  assert.equal(categoryLabel('nada'), '');
  assert.deepEqual(groupByCategory('nada', [], {}), []);
});

test('sin texto y sin categoría, no hay resultados: solo la ayuda', () => {
  assert.deepEqual(resolveResults({ query: '   ', category: null, songs: [song('x')] }), { kind: 'help' });
  assert.equal(SEARCH_HELP_TEXT, 'Escribe un título o un artista');
});

test('con texto y sin categoría, lista plana de coincidencias', () => {
  const songs = [song('Vals de la tarde'), song('Nocturno')];
  const outcome = resolveResults({ query: 'tarde', category: null, songs });
  assert.equal(outcome.kind, 'list');
  assert.deepEqual(titlesOf(outcome.songs), ['Vals de la tarde']);
});

test('sin coincidencias, el mensaje de «Sin resultados» incluye el texto buscado', () => {
  const outcome = resolveResults({ query: 'xyz', category: null, songs: [song('Nocturno')] });
  assert.deepEqual(outcome, {
    kind: 'empty',
    message: 'No hay canciones con «xyz». Prueba con el nombre de un artista.',
  });
  assert.equal(noResultsText('xyz'), outcome.message);
});

test('con categoría y sin texto, todas las canciones agrupadas', () => {
  const songs = [song('A', { year: 1931 }), song('B', { year: 1925 })];
  const outcome = resolveResults({ query: '', category: 'decade', songs });
  assert.equal(outcome.kind, 'groups');
  assert.equal(outcome.label, 'Por década');
  assert.deepEqual(outcome.groups.map((group) => group.title), ['Años 1920', 'Años 1930']);
});

test('con categoría y texto, los grupos solo contienen coincidencias', () => {
  const songs = [song('Vals de la tarde', { year: 1925 }), song('Nocturno', { year: 1931 })];
  const outcome = resolveResults({ query: 'nocturno', category: 'decade', songs });
  assert.equal(outcome.kind, 'groups');
  assert.deepEqual(outcome.groups.map((group) => group.title), ['Años 1930']);
  assert.deepEqual(titlesOf(outcome.groups[0].songs), ['Nocturno']);
});

test('por carpeta sin carpetas con canciones: mensaje de categoría vacía', () => {
  const outcome = resolveResults({
    query: '',
    category: 'folder',
    songs: [song('suelta', { folder_id: null })],
    folders: [],
  });
  assert.deepEqual(outcome, { kind: 'empty', message: 'Todavía no hay canciones en ninguna carpeta.' });
  assert.equal(emptyCategoryText('list'), 'Todavía no hay listas con canciones.');
});

test('sin canciones en la biblioteca, el mensaje general', () => {
  assert.deepEqual(resolveResults({ query: '', category: 'artist', songs: [] }), {
    kind: 'empty',
    message: NO_SONGS_TEXT,
  });
});

test('rutas: buscar atiende la pantalla de búsqueda; el origen del registro es busqueda', () => {
  assert.deepEqual(Object.keys(routes), ['buscar']);
  assert.equal(typeof routes.buscar, 'function');
  assert.equal(ORIGIN_SEARCH, 'busqueda');
});
