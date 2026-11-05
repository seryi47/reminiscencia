// Hojas de edición, con el aspecto del «Editar detalles» de Spotify (portada a la izquierda, campos a la derecha).
// Cada hoja valida la petición con las reglas del backend (js/cuidador/incidencias.js) y la guarda con «Guardar»:
// POST /api/editar abre la incidencia «biblioteca» o guarda la portada con el token del servidor, sin pasar por GitHub
// (ADR-0022; ADR-0008 sigue valiendo para el procesado).
// - «Editar detalles» de una canción: {"op":"edit_song","song_id","title","artist"}.
// - «Editar detalles» de un álbum: {"op":"edit_folder","folder_id","name","artist"}.
// - «Añadir a un álbum»: {"op":"edit_song","song_id","folder_id"} (null: sin álbum).
// - «Quitar de este álbum» (menú de una canción en la página de su álbum): {"op":"edit_song","song_id","folder_id":null}.
//   La canción sigue en la biblioteca; solo deja de estar en el álbum.
// - «Añadir canciones» a un álbum (buscador con casillas): {"op":"move_songs","song_ids":[…],"folder_id"}, una sola
//   petición para todas las elegidas (de 1 a 100).
// - Selección múltiple en un álbum: «Quitar del álbum» ({"op":"move_songs","song_ids":[…],"folder_id":null}, con
//   confirmación) y «Mover a otro álbum» ({"op":"move_songs","song_ids":[…],"folder_id":"F…"}). Una petición por acción.
// - «Ordenar canciones» de un álbum: {"op":"order_album","folder_id","song_ids":[…]} con la lista completa del álbum en
//   el orden nuevo (de 1 a 190; ADR-0026). Subir y bajar con botones, accesibles con el teclado.
// - «Crear álbum»: {"op":"create_folder","name","artist"} (artist solo si se escribe).
// - «Cambiar portada»: se elige una imagen, se recorta a 640 px y se guarda en el buzón de portadas.
// Las listas propias se editan aquí mismo (nombre, descripción y portada), solo en este navegador.

