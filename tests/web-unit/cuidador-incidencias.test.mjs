// Pruebas de las incidencias de la biblioteca (cuidador, C-a2): validaciones, cuerpo y enlace de GitHub.
// El cuerpo se comprueba con un analizador que replica _read_fields de backend/sonidos/issue_request.py, para
// que una petición que pasa aquí sea una petición que el backend acepta. Todos los datos son ficticios.
// Ejecución: node --test tests/web-unit/cuidador-incidencias.test.mjs

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildImportRequest,
  buildIssueBody,
  buildIssueTitle,
  buildIssueUrl,
  checkFolderInput,
  checkSongIdInput,
  checkTagsInput,
  checkTextInput,
  checkYearInput,
  classifyUrl,
  evaluateEditForm,
  evaluateFolderForm,
  evaluateImportForm,
  evaluatePublishForm,
  isFolderId,
  isSongId,
  normalizeFolderId,
  normalizeSongId,
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

  test('las carpetas: nombre obligatorio, identificadores de 10 caracteres y parent_id opcional', () => {
    assert.equal(validateOperation({ op: 'create_folder', name: 'Años 20', parent_id: null }), null);
    assert.equal(validateOperation({ op: 'create_folder', name: 'Años 20' }), null);
    assert.match(validateOperation({ op: 'create_folder', name: '   ' }), /no puede quedar en blanco/);
    assert.equal(validateOperation({ op: 'rename_folder', folder_id: FOLDER, name: 'Nueva' }), null);
    assert.match(validateOperation({ op: 'rename_folder', folder_id: 'ABC', name: 'Nueva' }), /identificador de la carpeta no es válido/);
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

  test('se aceptan la s minúscula y las letras en mayúscula, y se devuelve la forma canónica', () => {
    assert.equal(normalizeSongId('  s0123456789ABCDEF '), 'S0123456789abcdef');
    assert.equal(normalizeFolderId(' 0123ABCDEF '), '0123abcdef');
    assert.deepEqual(checkSongIdInput('s0123456789ABCDEF'), { value: SONG, message: null });
    assert.match(checkSongIdInput('').message, /Escribe el identificador/);
    assert.match(checkSongIdInput('S12').message, /16 caracteres hexadecimales/);
    assert.deepEqual(checkFolderInput(''), { value: null, message: null });
    assert.match(checkFolderInput('', { required: true }).message, /Escribe el identificador de la carpeta/);
  });

  test('el texto de una sola línea no admite control ni se queda en blanco si es obligatorio', () => {
    assert.match(checkTextInput('   ', { name: 'El título', max: 200, required: true }).message, /no puede quedar en blanco/);
    assert.match(checkTextInput('a\u0007b', { name: 'El título', max: 200 }).message, /caracteres de control/);
    assert.equal(checkTextInput('  Charleston  ', { name: 'El título', max: 200 }).value, 'Charleston');
  });

  test('el año vacío es null; un número fuera de rango o con letras no vale', () => {
    assert.deepEqual(checkYearInput(''), { value: null, message: null });
    assert.deepEqual(checkYearInput(' 1974 '), { value: 1974, message: null });
    assert.match(checkYearInput('999').message, /entre 1000 y 2100/);
    assert.match(checkYearInput('2101').message, /entre 1000 y 2100/);
    assert.match(checkYearInput('19a4').message, /entre 1000 y 2100/);
  });

  test('las etiquetas se normalizan: minúsculas, sin repetir ni vacías', () => {
    assert.deepEqual(normalizeTags([' Jazz ', 'jazz', '', 'Años 20']), ['jazz', 'años 20']);
    assert.deepEqual(checkTagsInput(' Jazz,, jazz ,Vals ').value, ['jazz', 'vals']);
    assert.deepEqual(checkTagsInput('').value, []);
    const tooMany = Array.from({ length: 21 }, (_, index) => `t${index}`).join(',');
    assert.match(checkTagsInput(tooMany).message, /como máximo 20/);
    assert.match(checkTagsInput('a'.repeat(41)).message, /como máximo 40/);
  });
});

