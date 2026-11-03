// Pruebas de la lógica de la biblioteca (frontend/web/js/catalog.js): lectura del catálogo, carpetas, saludo,
// duraciones, portadas y búsqueda. Datos ficticios. Ejecución: node --test tests/web-unit/catalog.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  albumYear,
  buildCatalog,
  childFolders,
  COVER_COLORS,
  coverColor,
  formatDuration,
  formatTotalDuration,
  greetingFor,
  localSongsOf,
  normalizeCoverPath,
  normalizeFolder,
  normalizeSong,
  normalizeText,
  recentSongs,
  searchCatalog,
  songCountText,
  songCover,
  songsInFolder,
  titleSize,
  totalDuration,
} from '../../frontend/web/js/catalog.js';

const song = (n, extra = {}) => ({
  id: `S000000000000000${n}`,
  title: `Canción de prueba ${n}`,
  artist: '',
  year: null,
  tags: [],
  folder_id: null,
  duration_s: 100 + n,
  audio: `audio/S000000000000000${n}.opus`,
  ...extra,
});

const FOLDERS = [
  { id: 'aaaaaaaaaa', name: 'Años veinte', parent_id: null },
  { id: 'bbbbbbbbbb', name: 'Valses', parent_id: 'aaaaaaaaaa' },
  { id: 'cccccccccc', name: 'Huérfana', parent_id: 'no-existe' },
];

describe('lectura del catálogo', () => {
  test('normaliza una canción del formato público (data/songs.json)', () => {
    const value = normalizeSong(song(1, { title: '  Charleston \n (Fox Trot) ', folder_id: 'aaaaaaaaaa', year: 1925 }));
    assert.deepEqual(value, {
      id: 'S0000000000000001',
      title: 'Charleston (Fox Trot)',
      artist: '',
      year: 1925,
      tags: [],
      folderId: 'aaaaaaaaaa',
      durationS: 101,
      audio: 'audio/S0000000000000001.opus',
      cover: null,
      local: false,
      addedAt: null,
      order: 0,
    });
  });

  test('descarta canciones sin id seguro o sin audio, y da título por defecto', () => {
    assert.equal(normalizeSong({ id: '../x', audio: 'a' }), null);
    assert.equal(normalizeSong({ id: 'S1' }), null);
    assert.equal(normalizeSong(null), null);
    assert.equal(normalizeSong({ id: 'S1', audio: 'audio/S1.opus', title: '' }).title, 'Sin título');
  });

  test('buildCatalog quita repetidos, sube a la raíz las carpetas huérfanas y añade las canciones locales', () => {
    const local = { id: 'L0011223344556677', title: 'Local', audio: 'audio/L0011223344556677.opus', local: true, createdAt: 5, duration_s: 30 };
    const catalog = buildCatalog([song(1), song(1, { title: 'Repetida' }), song(2, { folder_id: 'zzzzzzzzzz' })], FOLDERS, [local]);
    assert.deepEqual(catalog.songs.map((item) => item.id), ['S0000000000000001', 'S0000000000000002', 'L0011223344556677']);
    assert.equal(catalog.songById.get('S0000000000000001').title, 'Canción de prueba 1');
    assert.equal(catalog.songById.get('S0000000000000002').folderId, null);
    assert.equal(catalog.folderById.get('cccccccccc').parentId, null);
    assert.equal(catalog.songById.get('L0011223344556677').addedAt, 5);
  });

  test('el catálogo publicado en frontend/web/data se lee sin perder canciones', () => {
    const songs = JSON.parse(readFileSync(new URL('../../frontend/web/data/songs.json', import.meta.url), 'utf8'));
    const folders = JSON.parse(readFileSync(new URL('../../frontend/web/data/folders.json', import.meta.url), 'utf8'));
    const catalog = buildCatalog(songs, folders);
    assert.equal(catalog.songs.length, songs.length);
    assert.equal(catalog.folders.length, folders.length);
  });
});

