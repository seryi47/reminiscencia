// Pruebas de las incidencias de la biblioteca (hoja «Subir canciones», «Desde Internet Archive»): validaciones,
// cuerpo y enlace de GitHub.
// El cuerpo se comprueba con un analizador que replica _read_fields de backend/sonidos/issue_request.py, para
// que una petición que pasa aquí sea una petición que el backend acepta. Todos los datos son ficticios.
// Ejecución: node --test tests/web-unit/cuidador-incidencias.test.mjs

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildImportRequest,
  buildOrganizeIssueUrl,
  COVER_RULES,
  COVER_UPLOAD_URL,
  EDIT_NOTE,
  folderArtistProblem,
  folderNameProblem,
  isCoverFolderId,
  songArtistProblem,
  songTitleProblem,
  buildIssueBody,
  buildIssueTitle,
  buildIssueUrl,
  classifyUrl,
  evaluateImportForm,
  isFolderId,
  isSongId,
  normalizeTags,
  REQUEST_LIMITS,
  validateImportRequest,
  validateOperation,
  validateRequest,
  validateUrl,
} from '../../frontend/web/js/cuidador/incidencias.js';

// Identificadores ficticios con la forma exacta del catálogo.
const SONG = 'S0123456789abcdef';
const OTHER_SONG = 'Sfedcba9876543210';
const FOLDER = '0123456789';

// Réplica de _read_fields (issue_request.py): líneas «clave: valor», claves permitidas, sin repetir y sin control.
const ALLOWED_KEYS = ['action', 'url', 'license', 'title', 'payload'];
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}]/u;

function parseLikeBackend(text) {
  const fields = {};
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    if (!ALLOWED_KEYS.includes(key)) throw new Error(`clave desconocida: ${key}`);
    if (Object.prototype.hasOwnProperty.call(fields, key)) throw new Error(`clave repetida: ${key}`);
    const value = line.slice(index + 1).trim();
    if (CONTROL.test(value)) throw new Error(`el valor de ${key} contiene caracteres de control`);
    fields[key] = value;
  }
  return fields;
}

describe('clasificación de direcciones (sources.classify)', () => {
  test('las plataformas bloqueadas se rechazan, con subdominios y sin importar mayúsculas', () => {
    assert.equal(classifyUrl('https://www.youtube.com/watch?v=abc'), 'blocked');
    assert.equal(classifyUrl('https://youtu.be/abc'), 'blocked');
    assert.equal(classifyUrl('https://m.youtube.com/watch'), 'blocked');
    assert.equal(classifyUrl('https://OPEN.Spotify.com/track/x'), 'blocked');
    assert.equal(classifyUrl('https://soundcloud.com./usuario/pista'), 'blocked');
    assert.equal(classifyUrl('https://bandcamp.com/track'), 'blocked');
  });

  test('Internet Archive acepta solo la forma details/<identificador>', () => {
    assert.equal(classifyUrl('https://archive.org/details/ejemplo-de-prueba'), 'archive');
    assert.equal(classifyUrl('https://www.archive.org/details/ejemplo-de-prueba/?x=1'), 'archive');
    assert.equal(classifyUrl('https://archive.org/download/ejemplo-de-prueba'), 'archive-path');
    assert.equal(classifyUrl('https://archive.org/download/ejemplo/fichero.mp3'), 'archive-path');
    assert.equal(classifyUrl('https://archive.org/'), 'archive-path');
  });

  test('un fichero de audio directo se reconoce por la extensión, sin distinguir mayúsculas', () => {
    assert.equal(classifyUrl('https://ejemplo.org/audio/tema.mp3'), 'direct');
    assert.equal(classifyUrl('https://ejemplo.org/audio/TEMA.FLAC?descarga=1'), 'direct');
    assert.equal(classifyUrl('https://ejemplo.org/audio/tema.pdf'), 'other');
  });

  test('las direcciones mal formadas se marcan como no válidas', () => {
    assert.equal(classifyUrl('http://archive.org/details/x'), 'invalid');
    assert.equal(classifyUrl('ftp://ejemplo.org/a.mp3'), 'invalid');
    assert.equal(classifyUrl('https://usuario@ejemplo.org/a.mp3'), 'invalid');
    assert.equal(classifyUrl('https://ejemplo..org/a.mp3'), 'invalid');
    assert.equal(classifyUrl('https://'), 'invalid');
    assert.equal(classifyUrl(undefined), 'invalid');
  });
});

