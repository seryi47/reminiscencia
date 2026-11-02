// Editor de lista (DESIGN C3b, ruta lista/:profileId/:listId; «nueva» crea). Nombre obligatorio de 60 caracteres,
// canciones con «Subir», «Bajar» y «Quitar» (con «Deshacer» de 10 s), «Guardar lista» y «Guardar sin conexión»,
// que además copia las canciones para escuchar sin internet (pwa.js). También exporta el selector de canciones
// que usa el editor de recuerdos.

import { saveLibraryOffline } from '../pwa.js';
import {
  createField, formatDuration, h, insertItemAt, matchesQuery, messageOf, moveItem, nextId, openSheet, pluralize,
  removeItemAt, textLengthError,
} from './observacion-hoja.js';

// Límites de la lista (DESIGN C3b). El almacén admite 80 caracteres en el nombre; la interfaz pide 60.
export const LIST_LIMITS = Object.freeze({ name: 60, songs: 500, undoMs: 10 * 1000 });
const MISSING_SONG = 'Canción no disponible en el catálogo';

// Problema del nombre de la lista, o null si vale.
export function validateListName(name) {
  return textLengthError(name, {
    max: LIST_LIMITS.name,
    required: true,
    emptyMessage: 'Escribe un nombre para la lista.',
    tooLongMessage: `El nombre no puede superar ${LIST_LIMITS.name} caracteres.`,
  });
}

// Canciones que coinciden con la búsqueda, por título o artista (sin distinguir mayúsculas ni tildes).
export function filterSongs(songs, query) {
  return songs.filter((song) => matchesQuery(`${song.title ?? ''} ${song.artist ?? ''}`, query));
}

// Une la selección de la hoja con la lista actual: conserva el orden de lo que ya estaba y añade lo nuevo al final.
export function mergeSelection(currentIds, selectedIds) {
  const selected = new Set(selectedIds);
  const known = new Set(currentIds);
  return [
    ...currentIds.filter((id) => selected.has(id)),
    ...selectedIds.filter((id) => !known.has(id)),
  ];
}

// Instantánea del nombre y de las canciones, para saber si hay cambios sin guardar.
export function listSnapshot(name, songIds) {
  return JSON.stringify({ name: String(name ?? '').trim(), songIds });
}

// Hoja para elegir canciones del catálogo: buscar, marcar y confirmar. Resuelve con los identificadores elegidos
// (primero los que ya estaban, luego los nuevos) o con null si se cancela. max limita la selección.
export function openSongPicker(services, { selectedIds = [], max = LIST_LIMITS.songs, title = 'Elegir canciones' } = {}) {
  const songs = services.catalog?.songs ?? [];
  return openSheet({
    title,
    className: 'cc-hoja-selector',
    cancelValue: null,
    build: (close) => {
      const chosen = new Set(selectedIds);
      const searchInput = h('input', {
        type: 'search',
        class: 'cc-control',
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        enterkeyhint: 'search',
      });
      const searchField = createField({
        label: 'Buscar canción',
        control: searchInput,
        help: 'Escribe parte del título o del artista.',
      });
      const statusNode = h('p', { class: 'cc-campo-ayuda', role: 'status' });
      const emptyNode = h('p', { class: 'cc-vacio' });
      const listNode = h('ul', { class: 'cc-selector-lista' });
      const boxes = new Map();

      // Con el máximo alcanzado, las canciones sin marcar se deshabilitan.
      function updateStatus() {
        const full = chosen.size >= max;
        for (const input of boxes.values()) {
          if (!input.checked) input.disabled = full;
        }
        statusNode.textContent = `${pluralize(chosen.size, 'canción elegida', 'canciones elegidas')}. `
          + `Puedes elegir hasta ${max}.`;
      }

      function render() {
        const visible = filterSongs(songs, searchInput.value);
        boxes.clear();
        listNode.replaceChildren(...visible.map((song) => {
          const input = h('input', { type: 'checkbox', checked: chosen.has(song.id) });
          boxes.set(song.id, input);
          input.addEventListener('change', () => {
            if (input.checked) chosen.add(song.id);
            else chosen.delete(song.id);
            updateStatus();
          });
          const details = [song.artist, formatDuration(song.duration_s)].filter(Boolean).join(' · ');
          return h('li', { class: 'cc-selector-fila' },
            h('label', { class: 'cc-casilla cc-casilla-fila' }, input,
              h('span', { class: 'cc-selector-texto' },
                h('span', { class: 'cc-fila-titulo', text: song.title || MISSING_SONG }),
                details ? h('span', { class: 'cc-meta', text: details }) : null)));
        }));
        emptyNode.textContent = songs.length === 0
          ? 'No hay canciones en el catálogo.'
          : 'Ninguna canción coincide con la búsqueda.';
        emptyNode.hidden = visible.length > 0;
        updateStatus();
      }

      searchInput.addEventListener('input', render);
      render();
      const footer = [
        h('button', { type: 'button', class: 'cc-boton cc-boton--secundario', text: 'Cancelar', onClick: () => close(null) }),
        h('button', {
          type: 'button',
          class: 'cc-boton cc-boton--primario',
          text: 'Usar esta selección',
          onClick: () => close([...chosen]),
        }),
      ];
      return {
        body: [searchField.root, statusNode, emptyNode, listNode],
        footer,
        initialFocus: searchInput,
      };
    },
  });
}