describe('formularios evaluados (lógica de la hoja)', () => {
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

  test('publicar o despublicar: genera la operación con el interruptor', () => {
    assert.deepEqual(evaluatePublishForm({ songId: SONG, published: true }).request,
      { action: 'organize', payload: { op: 'edit_song', song_id: SONG, public: true } });
    assert.deepEqual(evaluatePublishForm({ songId: 's0123456789abcdef', published: false }).request.payload,
      { op: 'edit_song', song_id: SONG, public: false });
    assert.match(evaluatePublishForm({ songId: 'nope' }).errors.songId, /16 caracteres/);
  });

  test('editar datos: sin cambios no hay petición y se indica qué falta', () => {
    const baseline = { id: SONG, title: 'Charleston', artist: '', year: null, tags: ['jazz'], folder_id: null };
    const result = evaluateEditForm({ songId: SONG, baseline, title: 'Charleston', artist: '', year: '', tags: 'jazz', folderId: '' });
    assert.equal(result.request, null);
    assert.match(result.status, /al menos un campo/);
  });

  test('editar datos: solo se envían los campos que cambian, y vaciar la carpeta envía null', () => {
    const baseline = { id: SONG, title: 'Charleston', artist: '', year: null, tags: ['jazz'], folder_id: FOLDER };
    const result = evaluateEditForm({ songId: SONG, baseline, title: 'Charleston', artist: 'Banda de prueba', year: '1925', tags: 'jazz', folderId: '' });
    assert.deepEqual(result.request.payload, {
      op: 'edit_song', song_id: SONG, artist: 'Banda de prueba', year: 1925, folder_id: null,
    });
  });

  test('editar datos: con la canción conocida, el título no puede quedar en blanco', () => {
    const baseline = { id: SONG, title: 'Charleston', artist: '', year: null, tags: [], folder_id: null };
    const result = evaluateEditForm({ songId: SONG, baseline, title: '  ', artist: '', year: '', tags: '', folderId: '' });
    assert.equal(result.request, null);
    assert.match(result.errors.title, /no puede quedar en blanco/);
  });

  test('editar datos de una canción desconocida: solo los campos con valor', () => {
    const result = evaluateEditForm({ songId: OTHER_SONG, baseline: null, title: '', artist: 'Artista de prueba', year: '', tags: 'Jazz', folderId: '' });
    assert.deepEqual(result.request.payload, { op: 'edit_song', song_id: OTHER_SONG, artist: 'Artista de prueba', tags: ['jazz'] });
  });

  test('carpetas: crear envía parent_id null; renombrar y borrar piden el identificador', () => {
    assert.deepEqual(evaluateFolderForm({ action: 'create', name: 'Años 20' }).request.payload,
      { op: 'create_folder', name: 'Años 20', parent_id: null });
    assert.deepEqual(evaluateFolderForm({ action: 'rename', folderId: FOLDER, name: 'Años veinte' }).request.payload,
      { op: 'rename_folder', folder_id: FOLDER, name: 'Años veinte' });
    assert.deepEqual(evaluateFolderForm({ action: 'delete', folderId: FOLDER }).request.payload,
      { op: 'delete_folder', folder_id: FOLDER });
    assert.match(evaluateFolderForm({ action: 'rename', folderId: '', name: 'X' }).errors.folderId, /Escribe el identificador/);
    assert.match(evaluateFolderForm({ action: 'create', name: '' }).errors.name, /no puede quedar en blanco/);
  });
});

describe('título y enlace de la incidencia', () => {
  test('el título describe la petición y no pasa de 120 caracteres', () => {
    assert.equal(buildIssueTitle({ action: 'import', url: 'https://archive.org/details/x', title: 'Charleston' }), 'Importar audio: Charleston');
    assert.equal(buildIssueTitle({ action: 'organize', payload: { op: 'edit_song', song_id: SONG, public: true } }), `Publicar la canción ${SONG}`);
    assert.equal(buildIssueTitle({ action: 'organize', payload: { op: 'edit_song', song_id: SONG, public: false } }), `Despublicar la canción ${SONG}`);
    assert.equal(buildIssueTitle({ action: 'organize', payload: { op: 'delete_folder', folder_id: FOLDER } }), `Borrar la carpeta ${FOLDER}`);
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

  test('una petición de organize del formulario de canción pasa el analizador del backend', () => {
    const baseline = { id: SONG, title: 'Charleston', artist: '', year: null, tags: [], folder_id: null };
    const request = evaluateEditForm({ songId: SONG, baseline, title: 'Charleston', artist: 'Banda', year: '1925', tags: 'jazz, años 20', folderId: FOLDER }).request;
    const fields = parseLikeBackend(buildIssueBody(request));
    assert.equal(fields.action, 'organize');
    assert.deepEqual(JSON.parse(fields.payload), {
      op: 'edit_song', song_id: SONG, artist: 'Banda', year: 1925, tags: ['jazz', 'años 20'], folder_id: FOLDER,
    });
  });
});