describe('validateUrl (mensajes en español)', () => {
  test('acepta un ítem de Internet Archive y un fichero directo', () => {
    assert.equal(validateUrl('https://archive.org/details/ejemplo-de-prueba'), null);
    assert.equal(validateUrl('https://ejemplo.org/audio/tema.opus'), null);
  });

  test('explica el motivo de cada rechazo', () => {
    assert.match(validateUrl(''), /Escribe la dirección/);
    assert.match(validateUrl('http://archive.org/details/x'), /https:\/\//);
    assert.match(validateUrl('https://www.youtube.com/watch?v=x'), /no se puede importar/);
    assert.match(validateUrl('https://archive.org/download/x'), /archive\.org\/details/);
    assert.match(validateUrl('https://ejemplo.org/pagina.html'), /Admite un ítem de Internet Archive/);
    assert.match(validateUrl('https://ejemplo.org/a con espacios.mp3'), /espacios/);
    assert.match(validateUrl('https://ejemplo.org/' + 'a'.repeat(REQUEST_LIMITS.url) + '.mp3'), /2048 caracteres/);
  });
});

describe('validateImportRequest y buildImportRequest', () => {
  test('un fichero directo exige licencia; una de Internet Archive no la necesita', () => {
    assert.deepEqual(validateImportRequest({ url: 'https://ejemplo.org/a.mp3' }),
      { field: 'license', message: 'Para un fichero directo indica la licencia de uso.' });
    assert.equal(validateImportRequest({ url: 'https://archive.org/details/ejemplo-de-prueba' }), null);
  });

  test('el título es opcional, pero con control o demasiado largo no vale', () => {
    assert.equal(validateImportRequest({ url: 'https://archive.org/details/x', title: '' }), null);
    assert.deepEqual(validateImportRequest({ url: 'https://archive.org/details/x', title: 'a\nb' }).field, 'title');
    assert.deepEqual(validateImportRequest({ url: 'https://archive.org/details/x', title: 'a'.repeat(201) }).field, 'title');
  });

  test('en una importación de Internet Archive la licencia se descarta; en un directo se conserva', () => {
    const ia = buildImportRequest({ url: '  https://archive.org/details/ejemplo  ', license: 'CC BY', title: '  Tema  ' });
    assert.deepEqual(ia, { action: 'import', url: 'https://archive.org/details/ejemplo', license: null, title: 'Tema' });
    const direct = buildImportRequest({ url: 'https://ejemplo.org/a.mp3', license: ' CC BY 4.0 ', title: '' });
    assert.deepEqual(direct, { action: 'import', url: 'https://ejemplo.org/a.mp3', license: 'CC BY 4.0', title: null });
  });
});

describe('cuerpo de la incidencia (contrato del backend)', () => {
  test('una importación de Internet Archive: action, url y title, sin license', () => {
    const body = buildIssueBody({ action: 'import', url: 'https://archive.org/details/ejemplo', license: 'CC BY', title: 'Tema' });
    assert.equal(body, 'action: import\nurl: https://archive.org/details/ejemplo\ntitle: Tema');
    assert.deepEqual(parseLikeBackend(body), { action: 'import', url: 'https://archive.org/details/ejemplo', title: 'Tema' });
  });

  test('una importación directa incluye la licencia', () => {
    const body = buildIssueBody({ action: 'import', url: 'https://ejemplo.org/a.mp3', license: 'CC0 1.0' });
    assert.deepEqual(parseLikeBackend(body), { action: 'import', url: 'https://ejemplo.org/a.mp3', license: 'CC0 1.0' });
  });

  test('una operación de organize es una sola línea «payload:» con JSON', () => {
    const body = buildIssueBody({ action: 'organize', payload: { op: 'edit_song', song_id: SONG, public: false } });
    const lines = body.split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0], 'action: organize');
    assert.equal(lines[1], `payload: {"op":"edit_song","song_id":"${SONG}","public":false}`);
    assert.deepEqual(JSON.parse(parseLikeBackend(body).payload), { op: 'edit_song', song_id: SONG, public: false });
  });

  test('las comillas y las barras invertidas quedan escapadas y el payload sigue en una línea', () => {
    const body = buildIssueBody({ action: 'organize', payload: { op: 'create_folder', name: 'Años "veinte" \\ 1', parent_id: null } });
    assert.equal(body.split('\n').length, 2);
    assert.equal(JSON.parse(parseLikeBackend(body).payload).name, 'Años "veinte" \\ 1');
  });

  test('un salto de línea Unicode (U+2028, U+2029) no pasa la validación de texto: el backend lo rechaza', () => {
    assert.throws(() => buildIssueBody({ action: 'organize', payload: { op: 'create_folder', name: 'Año veinte', parent_id: null } }), /caracteres de control/);
    assert.throws(() => buildIssueBody({ action: 'import', url: 'https://archive.org/details/x', title: 'a b' }), /caracteres de control/);
  });

  test('no se genera un cuerpo que el backend rechazaría: lanza el motivo en español', () => {
    assert.throws(() => buildIssueBody({ action: 'import', url: 'https://www.youtube.com/watch?v=x' }), /no se puede importar/);
    assert.throws(() => buildIssueBody({ action: 'organize', payload: { op: 'edit_song', song_id: SONG } }), /al menos un campo/);
    assert.throws(() => buildIssueBody({ action: 'otra' }), /acción no es válida/);
  });
});