describe('carpetas y colecciones', () => {
  const catalog = buildCatalog(
    [song(1, { folder_id: 'aaaaaaaaaa' }), song(2, { folder_id: 'bbbbbbbbbb' }), song(3)],
    FOLDERS,
    [{ id: 'L0000000000000001', title: 'Vieja', audio: 'x', local: true, createdAt: 1 }, { id: 'L0000000000000002', title: 'Nueva', audio: 'y', local: true, createdAt: 9 }],
  );

  test('songsInFolder da solo las canciones directas de la carpeta', () => {
    assert.deepEqual(songsInFolder(catalog, 'aaaaaaaaaa').map((item) => item.id), ['S0000000000000001']);
  });

  test('childFolders da las de la raíz o las hijas de una carpeta', () => {
    assert.deepEqual(childFolders(catalog, null).map((item) => item.id), ['aaaaaaaaaa', 'cccccccccc']);
    assert.deepEqual(childFolders(catalog, 'aaaaaaaaaa').map((item) => item.id), ['bbbbbbbbbb']);
  });

  test('las canciones locales van de la más reciente a la más antigua', () => {
    assert.deepEqual(localSongsOf(catalog).map((item) => item.title), ['Nueva', 'Vieja']);
  });

  test('«Añadidas recientemente»: primero las fechadas y después el catálogo en orden inverso', () => {
    assert.deepEqual(recentSongs(catalog, 10).map((item) => item.id), [
      'L0000000000000002', 'L0000000000000001', 'S0000000000000003', 'S0000000000000002', 'S0000000000000001',
    ]);
    assert.equal(recentSongs(catalog, 2).length, 2);
  });

  test('added_at del catálogo, si existe, ordena las públicas', () => {
    const dated = buildCatalog([song(1, { added_at: '2026-01-01T00:00:00Z' }), song(2, { added_at: '2026-06-01T00:00:00Z' }), song(3)]);
    assert.deepEqual(recentSongs(dated).map((item) => item.id), ['S0000000000000002', 'S0000000000000001', 'S0000000000000003']);
  });
});

describe('textos', () => {
  test('saludo según la hora', () => {
    const at = (hour) => new Date(2026, 10, 3, hour, 30);
    assert.equal(greetingFor(at(6)), 'Buenos días');
    assert.equal(greetingFor(at(13)), 'Buenos días');
    assert.equal(greetingFor(at(14)), 'Buenas tardes');
    assert.equal(greetingFor(at(20)), 'Buenas tardes');
    assert.equal(greetingFor(at(21)), 'Buenas noches');
    assert.equal(greetingFor(at(2)), 'Buenas noches');
  });

  test('duraciones de canción y de colección', () => {
    assert.equal(formatDuration(187.6), '3:07');
    assert.equal(formatDuration(3725), '1:02:05');
    assert.equal(formatDuration(NaN), '—');
    assert.equal(formatTotalDuration(3900), '1 h 5 min');
    assert.equal(formatTotalDuration(750), '12 min 30 s');
    assert.equal(formatTotalDuration(600), '10 min');
    assert.equal(formatTotalDuration(45), '45 s');
    assert.equal(totalDuration([{ durationS: 10 }, { durationS: null }, { durationS: 5 }]), 15);
  });

  test('número de canciones en singular y plural', () => {
    assert.equal(songCountText(1), '1 canción');
    assert.equal(songCountText(0), '0 canciones');
    assert.equal(songCountText(12), '12 canciones');
  });

  test('el título grande baja de tamaño con la longitud', () => {
    assert.equal(titleSize('Me gusta'), 'xl');
    assert.equal(titleSize('Todas las canciones'), 'l');
    assert.equal(titleSize('Una lista con un nombre largo de verdad'), 'm');
    assert.equal(titleSize('x'.repeat(60)), 's');
  });
});