import { COVER_INPUT_ACCEPT, coverFileProblem, resizeCoverFile } from '../cover-image.js';
import { songsInFolder, songsToAddToAlbum } from '../catalog.js';
import { dataUrlToBytes, saveCover, saveOrganize } from '../edit-remote.js';
import {
  COVER_RULES,
  folderArtistProblem,
  folderNameProblem,
  isCoverFolderId,
  REQUEST_LIMITS,
  songArtistProblem,
  songTitleProblem,
  validateOperation,
} from '../cuidador/incidencias.js';
import { PLAYLIST_DESCRIPTION_MAX, PLAYLIST_NAME_MAX, validatePlaylistDescription, validatePlaylistName } from '../local-library.js';
import { el, openDialog, toast, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { contextCover, songCoverNode } from './components.js';

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------

/** Campo con etiqueta, error asociado y contador opcional. */
function field({ key, label, value = '', maxLength, multiline = false, placeholder = '', testid }) {
  const id = uid(`campo-${key}`);
  const errorId = `${id}-error`;
  const input = el(multiline ? 'textarea' : 'input', {
    id,
    class: `text-field${multiline ? ' text-area' : ''}`,
    type: multiline ? null : 'text',
    rows: multiline ? '4' : null,
    autocomplete: 'off',
    maxlength: maxLength ? String(maxLength) : null,
    placeholder,
    'data-testid': testid,
  });
  input.value = value;
  const error = el('p', { id: errorId, class: 'field-error', hidden: true });
  const wrapper = el('div', { class: `field field-${key}` }, el('label', { class: 'field-label', for: id }, label), input, error);
  return {
    input,
    wrapper,
    touched: false,
    setError(message) {
      error.textContent = message ?? '';
      error.hidden = !message;
      if (message) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', errorId);
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
    },
  };
}

/**
 * Botón «Guardar» (blanco), desactivado hasta que la petición vale, y su región de estado. save(payload) guarda; con
 * éxito se avisa y se cierra la hoja, y si falla el motivo queda a la vista y se puede reintentar. Mientras guarda, el
 * botón está desactivado (sin dobles envíos). label: texto del botón.
 */
function saveAction(testid, close, save = saveOrganize, label = 'Guardar') {
  const button = el('button', {
    type: 'button',
    class: 'button button-light edit-submit',
    'aria-disabled': 'true',
    'data-testid': testid,
  }, label);
  const status = el('p', { class: 'edit-status', role: 'status', 'data-testid': `${testid}-status` });
  let payload = null;
  let saving = false;
  button.addEventListener('click', async () => {
    if (saving || button.getAttribute('aria-disabled') === 'true') return;
    saving = true;
    button.setAttribute('aria-disabled', 'true');
    status.textContent = 'Guardando…';
    try {
      const message = await save(payload);
      toast(message);
      close();
    } catch (error) {
      saving = false;
      // Si mientras tanto la petición dejó de valer (blocked), el botón sigue desactivado.
      button.setAttribute('aria-disabled', payload === null ? 'true' : 'false');
      status.textContent = error instanceof Error ? error.message : 'No se ha podido guardar.';
    }
  });
  return {
    button,
    status,
    ready(next) {
      payload = next;
      if (saving) return;
      button.setAttribute('aria-disabled', 'false');
      status.textContent = 'Listo para guardar.';
    },
    blocked(message) {
      payload = null;
      button.setAttribute('aria-disabled', 'true');
      status.textContent = message;
    },
  };
}

function editNote() {
  return el('p', { class: 'edit-note', 'data-testid': 'edit-note' },
    'El cambio se guarda desde aquí, sin pasar por GitHub, y llega a todos en un par de minutos.');
}

/**
 * Hoja que prepara una incidencia con campos de texto. fields: [{ key, label, value, maxLength, problem }].
 * build(values) devuelve el payload; changed(values) dice si hay algo que cambiar.
 */
function textIssueSheet(ctx, { title, testid, coverNode = null, coverAction = null, fields, build, changed }) {
  return openDialog({
    title,
    testid,
    className: 'dialog-edit',
    render: (body, close) => {
      const items = fields.map((spec) => ({ spec, ...field({ ...spec, testid: `${testid}-${spec.key}` }) }));
      const submit = saveAction(`${testid}-save`, close);
      const values = () => Object.fromEntries(items.map((item) => [item.spec.key, item.input.value.trim()]));
      const refresh = () => {
        const current = values();
        let invalid = false;
        for (const item of items) {
          const problem = item.spec.problem(current[item.spec.key]);
          if (problem) invalid = true;
          item.setError(problem && (item.touched || item.input.value !== '') ? problem : null);
        }
        if (invalid) return submit.blocked('Revisa los campos marcados.');
        if (!changed(current)) return submit.blocked('Cambia algún dato para preparar la petición.');
        const payload = build(current);
        const problem = validateOperation(payload);
        if (problem) return submit.blocked(problem);
        try {
          return submit.ready(payload);
        } catch (error) {
          return submit.blocked(error instanceof Error ? error.message : 'La petición no es válida.');
        }
      };
      for (const item of items) {
        item.input.addEventListener('input', refresh);
        item.input.addEventListener('blur', () => { item.touched = true; refresh(); });
      }
      refresh();
      const coverColumn = coverNode
        ? el('div', { class: 'edit-cover' }, coverNode,
          coverAction ? el('button', {
            type: 'button',
            class: 'button button-text edit-cover-action',
            'data-testid': `${testid}-cover`,
            on: { click: () => { close(); coverAction(); } },
          }, icon('image', { size: 16 }), 'Cambiar portada') : null)
        : null;
      body.append(
        el('div', { class: `edit-grid${coverColumn ? '' : ' no-cover'}` }, coverColumn, el('div', { class: 'edit-fields' }, items.map((item) => item.wrapper))),
        editNote(),
        el('div', { class: 'dialog-actions' }, submit.status, submit.button));
    },
    initialFocus: (dialog) => dialog.querySelector('.text-field'),
  });
}

// ---------------------------------------------------------------------------
// Canciones y álbumes (incidencias)
// ---------------------------------------------------------------------------

/** «Editar detalles» de una canción pública: título y artista. */
export function openEditSongSheet(ctx, song) {
  return textIssueSheet(ctx, {
    title: 'Editar detalles',
    testid: 'edit-song',
    coverNode: songCoverNode(ctx, song, 'edit-cover-image'),
    coverAction: () => openCoverSheet(ctx, { kind: 'song', id: song.id, name: song.title }),
    fields: [
      { key: 'title', label: 'Título', value: song.title, maxLength: REQUEST_LIMITS.title, problem: songTitleProblem },
      { key: 'artist', label: 'Artista', value: song.artist, maxLength: REQUEST_LIMITS.artist, problem: songArtistProblem },
    ],
    changed: (values) => values.title !== song.title || values.artist !== song.artist,
    build: (values) => ({ op: 'edit_song', song_id: song.id, title: values.title, artist: values.artist }),
  });
}

/** «Editar detalles» de un álbum: nombre y artista. */
export function openEditAlbumSheet(ctx, folder) {
  const context = ctx.albumContext(folder);
  return textIssueSheet(ctx, {
    title: 'Editar detalles',
    testid: 'edit-album',
    coverNode: contextCover(context, 'edit-cover-image'),
    coverAction: isCoverFolderId(folder.id) ? () => openCoverSheet(ctx, { kind: 'album', id: folder.id, name: folder.name }) : null,
    fields: [
      { key: 'name', label: 'Nombre', value: folder.name, maxLength: REQUEST_LIMITS.folderName, problem: folderNameProblem },
      { key: 'artist', label: 'Artista', value: folder.artist, maxLength: REQUEST_LIMITS.folderArtist, problem: folderArtistProblem },
    ],
    changed: (values) => values.name !== folder.name || values.artist !== folder.artist,
    build: (values) => ({ op: 'edit_folder', folder_id: folder.id, name: values.name, artist: values.artist }),
  });
}

/** «Crear álbum»: nombre y artista (opcional). */
export function openCreateAlbumSheet(ctx) {
  return textIssueSheet(ctx, {
    title: 'Crear álbum',
    testid: 'create-album',
    coverNode: el('div', { class: 'cover edit-cover-image cover-empty', 'aria-hidden': 'true' }, icon('album', { size: 48, className: 'cover-icon' })),
    fields: [
      { key: 'name', label: 'Nombre', value: '', maxLength: REQUEST_LIMITS.folderName, problem: folderNameProblem },
      { key: 'artist', label: 'Artista (opcional)', value: '', maxLength: REQUEST_LIMITS.folderArtist, problem: folderArtistProblem },
    ],
    changed: (values) => values.name !== '',
    build: (values) => (values.artist === ''
      ? { op: 'create_folder', name: values.name }
      : { op: 'create_folder', name: values.name, artist: values.artist }),
  });
}

/** «Añadir a un álbum»: elegir el álbum de una canción (o ninguno). */
export function openMoveToAlbumSheet(ctx, song) {
  const albums = [...ctx.state.catalog.folders].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return openDialog({
    title: 'Añadir a un álbum',
    testid: 'move-album',
    className: 'dialog-edit',
    render: (body, close) => {
      const submit = saveAction('move-album-save', close);
      const name = uid('album');
      const option = (value, label, detail) => el('label', { class: 'radio-row', 'data-testid': 'move-album-option' },
        el('input', { type: 'radio', name, value, checked: (song.folderId ?? '') === value ? true : null }),
        el('span', { class: 'radio-text' }, el('span', { class: 'radio-label' }, label), detail ? el('span', { class: 'radio-detail' }, detail) : null));
      const group = el('fieldset', { class: 'radio-group' },
        el('legend', { class: 'field-label' }, `Álbum de «${song.title}»`),
        albums.map((folder) => option(folder.id, folder.name, folder.artist || null)),
        option('', 'Sin álbum', 'La canción queda fuera de cualquier álbum.'));
      const refresh = () => {
        const picked = group.querySelector('input:checked')?.value ?? null;
        if (picked === null) return submit.blocked('Elige un álbum.');
        const folderId = picked === '' ? null : picked;
        if (folderId === (song.folderId ?? null)) return submit.blocked('La canción ya está en ese álbum. Elige otro.');
        const payload = { op: 'edit_song', song_id: song.id, folder_id: folderId };
        const problem = validateOperation(payload);
        return problem ? submit.blocked(problem) : submit.ready(payload);
      };
      group.addEventListener('change', refresh);
      refresh();
      body.append(
        el('div', { class: 'edit-grid' },
          el('div', { class: 'edit-cover' }, songCoverNode(ctx, song, 'edit-cover-image')),
          el('div', { class: 'edit-fields' }, group,
            el('p', { class: 'field-help' }, 'Para un álbum nuevo, usa «Crear» › «Álbum» en Tu biblioteca.'))),
        editNote(),
        el('div', { class: 'dialog-actions' }, submit.status, submit.button));
    },
    initialFocus: (dialog) => dialog.querySelector('input:checked') ?? dialog.querySelector('input'),
  });
}

/**
 * «Quitar de este álbum»: confirma y saca la canción de su álbum (edit_song con folder_id null). Nunca la borra: la
 * canción sigue en la biblioteca.
 */
export function openRemoveFromAlbumSheet(ctx, song, folder) {
  return openDialog({
    title: 'Quitar de este álbum',
    testid: 'remove-from-album',
    className: 'dialog-edit',
    render: (body, close) => {
      const submit = saveAction('remove-from-album-save', close, saveOrganize, 'Quitar');
      const payload = { op: 'edit_song', song_id: song.id, folder_id: null };
      const problem = song.folderId === folder.id ? validateOperation(payload) : 'La canción ya no está en este álbum.';
      if (problem) {
        submit.blocked(problem);
      } else {
        submit.ready(payload);
        submit.status.textContent = '';
      }
      body.append(
        el('p', { class: 'dialog-text', 'data-testid': 'remove-from-album-text' },
          `¿Quitar «${song.title}» de «${folder.name}»? La canción sigue en la biblioteca; solo deja de estar en este álbum.`),
        editNote(),
        el('div', { class: 'dialog-actions' }, submit.status,
          el('button', {
            type: 'button',
            class: 'button button-secondary',
            'data-testid': 'remove-from-album-cancel',
            on: { click: () => close() },
          }, 'Cancelar'),
          submit.button));
    },
    initialFocus: (dialog) => dialog.querySelector('[data-testid="remove-from-album-cancel"]'),
  });
}

// Filas que se pintan a la vez en «Añadir canciones»; con más, se pide afinar la búsqueda.
const ADD_TO_ALBUM_VISIBLE = 50;

/**
 * «Añadir canciones» a un álbum: buscador (sin acentos ni mayúsculas, por título, artista y álbum actual) y casillas
 * para elegir varias canciones del catálogo que aún no están en el álbum. La selección se mantiene al cambiar la
 * búsqueda. «Añadir (N)» envía una sola petición move_songs con todas (de 1 a 100).
 */
export function openAddSongsToAlbumSheet(ctx, folder) {
  const max = REQUEST_LIMITS.moveSongs;
  const albumNameOf = (song) => (song.folderId ? ctx.folderName(song.folderId) ?? '' : '');
  const options = { isEditable: (song) => ctx.isEditableSong(song), albumNameOf };
  const available = songsToAddToAlbum(ctx.state.catalog.songs, folder.id, '', options);
  return openDialog({
    title: 'Añadir canciones',
    testid: 'album-add',
    className: 'dialog-edit',
    render: (body, close) => {
      const selected = new Set();
      const submit = saveAction('album-add-save', close, saveOrganize, 'Añadir (0)');
      const inputId = uid('anadir-al-album');
      const input = el('input', {
        id: inputId,
        class: 'search-input search-input-small',
        type: 'search',
        placeholder: 'Busca por título, artista o álbum',
        autocomplete: 'off',
        enterkeyhint: 'search',
        'data-testid': 'album-add-search',
      });
      const count = el('p', { class: 'pick-count', 'aria-live': 'polite', 'data-testid': 'album-add-count' });
      const list = el('ul', { class: 'pick-list', 'aria-label': `Canciones para añadir a ${folder.name}`, 'data-testid': 'album-add-results' });

      const refresh = () => {
        const total = selected.size;
        submit.button.textContent = `Añadir (${total})`;
        count.textContent = total === 0
          ? 'Ninguna canción elegida.'
          : `${total} ${total === 1 ? 'canción elegida' : 'canciones elegidas'}.`;
        if (total === 0) return submit.blocked('Elige al menos una canción.');
        if (total > max) return submit.blocked(`Como mucho ${max} canciones de una vez: quita ${total - max}.`);
        const payload = { op: 'move_songs', song_ids: [...selected], folder_id: folder.id };
        const problem = validateOperation(payload);
        return problem ? submit.blocked(problem) : submit.ready(payload);
      };

      const row = (song) => {
        const boxId = `${inputId}-${song.id}`;
        const box = el('input', {
          type: 'checkbox',
          id: boxId,
          checked: selected.has(song.id) ? true : null,
          'data-testid': 'album-add-check',
          'data-song-id': song.id,
        });
        box.addEventListener('change', () => {
          if (box.checked) selected.add(song.id);
          else selected.delete(song.id);
          refresh();
        });
        return el('li', {},
          el('label', { class: 'add-row pick-row', for: boxId, 'data-testid': 'album-add-option', 'data-song-id': song.id },
            box,
            songCoverNode(ctx, song, 'track-cover'),
            el('span', { class: 'track-text' },
              el('span', { class: 'add-title' }, song.title),
              el('span', { class: 'track-artist' }, ctx.artistOf(song))),
            el('span', { class: 'add-album' }, albumNameOf(song) || 'Sin álbum')));
      };

      const paint = () => {
        const found = songsToAddToAlbum(available, folder.id, input.value, options);
        const rows = found.slice(0, ADD_TO_ALBUM_VISIBLE).map(row);
        if (available.length === 0) {
          rows.push(el('li', { class: 'empty-text', 'data-testid': 'album-add-empty' }, 'No hay más canciones que añadir: todas están ya en este álbum.'));
        } else if (found.length === 0) {
          rows.push(el('li', { class: 'empty-text', 'data-testid': 'album-add-empty' }, `Ninguna canción coincide con «${input.value.trim()}».`));
        } else if (found.length > ADD_TO_ALBUM_VISIBLE) {
          rows.push(el('li', { class: 'empty-text' }, `Se ven ${ADD_TO_ALBUM_VISIBLE} de ${found.length}. Escribe para afinar la búsqueda.`));
        }
        list.replaceChildren(...rows);
      };

      input.addEventListener('input', paint);
      paint();
      refresh();
      body.append(
        el('div', { class: 'search-form search-form-small pick-search' },
          el('label', { for: inputId, class: 'sr-only' }, `Buscar canciones para añadir a ${folder.name}`),
          el('span', { class: 'search-icon', 'aria-hidden': 'true' }, icon('search', { size: 18 })),
          input),
        count,
        list,
        editNote(),
        el('div', { class: 'dialog-actions' }, submit.status, submit.button));
    },
    initialFocus: (dialog) => dialog.querySelector('[data-testid="album-add-search"]'),
  });
}

const songsText = (count) => (count === 1 ? '1 canción' : `${count} canciones`);

/**
 * «Quitar del álbum» de la selección múltiple: confirma y saca las canciones elegidas de su álbum con una sola petición
 * move_songs (folder_id null). Nunca las borra. onDone: se llama al guardar (para salir del modo «Seleccionar»).
 */
export function openRemoveSongsFromAlbumSheet(ctx, folder, songIds, { onDone = () => {} } = {}) {
  const ids = [...songIds];
  return openDialog({
    title: 'Quitar del álbum',
    testid: 'album-remove-many',
    className: 'dialog-edit',
    render: (body, close) => {
      const submit = saveAction('album-remove-many-save', () => { onDone(); close(); }, saveOrganize, 'Quitar');
      const payload = { op: 'move_songs', song_ids: ids, folder_id: null };
      const problem = ids.length > REQUEST_LIMITS.moveSongs
        ? `Como mucho ${REQUEST_LIMITS.moveSongs} canciones de una vez: quita ${ids.length - REQUEST_LIMITS.moveSongs} de la selección.`
        : validateOperation(payload);
      if (problem) {
        submit.blocked(problem);
      } else {
        submit.ready(payload);
        submit.status.textContent = '';
      }
      body.append(
        el('p', { class: 'dialog-text', 'data-testid': 'album-remove-many-text' },
          `¿Quitar ${songsText(ids.length)} de «${folder.name}»? Siguen en la biblioteca; solo dejan de estar en este álbum.`),
        editNote(),
        el('div', { class: 'dialog-actions' }, submit.status,
          el('button', {
            type: 'button',
            class: 'button button-secondary',
            'data-testid': 'album-remove-many-cancel',
            on: { click: () => close() },
          }, 'Cancelar'),
          submit.button));
    },
    initialFocus: (dialog) => dialog.querySelector('[data-testid="album-remove-many-cancel"]'),
  });
}

/**
 * «Mover a otro álbum» de la selección múltiple: se elige el álbum y se envía una sola petición move_songs con todas
 * las canciones elegidas.
 */
export function openMoveSongsToAlbumSheet(ctx, folder, songIds, { onDone = () => {} } = {}) {
  const ids = [...songIds];
  const albums = ctx.state.catalog.folders
    .filter((item) => item.id !== folder.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return openDialog({
    title: 'Mover a otro álbum',
    testid: 'album-move-many',
    className: 'dialog-edit',
    render: (body, close) => {
      const submit = saveAction('album-move-many-save', () => { onDone(); close(); }, saveOrganize, 'Mover');
      const name = uid('destino');
      const group = el('fieldset', { class: 'radio-group' },
        el('legend', { class: 'field-label' }, `Álbum para ${songsText(ids.length)} de «${folder.name}»`),
        albums.map((album) => el('label', { class: 'radio-row', 'data-testid': 'album-move-many-option', 'data-folder-id': album.id },
          el('input', { type: 'radio', name, value: album.id }),
          el('span', { class: 'radio-text' },
            el('span', { class: 'radio-label' }, album.name),
            album.artist ? el('span', { class: 'radio-detail' }, album.artist) : null))));
      const refresh = () => {
        if (albums.length === 0) return submit.blocked('No hay otro álbum. Crea uno en Tu biblioteca › Crear › Álbum.');
        if (ids.length > REQUEST_LIMITS.moveSongs) {
          return submit.blocked(`Como mucho ${REQUEST_LIMITS.moveSongs} canciones de una vez: quita ${ids.length - REQUEST_LIMITS.moveSongs} de la selección.`);
        }
        const picked = group.querySelector('input:checked')?.value ?? null;
        if (picked === null) return submit.blocked('Elige un álbum.');
        const payload = { op: 'move_songs', song_ids: ids, folder_id: picked };
        const problem = validateOperation(payload);
        return problem ? submit.blocked(problem) : submit.ready(payload);
      };
      group.addEventListener('change', refresh);
      refresh();
      body.append(
        albums.length > 0 ? group : el('p', { class: 'dialog-text' }, 'No hay otro álbum al que moverlas.'),
        editNote(),
        el('div', { class: 'dialog-actions' }, submit.status, submit.button));
    },
    initialFocus: (dialog) => dialog.querySelector('input') ?? dialog.querySelector('button'),
  });
}

/**
 * «Ordenar canciones» de un álbum: la lista de sus canciones con «Subir» y «Bajar» en cada fila (con el teclado o el
 * ratón; cada cambio se anuncia). «Guardar orden» envía una sola petición order_album con la lista completa en el orden
 * nuevo. Solo con las canciones de la biblioteca común; más de 190 no caben en una petición.
 */
export function openOrderAlbumSheet(ctx, folder) {
  const max = REQUEST_LIMITS.orderSongs;
  const original = songsInFolder(ctx.state.catalog, folder.id).filter((song) => ctx.isEditableSong(song));
  return openDialog({
    title: 'Ordenar canciones',
    testid: 'album-order',
    className: 'dialog-edit',
    render: (body, close) => {
      const order = [...original];
      const submit = saveAction('album-order-save', close, saveOrganize, 'Guardar orden');
      const live = el('p', { class: 'sr-only', 'aria-live': 'polite', 'data-testid': 'album-order-live' });
      const list = el('ol', { class: 'order-list', 'aria-label': `Orden de ${folder.name}`, 'data-testid': 'album-order-list' });

      const refresh = () => {
        if (original.length > max) return submit.blocked(`Este álbum tiene más de ${max} canciones: no se puede ordenar desde aquí.`);
        if (order.every((song, index) => song === original[index])) return submit.blocked('Sube o baja alguna canción para cambiar el orden.');
        const payload = { op: 'order_album', folder_id: folder.id, song_ids: order.map((song) => song.id) };
        const problem = validateOperation(payload);
        return problem ? submit.blocked(problem) : submit.ready(payload);
      };

      const moveButton = (song, index, direction) => {
        const up = direction < 0;
        const edge = up ? index === 0 : index === order.length - 1;
        return el('button', {
          type: 'button',
          class: 'icon-button order-move',
          'aria-label': `${up ? 'Subir' : 'Bajar'} «${song.title}»`,
          'aria-disabled': edge ? 'true' : 'false',
          'data-testid': up ? 'album-order-up' : 'album-order-down',
          'data-song-id': song.id,
          on: { click: () => move(song, direction) },
        }, icon(up ? 'chevron-up' : 'chevron-down', { size: 20 }));
      };

      const paint = () => {
        list.replaceChildren(...order.map((song, index) => el('li', {
          class: 'order-row',
          'data-testid': 'album-order-row',
          'data-song-id': song.id,
        },
        el('span', { class: 'order-num', 'aria-hidden': 'true' }, String(index + 1)),
        songCoverNode(ctx, song, 'track-cover'),
        el('span', { class: 'track-text' },
          el('span', { class: 'add-title' }, song.title),
          el('span', { class: 'track-artist' }, ctx.artistOf(song))),
        el('span', { class: 'order-actions' }, moveButton(song, index, -1), moveButton(song, index, 1)))));
      };

      // Mueve la canción un puesto y deja el foco en el mismo botón (o en el otro, si llegó al borde).
      function move(song, direction) {
        const index = order.indexOf(song);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= order.length) return;
        [order[index], order[target]] = [order[target], order[index]];
        paint();
        refresh();
        live.textContent = `«${song.title}» ahora es la ${target + 1} de ${order.length}.`;
        const testid = direction < 0 ? 'album-order-up' : 'album-order-down';
        const other = direction < 0 ? 'album-order-down' : 'album-order-up';
        const row = list.querySelector(`[data-testid="album-order-row"][data-song-id="${song.id}"]`);
        const same = row?.querySelector(`[data-testid="${testid}"]`);
        (same?.getAttribute('aria-disabled') === 'true' ? row?.querySelector(`[data-testid="${other}"]`) : same)?.focus();
      }

      paint();
      refresh();
      body.append(
        el('p', { class: 'dialog-text' }, `Usa «Subir» y «Bajar» para cambiar el orden de «${folder.name}». El orden nuevo llega a todos.`),
        original.length > max
          ? el('p', { class: 'field-error', 'data-testid': 'album-order-too-many' }, `Este álbum tiene más de ${max} canciones: no se puede ordenar desde aquí.`)
          : list,
        live,
        editNote(),
        el('div', { class: 'dialog-actions' }, submit.status, submit.button));
    },
    initialFocus: (dialog) => dialog.querySelector('[data-testid="album-order-down"]') ?? dialog.querySelector('button'),
  });
}

/** «Cambiar portada»: se elige una imagen, se ve recortada y se guarda en el buzón de portadas. */
export function openCoverSheet(ctx, { kind, id, name }) {
  return openDialog({
    title: 'Cambiar portada',
    testid: 'cover-sheet',
    className: 'dialog-edit',
    render: (body, close) => {
      let jpeg = null;
      const submit = saveAction('cover-save', close, () => saveCover(id, jpeg));
      submit.blocked('Elige una imagen.');
      const preview = el('div', { class: 'edit-cover-slot', 'data-testid': 'cover-preview' });
      const fileInput = el('input', { type: 'file', accept: COVER_INPUT_ACCEPT, hidden: true, 'data-testid': 'cover-file' });
      const choose = el('button', {
        type: 'button',
        class: 'button button-outline',
        'data-testid': 'cover-choose',
        on: { click: () => fileInput.click() },
      }, icon('image', { size: 16 }), 'Elegir imagen');
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const problem = coverFileProblem(file);
        if (problem) return submit.blocked(problem);
        try {
          const dataUrl = await resizeCoverFile(file);
          jpeg = dataUrlToBytes(dataUrl);
          preview.replaceChildren(el('img', { class: 'cover edit-cover-image', src: dataUrl, alt: 'Vista previa de la portada' }));
          submit.ready(jpeg);
        } catch (error) {
          jpeg = null;
          submit.blocked(error instanceof Error ? error.message : 'No se ha podido leer la imagen.');
        }
      });
      body.append(
        el('p', { class: 'dialog-text' }, `Portada de ${kind === 'album' ? 'el álbum' : 'la canción'} «${name}».`),
        el('div', { class: 'edit-grid' }, el('div', { class: 'edit-cover' }, preview, choose, fileInput),
          el('ul', { class: 'upload-rules', 'data-testid': 'cover-rules' },
            el('li', {}, `${COVER_RULES.formats}.`),
            el('li', {}, `Se recorta al centro y se reduce a ${COVER_RULES.size} × ${COVER_RULES.size} px.`),
            el('li', {}, 'El cambio llega a todos en un par de minutos.'))),
        el('div', { class: 'dialog-actions' }, submit.status, submit.button));
    },
    initialFocus: (dialog) => dialog.querySelector('[data-testid="cover-choose"]'),
  });
}