describe('validateOperation (validate_payload del backend)', () => {
  test('edit_song necesita song_id y al menos un campo que cambiar', () => {
    assert.equal(validateOperation({ op: 'edit_song', song_id: SONG, public: true }), null);
    assert.match(validateOperation({ op: 'edit_song', song_id: SONG }), /al menos un campo/);
    assert.match(validateOperation({ op: 'edit_song' }), /Falta el campo song_id/);
    assert.match(validateOperation({ op: 'edit_song', song_id: 'S123' }), /identificador de la canción no es válido/);
  });

  test('public debe ser un booleano JSON, no un texto', () => {
    assert.match(validateOperation({ op: 'edit_song', song_id: SONG, public: 'true' }), /true o false/);
    assert.equal(validateOperation({ op: 'edit_song', song_id: SONG, public: false }), null);
  });

  test('el año va entre 1000 y 2100, o null', () => {
    assert.equal(validateOperation({ op: 'edit_song', song_id: SONG, year: null }), null);
    assert.equal(validateOperation({ op: 'edit_song', song_id: SONG, year: 1925 }), null);
    assert.match(validateOperation({ op: 'edit_song', song_id: SONG, year: 999 }), /entre 1000 y 2100/);
    assert.match(validateOperation({ op: 'edit_song', song_id: SONG, year: 2101 }), /entre 1000 y 2100/);
    assert.match(validateOperation({ op: 'edit_song', song_id: SONG, year: '1925' }), /entre 1000 y 2100/);
  });

  test('las etiquetas: como mucho 20, y cada una como mucho 40 caracteres tras normalizar', () => {
    assert.equal(validateOperation({ op: 'edit_song', song_id: SONG, tags: ['jazz', 'años veinte'] }), null);
    const twentyOne = Array.from({ length: 21 }, (_, index) => `etiqueta${index}`);
    assert.match(validateOperation({ op: 'edit_song', song_id: SONG, tags: twentyOne }), /como máximo 20/);
    assert.match(validateOperation({ op: 'edit_song', song_id: SONG, tags: ['a'.repeat(41)] }), /como máximo 40/);
  });

  test('los campos desconocidos y las operaciones desconocidas se rechazan', () => {
    assert.match(validateOperation({ op: 'edit_song', song_id: SONG, duration: 3 }), /«duration» no está permitido/);
    assert.match(validateOperation({ op: 'borrar_todo' }), /Operación desconocida/);
    assert.match(validateOperation({ op: '__proto__' }), /Operación desconocida/);
    assert.match(validateOperation(['edit_song']), /objeto JSON/);
  });

  test('los álbumes (carpetas): nombre obligatorio, identificadores F + 16 o 10 hexadecimales y parent_id opcional', () => {
    assert.equal(validateOperation({ op: 'create_folder', name: 'Años 20', parent_id: null }), null);
    assert.equal(validateOperation({ op: 'create_folder', name: 'Años 20' }), null);
    assert.match(validateOperation({ op: 'create_folder', name: '   ' }), /no puede quedar en blanco/);
    assert.equal(validateOperation({ op: 'rename_folder', folder_id: FOLDER, name: 'Nueva' }), null);
    assert.match(validateOperation({ op: 'rename_folder', folder_id: 'ABC', name: 'Nueva' }), /identificador del álbum no es válido/);
    assert.equal(validateOperation({ op: 'delete_folder', folder_id: FOLDER }), null);
    assert.match(validateOperation({ op: 'delete_folder' }), /Falta el campo folder_id/);
  });

  test('validateRequest acepta 20 etiquetas de 40 caracteres y rechaza una acción desconocida', () => {
    const tags = Array.from({ length: 20 }, (_, index) => `${String(index).padStart(2, '0')}${'y'.repeat(38)}`);
    assert.equal(validateRequest({ action: 'organize', payload: { op: 'edit_song', song_id: SONG, tags } }), null);
    assert.match(validateRequest({ action: 'desconocida' }), /acción no es válida/);
    assert.match(validateRequest(null), /no es válida/);
  });
});