describe('portadas', () => {
  test('el color de portada es estable y sale de la paleta', () => {
    assert.equal(coverColor('S0000000000000001'), coverColor('S0000000000000001'));
    assert.ok(COVER_COLORS.includes(coverColor('cualquier-id')));
  });

  test('todos los colores de la paleta contrastan al menos 4,5:1 con texto blanco', () => {
    const channel = (hex) => {
      const value = parseInt(hex, 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    for (const color of COVER_COLORS) {
      const [r, g, b] = [1, 3, 5].map((at) => channel(color.slice(at, at + 2)));
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      assert.ok(1.05 / (luminance + 0.05) >= 4.5, color);
    }
  });
});

describe('búsqueda', () => {
  const catalog = buildCatalog(
    [
      song(1, { title: 'Canción de cuna', artist: 'Banda Ficticia', folder_id: 'aaaaaaaaaa' }),
      song(2, { title: 'Vals de la montaña', tags: ['baile'] }),
      song(3, { title: 'Otra', year: 1925 }),
    ],
    FOLDERS,
  );

  test('sin texto no hay resultados', () => {
    assert.deepEqual(searchCatalog(catalog, '   '), { query: '', top: null, songs: [], folders: [], playlists: [] });
  });

  test('busca sin distinguir tildes ni mayúsculas, en título, artista, carpeta, etiquetas y año', () => {
    assert.deepEqual(searchCatalog(catalog, 'CANCION').songs.map((item) => item.id), ['S0000000000000001']);
    assert.deepEqual(searchCatalog(catalog, 'ficticia').songs.map((item) => item.id), ['S0000000000000001']);
    assert.deepEqual(searchCatalog(catalog, 'veinte').songs.map((item) => item.id), ['S0000000000000001']);
    assert.deepEqual(searchCatalog(catalog, 'baile').songs.map((item) => item.id), ['S0000000000000002']);
    assert.deepEqual(searchCatalog(catalog, '1925').songs.map((item) => item.id), ['S0000000000000003']);
  });

  test('el resultado principal es el de más puntuación; con empate gana la carpeta', () => {
    assert.equal(searchCatalog(catalog, 'otra').top.kind, 'song');
    assert.equal(searchCatalog(catalog, 'valses').top.kind, 'folder');
    const lists = [{ id: 'P1', name: 'Vals de la montaña' }];
    assert.equal(searchCatalog(catalog, 'vals de la montaña', lists).top.kind, 'playlist');
  });

  test('normalizeText quita tildes, diéresis y espacios de más', () => {
    assert.equal(normalizeText('  Pingüino   ÁRBOL '), 'pinguino arbol');
  });
});

describe('álbumes y portadas publicadas (contrato con el backend)', () => {
  test('una canción y un álbum aceptan "cover": "covers/<id>.jpg" y nada más', () => {
    assert.equal(normalizeCoverPath('covers/S0000000000000001.jpg'), 'covers/S0000000000000001.jpg');
    assert.equal(normalizeCoverPath('covers/F0123456789abcdef.jpg'), 'covers/F0123456789abcdef.jpg');
    for (const bad of ['covers/x.png', '/covers/x.jpg', 'https://otro.test/covers/x.jpg', 'covers/../x.jpg', 'covers/a/b.jpg', 'covers/.jpg', 42, null]) {
      assert.equal(normalizeCoverPath(bad), null, String(bad));
    }
    assert.equal(normalizeSong(song(1, { cover: 'covers/S0000000000000001.jpg' })).cover, 'covers/S0000000000000001.jpg');
    assert.equal(normalizeSong(song(1, { cover: 'data:image/png;base64,AAAA' })).cover, null);
  });

  test('un álbum lee artist y cover opcionales; sin ellos, artista vacío y sin portada', () => {
    assert.deepEqual(normalizeFolder({ id: 'F0123456789abcdef', name: ' Valses ', artist: ' Orquesta \n de prueba ', cover: 'covers/F0123456789abcdef.jpg' }), {
      id: 'F0123456789abcdef', name: 'Valses', artist: 'Orquesta de prueba', cover: 'covers/F0123456789abcdef.jpg', parentId: null,
    });
    assert.deepEqual(normalizeFolder({ id: 'aaaaaaaaaa', name: 'Años veinte' }), { id: 'aaaaaaaaaa', name: 'Años veinte', artist: '', cover: null, parentId: null });
    assert.equal(normalizeFolder({ id: 'aaaaaaaaaa' }).name, 'Álbum sin nombre');
  });

  test('songCover usa la portada de la canción o, si no tiene, la de su álbum', () => {
    const catalog = buildCatalog(
      [song(1, { folder_id: 'F0123456789abcdef' }), song(2, { folder_id: 'F0123456789abcdef', cover: 'covers/S0000000000000002.jpg' }), song(3)],
      [{ id: 'F0123456789abcdef', name: 'Con portada', cover: 'covers/F0123456789abcdef.jpg' }],
    );
    const [one, two, three] = catalog.songs;
    assert.equal(songCover(catalog, one), 'covers/F0123456789abcdef.jpg');
    assert.equal(songCover(catalog, two), 'covers/S0000000000000002.jpg');
    assert.equal(songCover(catalog, three), null);
  });

  test('albumYear da el año más repetido (con empate, el más antiguo) o null', () => {
    assert.equal(albumYear([{ year: 1925 }, { year: 1928 }, { year: 1928 }]), 1928);
    assert.equal(albumYear([{ year: 1930 }, { year: 1925 }]), 1925);
    assert.equal(albumYear([{ year: null }]), null);
  });

  test('la búsqueda encuentra un álbum por su artista', () => {
    const catalog = buildCatalog([song(1)], [{ id: 'aaaaaaaaaa', name: 'Valses', artist: 'Orquesta Imaginaria' }]);
    const found = searchCatalog(catalog, 'imaginaria');
    assert.deepEqual(found.folders.map((folder) => folder.id), ['aaaaaaaaaa']);
  });
});