// ---------------------------------------------------------------------------
// Listas propias (solo en este navegador)
// ---------------------------------------------------------------------------

/** «Editar detalles» de una lista propia: portada (del dispositivo), nombre y descripción. */
export function openPlaylistEditor(ctx, list) {
  return openDialog({
    title: 'Editar detalles',
    testid: 'playlist-edit',
    className: 'dialog-edit',
    render: (body, close) => {
      let cover = list.cover ?? null;
      const context = ctx.playlistContext(list);
      const coverSlot = el('div', { class: 'edit-cover-slot' });
      const paintCover = () => {
        coverSlot.replaceChildren(contextCover({ ...context, cover, mosaic: cover ? null : context.mosaic }, 'edit-cover-image'));
        remove.hidden = !cover;
      };
      const fileInput = el('input', { type: 'file', accept: COVER_INPUT_ACCEPT, hidden: true, 'data-testid': 'playlist-edit-file' });
      const choose = el('button', {
        type: 'button',
        class: 'edit-cover-button',
        'aria-label': 'Elegir foto',
        'data-testid': 'playlist-edit-choose',
        on: { click: () => fileInput.click() },
      }, coverSlot, el('span', { class: 'cover-edit-hint', 'aria-hidden': 'true' }, icon('pencil', { size: 40 }), el('span', {}, 'Elegir foto')));
      const remove = el('button', {
        type: 'button',
        class: 'button button-text edit-cover-action',
        'data-testid': 'playlist-edit-remove-photo',
        on: { click: () => { cover = null; paintCover(); status.textContent = 'Se quitará la foto al guardar.'; } },
      }, icon('trash', { size: 16 }), 'Quitar foto');
      const status = el('p', { class: 'edit-status', role: 'status', 'data-testid': 'playlist-edit-status' });
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        status.textContent = 'Preparando la foto…';
        try {
          cover = await resizeCoverFile(file);
          paintCover();
          status.textContent = 'Foto lista. Pulsa «Guardar» para quedártela.';
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : 'No se ha podido usar esa imagen.';
        }
      });
      const name = field({ key: 'name', label: 'Nombre', value: list.name, maxLength: PLAYLIST_NAME_MAX, testid: 'playlist-edit-name' });
      const description = field({
        key: 'description', label: 'Descripción', value: list.description ?? '', maxLength: PLAYLIST_DESCRIPTION_MAX, multiline: true,
        placeholder: 'Añade una descripción opcional', testid: 'playlist-edit-description',
      });
      const form = el('form', { class: 'dialog-form', novalidate: true },
        el('div', { class: 'edit-grid' },
          el('div', { class: 'edit-cover' }, choose, fileInput, remove),
          el('div', { class: 'edit-fields' }, name.wrapper, description.wrapper)),
        el('p', { class: 'edit-note' }, 'Se guarda solo en este navegador. La foto se recorta en cuadrado y se reduce a 640 px.'),
        el('div', { class: 'dialog-actions' }, status,
          el('button', { type: 'submit', class: 'button button-light edit-submit', 'data-testid': 'playlist-edit-save' }, 'Guardar')));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const nameProblem = validatePlaylistName(name.input.value);
        const descriptionProblem = validatePlaylistDescription(description.input.value);
        name.setError(nameProblem);
        description.setError(descriptionProblem);
        if (nameProblem || descriptionProblem) {
          (nameProblem ? name : description).input.focus();
          return;
        }
        const saved = await ctx.updatePlaylist(list.id, { name: name.input.value, description: description.input.value, cover });
        if (saved) close(true);
      });
      paintCover();
      body.append(form);
    },
    initialFocus: (dialog) => dialog.querySelector('[data-testid="playlist-edit-name"]'),
  });
}