// Editor de una lista. params: { profileId, listId }; listId «nueva» crea una lista.
export function mountListEditor(root, services, params = {}) {
  const profileId = params.profileId ?? null;
  const listId = params.listId ?? 'nueva';
  const isNew = listId === 'nueva';
  const seq = nextId('cc-lista');
  const songById = new Map((services.catalog?.songs ?? []).map((song) => [song.id, song]));
  const state = { name: '', songIds: [] };
  const ui = {};
  let currentId = isNew ? null : listId;
  let saved = '';
  let loaded = false;
  let busy = false;
  let disposed = false;
  // El último quitado, para «Deshacer». Solo hay una plaza: quitar otra canción sustituye a la anterior.
  let undo = null;

  services.setTitle?.(isNew ? 'Nueva lista' : 'Editar lista');
  root.replaceChildren(h('p', { class: 'cc-estado', role: 'status', text: 'Cargando la lista…' }));
  window.addEventListener('beforeunload', onBeforeUnload);
  load();
  return { unmount };

  // Hay cambios si el nombre o las canciones son distintos de lo último guardado.
  function isDirty() {
    return loaded && listSnapshot(state.name, state.songIds) !== saved;
  }

  async function load() {
    try {
      if (!profileId) throw new Error('Falta el perfil de la lista.');
      if (!isNew) {
        const lists = await services.store.listPlaylists(profileId);
        const found = lists.find((list) => list.id === listId);
        if (!found) throw new Error('No se encuentra esa lista en este perfil.');
        state.name = found.name;
        state.songIds = [...found.songIds];
      }
      if (disposed) return;
      loaded = true;
      saved = listSnapshot(state.name, state.songIds);
      build();
    } catch (error) {
      if (!disposed) renderFailure(messageOf(error, 'No se pudo abrir la lista.'));
    }
  }

  function backButton() {
    return h('button', {
      type: 'button',
      class: 'cc-enlace',
      text: '‹ Volver a listas',
      onClick: () => leave('perfil', { profileId, tab: 'listas' }),
    });
  }

  function renderFailure(message) {
    root.replaceChildren(h('div', { class: 'cc-editor' },
      backButton(),
      h('p', { class: 'cc-alerta', role: 'alert', text: message })));
  }

  // Construye el formulario una sola vez; después solo se repintan las canciones y los avisos.
  function build() {
    const headingId = `${seq}-canciones`;
    const nameInput = h('input', {
      type: 'text',
      class: 'cc-control',
      autocomplete: 'off',
      required: true,
      value: state.name,
    });
    const nameField = createField({
      label: 'Nombre de la lista (obligatorio)',
      control: nameInput,
      help: `Máximo ${LIST_LIMITS.name} caracteres.`,
    });
    nameInput.addEventListener('input', () => {
      state.name = nameInput.value;
      nameField.setError(null);
    });
    ui.nameInput = nameInput;
    ui.nameField = nameField;
    ui.songsHeading = h('h2', { id: headingId, class: 'cc-seccion-titulo' });
    ui.addButton = h('button', { type: 'button', class: 'cc-boton cc-boton--secundario', text: 'Añadir canciones', onClick: addSongs });
    ui.undoNode = h('div', { class: 'cc-aviso', role: 'status', hidden: true });
    ui.emptyNode = h('p', { class: 'cc-vacio', text: 'Esta lista no tiene canciones todavía. Usa «Añadir canciones».' });
    ui.songsNode = h('ol', { class: 'cc-lista-canciones', 'aria-labelledby': headingId });
    ui.progressNode = h('p', { class: 'cc-estado' });
    ui.alertNode = h('div', { class: 'cc-alerta', role: 'alert', hidden: true });
    ui.cancelButton = h('button', {
      type: 'button',
      class: 'cc-boton cc-boton--secundario',
      text: 'Cancelar',
      onClick: () => leave('perfil', { profileId, tab: 'listas' }),
    });
    ui.offlineButton = h('button', {
      type: 'button',
      class: 'cc-boton cc-boton--secundario',
      'data-testid': 'c-lista-save-offline',
      text: 'Guardar sin conexión',
      onClick: () => save(true),
    });
    ui.saveButton = h('button', {
      type: 'button',
      class: 'cc-boton cc-boton--primario',
      text: 'Guardar lista',
      onClick: () => save(false),
    });
    ui.deleteButton = isNew
      ? null
      : h('button', { type: 'button', class: 'cc-boton cc-boton--peligro', text: 'Eliminar lista', onClick: removeList });

    root.replaceChildren(h('div', { class: 'cc-editor cc-editor-lista' },
      h('div', { class: 'cc-editor-cabecera' }, backButton()),
      h('form', { class: 'cc-formulario', novalidate: true, onSubmit: (event) => event.preventDefault() },
        ui.alertNode,
        nameField.root,
        h('section', { class: 'cc-seccion', 'aria-labelledby': headingId },
          h('div', { class: 'cc-seccion-cabecera' }, ui.songsHeading, ui.addButton),
          ui.undoNode, ui.emptyNode, ui.songsNode, ui.progressNode),
        ui.deleteButton ? h('div', { class: 'cc-zona-peligro' }, ui.deleteButton) : null),
      h('div', { class: 'cc-pie' }, ui.cancelButton, ui.offlineButton, ui.saveButton)));
    renderSongs();
  }

  function renderSongs() {
    const total = state.songIds.length;
    ui.songsHeading.textContent = `Canciones (${total})`;
    ui.emptyNode.hidden = total > 0;
    ui.songsNode.hidden = total === 0;
    ui.songsNode.replaceChildren(...state.songIds.map((songId, index) => songRow(songId, index, total)));
  }

  // Una fila de canción: posición, título y artista, y los botones de orden y de quitar.
  function songRow(songId, index, total) {
    const song = songById.get(songId);
    const title = song?.title || MISSING_SONG;
    const details = [song?.artist, formatDuration(song?.duration_s)].filter(Boolean).join(' · ');
    const compact = 'cc-boton cc-boton--secundario cc-boton--compacto';
    return h('li', {
      class: 'cc-fila-cancion',
      // Alt + flecha reordena desde el teclado (DESIGN C-19).
      onKeydown: (event) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        moveSong(index, event.key === 'ArrowUp' ? -1 : 1);
      },
    },
    h('span', { class: 'cc-posicion', 'aria-hidden': 'true', text: String(index + 1) }),
    h('span', { class: 'visually-hidden', text: `Posición ${index + 1} de ${total}. ` }),
    h('div', { class: 'cc-fila-texto' },
      h('p', { class: 'cc-fila-titulo', text: title }),
      details ? h('p', { class: 'cc-meta', text: details }) : null),
    h('div', { class: 'cc-acciones-fila' },
      h('button', { type: 'button', class: compact, disabled: index === 0, onClick: () => moveSong(index, -1) },
        'Subir', h('span', { class: 'visually-hidden', text: ` ${title}` })),
      h('button', { type: 'button', class: compact, disabled: index === total - 1, onClick: () => moveSong(index, 1) },
        'Bajar', h('span', { class: 'visually-hidden', text: ` ${title}` })),
      h('button', { type: 'button', class: compact, onClick: () => removeSong(index) },
        'Quitar', h('span', { class: 'visually-hidden', text: ` ${title}` }))));
  }

  // Lleva el foco al primer botón activo de la fila; devuelve false si no hay esa fila.
  function focusRow(index) {
    const target = ui.songsNode.children[index]?.querySelector('button:not([disabled])');
    target?.focus();
    return Boolean(target);
  }

  function moveSong(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= state.songIds.length) return;
    state.songIds = moveItem(state.songIds, index, delta);
    renderSongs();
    services.announce?.(`Canción en la posición ${target + 1} de ${state.songIds.length}.`);
    focusRow(target);
  }

  function removeSong(index) {
    const { list, removed } = removeItemAt(state.songIds, index);
    if (!removed) return;
    clearUndo();
    state.songIds = list;
    undo = { songId: removed.item, index: removed.index, timer: setTimeout(expireUndo, LIST_LIMITS.undoMs) };
    renderSongs();
    showUndo();
    if (!focusRow(index)) ui.addButton.focus();
  }

  function showUndo() {
    const title = songById.get(undo.songId)?.title || MISSING_SONG;
    ui.undoNode.replaceChildren(
      h('p', { class: 'cc-aviso-texto', text: `Canción quitada: ${title}.` }),
      h('button', {
        type: 'button',
        class: 'cc-boton cc-boton--secundario cc-boton--compacto',
        text: 'Deshacer',
        onClick: restoreSong,
      }),
    );
    ui.undoNode.hidden = false;
  }

  function restoreSong() {
    if (!undo) return;
    const { songId, index } = undo;
    clearUndo();
    if (!state.songIds.includes(songId)) state.songIds = insertItemAt(state.songIds, index, songId);
    renderSongs();
    services.announce?.('Canción restaurada.');
    focusRow(index);
  }

  // Pasados 10 s, el aviso desaparece; mientras la persona tiene el foco dentro, se espera (DESIGN C-17).
  function expireUndo() {
    if (!undo) return;
    if (ui.undoNode.contains(document.activeElement)) {
      undo.timer = setTimeout(expireUndo, LIST_LIMITS.undoMs);
      return;
    }
    clearUndo();
  }

  function clearUndo() {
    if (undo) clearTimeout(undo.timer);
    undo = null;
    if (ui.undoNode) {
      ui.undoNode.hidden = true;
      ui.undoNode.replaceChildren();
    }
  }

  async function addSongs() {
    const picked = await openSongPicker(services, {
      selectedIds: state.songIds,
      max: LIST_LIMITS.songs,
      title: 'Añadir canciones',
    });
    if (!picked || disposed) return;
    clearUndo();
    state.songIds = mergeSelection(state.songIds, picked);
    renderSongs();
    services.announce?.(`La lista tiene ${pluralize(state.songIds.length, 'canción', 'canciones')}.`);
    ui.addButton.focus();
  }

  function setBusy(on) {
    busy = on;
    for (const control of [ui.saveButton, ui.offlineButton, ui.cancelButton, ui.deleteButton]) {
      if (control) control.disabled = on;
    }
  }

  function showAlert(message) {
    ui.alertNode.textContent = message;
    ui.alertNode.hidden = false;
  }

  // Guarda la lista. Con offline, además copia las canciones para escuchar sin internet.
  async function save(offline) {
    if (busy || !loaded || disposed) return;
    ui.alertNode.hidden = true;
    const problem = validateListName(state.name);
    if (problem) {
      ui.nameField.setError(problem);
      ui.nameInput.focus();
      return;
    }
    setBusy(true);
    try {
      const record = await services.store.savePlaylist({
        ...(currentId ? { id: currentId } : {}),
        profileId,
        name: state.name.trim(),
        songIds: [...state.songIds],
      });
      currentId = record.id;
      saved = listSnapshot(state.name, state.songIds);
      if (!offline) {
        services.announce?.('Lista guardada.');
        services.navigate('perfil', { profileId, tab: 'listas' });
        return;
      }
      await copyOffline();
    } catch (error) {
      if (!disposed) showAlert(messageOf(error, 'No se pudo guardar la lista. Inténtalo de nuevo.'));
    } finally {
      if (!disposed) setBusy(false);
    }
  }

  // Copia sin conexión de las canciones de la lista. Una canción que no se copia no detiene a las demás.
  async function copyOffline() {
    const songs = state.songIds.map((songId) => songById.get(songId)).filter(Boolean);
    const missing = state.songIds.length - songs.length;
    const total = pluralize(songs.length, 'canción', 'canciones');
    ui.progressNode.textContent = `Copiando ${total} sin conexión…`;
    services.announce?.(`Copiando ${total} sin conexión.`);
    try {
      const result = await saveLibraryOffline(songs, (progress) => {
        if (!disposed) ui.progressNode.textContent = `Copiando canciones sin conexión: ${progress.done} de ${progress.total}.`;
      });
      if (disposed) return;
      ui.progressNode.textContent = '';
      const failed = result.failed.length + missing;
      if (failed === 0) {
        services.announce?.(`Lista guardada. ${total} disponibles sin conexión.`);
        services.navigate('perfil', { profileId, tab: 'listas' });
        return;
      }
      showAlert(`La lista está guardada, pero ${pluralize(failed, 'canción no se pudo copiar', 'canciones no se pudieron copiar')}. `
        + 'Revisa la conexión y vuelve a intentarlo con «Guardar sin conexión».');
    } catch {
      if (disposed) return;
      ui.progressNode.textContent = '';
      showAlert('La lista está guardada, pero no se pudieron copiar las canciones sin conexión en este navegador.');
    }
  }

  async function removeList() {
    if (!currentId || busy || disposed) return;
    const confirmed = await services.confirm({
      title: '¿Eliminar esta lista?',
      body: 'La lista se borra. Las canciones del catálogo y el resto del perfil no cambian.',
      confirmLabel: 'Eliminar lista',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!confirmed || disposed) return;
    setBusy(true);
    try {
      await services.store.deletePlaylist(currentId);
      services.announce?.('Lista eliminada.');
      services.navigate('perfil', { profileId, tab: 'listas' });
    } catch (error) {
      if (!disposed) {
        setBusy(false);
        showAlert(messageOf(error, 'No se pudo eliminar la lista.'));
      }
    }
  }

  // Volver atrás con cambios sin guardar pide confirmación (services.confirm).
  async function leave(route, routeParams) {
    if (isDirty()) {
      const leaveNow = await services.confirm({
        title: 'Salir sin guardar',
        body: 'La lista tiene cambios que no se han guardado.',
        confirmLabel: 'Salir sin guardar',
        cancelLabel: 'Seguir editando',
        danger: true,
      });
      if (!leaveNow) return;
    }
    services.navigate(route, routeParams);
  }

  // Cerrar la pestaña o recargar también avisa si hay cambios.
  function onBeforeUnload(event) {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  function unmount() {
    disposed = true;
    clearUndo();
    window.removeEventListener('beforeunload', onBeforeUnload);
    root.replaceChildren();
  }
}

// Ruta de la lista (contrato 2.4): lista/:profileId/:listId.
export const routes = Object.freeze({ lista: mountListEditor });