describe('identificadores y campos de texto', () => {
  test('la canción y la carpeta tienen la forma exacta del backend', () => {
    assert.equal(isSongId(SONG), true);
    assert.equal(isSongId('S0123456789ABCDEF'), false);
    assert.equal(isSongId('S0123456789abcde'), false);
    assert.equal(isFolderId(FOLDER), true);
    assert.equal(isFolderId('0123456789a'), false);
  });

  test('las etiquetas se normalizan: minúsculas, sin repetir ni vacías', () => {
    assert.deepEqual(normalizeTags([' Jazz ', 'jazz', '', 'Años 20']), ['jazz', 'años 20']);
    assert.deepEqual(normalizeTags('no es una lista'), []);
  });
});

describe('formulario de importación evaluado (lógica de la hoja)', () => {
  test('importar por URL: el formulario vale con una URL de Internet Archive', () => {
    const result = evaluateImportForm({ url: 'https://archive.org/details/ejemplo-de-prueba', license: '', title: '' });
    assert.deepEqual(result.errors, {});
    assert.equal(result.request.action, 'import');
    assert.match(buildIssueBody(result.request), /^action: import\nurl: https:\/\/archive\.org\/details\/ejemplo-de-prueba$/);
  });

  test('importar por URL: un fichero directo sin licencia marca el campo licencia', () => {
    const result = evaluateImportForm({ url: 'https://ejemplo.org/a.wav', license: '   ', title: '' });
    assert.equal(result.request, null);
    assert.deepEqual(Object.keys(result.errors), ['license']);
  });
});

