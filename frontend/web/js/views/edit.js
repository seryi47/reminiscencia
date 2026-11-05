// Hojas de edición, con el aspecto del «Editar detalles» de Spotify (portada a la izquierda, campos a la derecha).
// Cada hoja valida la petición con las reglas del backend (js/cuidador/incidencias.js) y la guarda con «Guardar»:
// POST /api/editar abre la incidencia «biblioteca» o guarda la portada con el token del servidor, sin pasar por GitHub
// (ADR-0022; ADR-0008 sigue valiendo para el procesado).
// - «Editar detalles» de una canción: {"op":"edit_song","song_id","title","artist"}.
// - «Editar detalles» de un álbum: {"op":"edit_folder","folder_id","name","artist"}.
// - «Añadir a un álbum»: {"op":"edit_song","song_id","folder_id"} (null: sin álbum).
// - «Crear álbum»: {"op":"create_folder","name","artist"} (artist solo si se escribe).
// - «Cambiar portada»: se elige una imagen, se recorta a 640 px y se guarda en el buzón de portadas.
// Las listas propias se editan aquí mismo (nombre, descripción y portada), solo en este navegador.

import { COVER_INPUT_ACCEPT, coverFileProblem, resizeCoverFile } from '../cover-image.js';
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
 * éxito se avisa y se cierra la hoja, y si falla el motivo queda a la vista y se puede reintentar.
 */
function saveAction(testid, close, save = saveOrganize) {
  const button = el('button', {
    type: 'button',
    class: 'button button-light edit-submit',
    'aria-disabled': 'true',
    'data-testid': testid,
  }, 'Guardar');
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
      button.setAttribute('aria-disabled', 'false');
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