describe('título y enlace de la incidencia', () => {
  test('el título describe la petición y no pasa de 120 caracteres', () => {
    assert.equal(buildIssueTitle({ action: 'import', url: 'https://archive.org/details/x', title: 'Charleston' }), 'Importar audio: Charleston');
    assert.equal(buildIssueTitle({ action: 'organize', payload: { op: 'edit_song', song_id: SONG, public: true } }), `Publicar la canción ${SONG}`);
    assert.equal(buildIssueTitle({ action: 'organize', payload: { op: 'edit_song', song_id: SONG, public: false } }), `Despublicar la canción ${SONG}`);
    assert.equal(buildIssueTitle({ action: 'organize', payload: { op: 'delete_folder', folder_id: FOLDER } }), `Borrar el álbum ${FOLDER}`);
    const long = buildIssueTitle({ action: 'import', url: `https://ejemplo.org/${'a'.repeat(300)}.mp3`, license: 'x' });
    assert.equal([...long].length, REQUEST_LIMITS.issueTitle);
    assert.ok(long.endsWith('…'));
  });

  test('el enlace usa el repositorio y la etiqueta biblioteca, y codifica el título y el cuerpo', () => {
    const body = 'action: import\nurl: https://archive.org/details/x?a=1&b=2#c';
    const url = buildIssueUrl('Importar & medir = 100%', body);
    assert.ok(url.startsWith('https://github.com/seryi47/reminiscencia/issues/new?labels=biblioteca&title='));
    const params = new URL(url).searchParams;
    assert.equal(params.get('labels'), 'biblioteca');
    assert.equal(params.get('title'), 'Importar & medir = 100%');
    assert.equal(params.get('body'), body);
  });

  test('un enlace construido desde una petición válida conserva el cuerpo exacto', () => {
    const request = evaluateImportForm({ url: 'https://ejemplo.org/a.mp3', license: 'CC BY 4.0', title: 'Tema' }).request;
    const body = buildIssueBody(request);
    const url = buildIssueUrl(buildIssueTitle(request), body);
    assert.equal(new URL(url).searchParams.get('body'), body);
    assert.deepEqual(parseLikeBackend(new URL(url).searchParams.get('body')), {
      action: 'import', url: 'https://ejemplo.org/a.mp3', license: 'CC BY 4.0', title: 'Tema',
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Edición de canciones y álbumes (hojas de js/views/edit.js)
// ---------------------------------------------------------------------------------------------

describe('edición de canciones y álbumes', () => {
  const NEW_FOLDER = 'F0123456789abcdef';
  const payloadOf = (url) => {
    const fields = parseLikeBackend(new URL(url).searchParams.get('body'));
    assert.equal(fields.action, 'organize');
    return JSON.parse(fields.payload);
  };

  test('«Editar detalles» de una canción: edit_song con title y artist', () => {
    const payload = { op: 'edit_song', song_id: SONG, title: 'Charleston', artist: 'Orquesta de prueba' };
    assert.equal(validateOperation(payload), null);
    const url = buildOrganizeIssueUrl(payload);
    assert.deepEqual(payloadOf(url), payload);
    assert.equal(new URL(url).searchParams.get('labels'), 'biblioteca');
    assert.equal(new URL(url).searchParams.get('title'), `Editar la canción ${SONG}`);
  });

  test('«Editar detalles» de un álbum: edit_folder con name y artist, en los dos formatos de identificador', () => {
    for (const folderId of [NEW_FOLDER, FOLDER]) {
      const payload = { op: 'edit_folder', folder_id: folderId, name: 'Valses', artist: '' };
      assert.equal(validateOperation(payload), null, folderId);
      assert.deepEqual(payloadOf(buildOrganizeIssueUrl(payload)), payload);
      assert.equal(buildIssueTitle({ action: 'organize', payload }), `Editar el álbum ${folderId}`);
    }
    assert.match(validateOperation({ op: 'edit_folder', folder_id: NEW_FOLDER }), /al menos un campo que cambiar en el álbum/);
    assert.match(validateOperation({ op: 'edit_folder', name: 'Valses' }), /Falta el campo folder_id/);
    assert.match(validateOperation({ op: 'edit_folder', folder_id: NEW_FOLDER, name: 'x', cover: 'covers/x.jpg' }), /no está permitido/);
  });

  test('«Añadir a un álbum»: edit_song con folder_id (o null para sacarla del álbum)', () => {
    const add = { op: 'edit_song', song_id: SONG, folder_id: NEW_FOLDER };
    assert.equal(validateOperation(add), null);
    assert.equal(buildIssueTitle({ action: 'organize', payload: add }), `Añadir la canción ${SONG} al álbum ${NEW_FOLDER}`);
    const out = { op: 'edit_song', song_id: SONG, folder_id: null };
    assert.equal(validateOperation(out), null);
    assert.equal(buildIssueTitle({ action: 'organize', payload: out }), `Quitar la canción ${SONG} de su álbum`);
    assert.deepEqual(payloadOf(buildOrganizeIssueUrl(out)), out);
  });

  test('«Crear álbum»: create_folder con name y artist opcional', () => {
    assert.equal(validateOperation({ op: 'create_folder', name: 'Valses', artist: 'Orquesta de prueba' }), null);
    assert.equal(validateOperation({ op: 'create_folder', name: 'Valses' }), null);
    assert.equal(buildIssueTitle({ action: 'organize', payload: { op: 'create_folder', name: 'Valses' } }), 'Crear el álbum «Valses»');
  });

  test('buildOrganizeIssueUrl no prepara una petición que el backend rechazaría', () => {
    assert.throws(() => buildOrganizeIssueUrl({ op: 'edit_folder', folder_id: NEW_FOLDER, name: '' }), /no puede quedar en blanco/);
    assert.throws(() => buildOrganizeIssueUrl({ op: 'edit_song', song_id: 'L0011223344556677', title: 'x' }), /identificador de la canción/);
  });

  test('los textos de cada campo se validan por separado para marcar el campo de la hoja', () => {
    assert.equal(folderNameProblem('Valses'), null);
    assert.match(folderNameProblem(' '), /nombre del álbum no puede quedar en blanco/);
    assert.match(folderArtistProblem('x'.repeat(81)), /artista del álbum no puede tener más de 80/);
    assert.equal(songTitleProblem('Charleston'), null);
    assert.match(songArtistProblem('a\nb'), /saltos de línea/);
  });

  test('«Cambiar portada» abre el buzón de portadas y solo vale para canciones y álbumes F', () => {
    assert.equal(COVER_UPLOAD_URL, 'https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon/portadas');
    assert.deepEqual({ ...COVER_RULES }, { formats: 'JPG, PNG o WebP', maxMb: 10, size: 640 });
    assert.equal(isCoverFolderId(NEW_FOLDER), true);
    assert.equal(isCoverFolderId(FOLDER), false);
    assert.equal(isFolderId(NEW_FOLDER), true);
    assert.equal(isFolderId(FOLDER), true);
  });

  test('el aviso de las hojas pide permiso de escritura y dice cuándo llega el cambio', () => {
    assert.match(EDIT_NOTE, /permiso de escritura en el repositorio/);
    assert.match(EDIT_NOTE, /llega a todos en un par de minutos/);
  });
});
