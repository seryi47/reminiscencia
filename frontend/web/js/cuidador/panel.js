// Panel «Ahora suena» o ficha de canción (DESIGN C2b y C-20; contrato 2.1, 5 y 6). mountPanel(root, services, songId)
// rellena root y devuelve { unmount, setSong, focusHeading }. El marco decide qué canción se muestra (la
// seleccionada o la que suena) y llama a setSong cuando cambia; este módulo solo la muestra y guarda la
// familiaridad (1 a 5), la preferencia (−1, 0, +1) y la presentación (C0, C1, C2) con store.setSongLink.
//
// Decisiones que el contrato deja abiertas:
// - store.setSongLink admite solo familiarity, preference y notes (store.js). La presentación por canción
//   (DESIGN D6) no está en el almacén: el panel la intenta guardar, y si el almacén la rechaza, lo dice.
// - La hoja «Registrar observación» (observacion-hoja.js, de otro agente) se carga al pulsar el botón, para
//   que este módulo se pueda cargar y probar aunque ese fichero aún no exista.
// - No importa shell.js (shell.js importa este módulo): los dos iconos que usa van aquí.
// - Sin perfil activo no hay asociaciones que guardar: los controles quedan deshabilitados con una explicación.

export const FAMILIARITY_VALUES = Object.freeze([1, 2, 3, 4, 5]);
export const FAMILIARITY_LABELS = Object.freeze({
  1: 'No la reconoce',
  2: 'Le suena poco',
  3: 'Le suena algo',
  4: 'La reconoce',
  5: 'La reconoce bien',
});
export const FAMILIARITY_LEGEND = '1 No la reconoce · 2 Le suena poco · 3 Le suena algo · 4 La reconoce · 5 La reconoce bien';
export const PREFERENCE_OPTIONS = Object.freeze([
  Object.freeze({ value: -1, label: 'No le gusta' }),
  Object.freeze({ value: 0, label: 'Le da igual' }),
  Object.freeze({ value: 1, label: 'Le gusta' }),
]);
export const PRESENTATION_OPTIONS = Object.freeze([
  Object.freeze({ value: 'C0', label: 'Solo canción', short: 'Solo canción' }),
  Object.freeze({ value: 'C1', label: 'Canción y recuerdo', short: 'Recuerdo' }),
  Object.freeze({ value: 'C2', label: 'Canción, foto y recuerdo', short: 'Foto y recuerdo' }),
]);
export const EMPTY_PANEL_TEXT = 'No suena nada. Elige una canción en la biblioteca.';
const MEMORY_LIMIT = 2;
const NS_SVG = 'http://www.w3.org/2000/svg';
const ICON_PATHS = Object.freeze({
  check: Object.freeze(['M5 12l4 4 9-9']),
  note: Object.freeze(['M9 18V6l10-2v12', 'M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6', 'M16 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6']),
});

/** Valores de una asociación con los valores iniciales del DESIGN (familiaridad sin valorar, preferencia 0, C0). */
export function linkValues(link) {
  const familiarity = Number.isInteger(link?.familiarity) && link.familiarity >= 1 && link.familiarity <= 5
    ? link.familiarity
    : 0;
  const preference = link?.preference === -1 || link?.preference === 1 ? link.preference : 0;
  const presentation = PRESENTATION_OPTIONS.some((option) => option.value === link?.presentation)
    ? link.presentation
    : 'C0';
  return { familiarity, preference, presentation };
}

/**
 * Cambio que se guarda con store.setSongLink para un campo del panel. Lanza un error en español si el valor
 * no es válido. La preferencia usa −1, 0 y +1 (DESIGN D9); la familiaridad, de 1 a 5.
 */
export function songPatch(field, value) {
  if (field === 'familiarity') {
    if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error('La familiaridad debe ser de 1 a 5.');
    return { familiarity: value };
  }
  if (field === 'preference') {
    if (![-1, 0, 1].includes(value)) throw new Error('La preferencia debe ser no le gusta, le da igual o le gusta.');
    return { preference: value };
  }
  if (field === 'presentation') {
    if (!PRESENTATION_OPTIONS.some((option) => option.value === value)) throw new Error('La presentación no es válida.');
    return { presentation: value };
  }
  throw new Error('Campo no válido.');
}

/** Índice al que lleva una tecla en un grupo de opciones (flechas con ajuste circular, Inicio y Fin). null si no aplica. */
export function nextRadioIndex(key, currentIndex, count) {
  if (!(count > 0)) return null;
  const current = currentIndex < 0 ? 0 : currentIndex;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Hasta `limit` recuerdos que incluyen la canción, en el orden recibido (store.listMemories: más recientes primero). */
export function linkedMemories(memories = [], songId, limit = MEMORY_LIMIT) {
  return memories.filter((memory) => Array.isArray(memory.songIds) && memory.songIds.includes(songId)).slice(0, limit);
}

/** Datos mostrados de la canción: título, artista, fuente y licencia, e inicial para la portada. null si no hay datos. */
export function songViewModel(song, track) {
  const source = song ?? track ?? null;
  if (!source) return null;
  const title = String(source.title ?? '').trim() || 'Sin título';
  const artist = String(source.artist ?? '').trim();
  const license = String(song?.license ?? '').trim();
  const first = Array.from(title)[0];
  return { title, artist, license, initial: first ? first.toLocaleUpperCase('es') : '?' };
}

/** Encabezado del panel: «Ahora suena» si no hay selección o la canción es la que suena; si no, «Ficha de la canción». */
export function panelHeadingFor(songId, playingId) {
  if (songId === null || songId === undefined) return 'Ahora suena';
  return songId === playingId ? 'Ahora suena' : 'Ficha de la canción';
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Icono propio de trazo, con los mismos datos que el marco. Son plantillas fijas.
function icon(name, className) {
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  for (const d of ICON_PATHS[name] ?? []) {
    const path = document.createElementNS(NS_SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// Grupo de opciones tipo radio (role radiogroup + role radio): un único punto de tabulación y flechas.
function createRadioGroup({ labelId, options, testid, layout, onSelect }) {
  const group = el('div', `c-radiogroup c-radiogroup--${layout}`);
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', labelId);
  if (testid) group.dataset.testid = testid;
  const items = options.map((option) => {
    const button = el('button', `c-radio c-radio--${layout}`);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', 'false');
    button.dataset.value = String(option.value);
    if (option.ariaLabel) button.setAttribute('aria-label', option.ariaLabel);
    button.append(el('span', 'c-radio-text', option.text), icon('check', 'c-icon c-radio-check'));
    group.append(button);
    return { option, button };
  });
  let selected = null;
  let disabled = false;

  const setValue = (value) => {
    selected = value;
    const index = items.findIndex((item) => item.option.value === value);
    items.forEach((item, position) => {
      const checked = item.option.value === value;
      item.button.setAttribute('aria-checked', String(checked));
      item.button.classList.toggle('is-selected', checked);
      item.button.tabIndex = checked || (index === -1 && position === 0) ? 0 : -1;
    });
  };

  const choose = (value) => {
    if (!disabled) onSelect(value);
  };

  group.addEventListener('click', (event) => {
    const button = event.target.closest('[role="radio"]');
    const item = items.find((entry) => entry.button === button);
    if (item) choose(item.option.value);
  });
  group.addEventListener('keydown', (event) => {
    if (disabled) return;
    const index = items.findIndex((item) => item.button === document.activeElement);
    const next = nextRadioIndex(event.key, index, items.length);
    if (next === null) return;
    event.preventDefault();
    items[next].button.focus();
    choose(items[next].option.value);
  });

  const setDisabled = (flag) => {
    disabled = flag;
    group.setAttribute('aria-disabled', String(flag));
    for (const item of items) item.button.disabled = flag;
  };

  return { element: group, setValue, setDisabled, get selected() { return selected; } };
}

/**
 * Monta el panel en root. songId es la canción que se muestra o null (sin selección y nada suena).
 * Devuelve { unmount, setSong, focusHeading }.
 */
export function mountPanel(root, services, songId) {
  let alive = true;
  let shownId;
  let renderSeq = 0;
  let profileId = null;
  let objectUrls = [];
  let radios = null;

  const panel = el('section', 'c-panel');
  panel.dataset.testid = 'c-panel';
  panel.setAttribute('aria-labelledby', 'c-panel-title');
  const content = el('div', 'c-panel-content');
  panel.append(content);
  root.replaceChildren(panel);

  // Mensajes de estado (cortesía) y errores (alerta, no se cierran solos).
  const statusEl = el('p', 'c-panel-status');
  statusEl.setAttribute('role', 'status');
  const alertEl = el('p', 'c-panel-status c-panel-status--error');
  alertEl.setAttribute('role', 'alert');

  function releaseUrls() {
    for (const url of objectUrls) services.store.revokePhotoUrl?.(url);
    objectUrls = [];
  }

  function setStatus(text) {
    statusEl.textContent = text;
    alertEl.textContent = '';
  }

  function setError(text) {
    alertEl.textContent = text;
    statusEl.textContent = '';
  }

  function headingNode(text) {
    const heading = el('h2', 'c-panel-title', text);
    heading.id = 'c-panel-title';
    heading.tabIndex = -1;
    return heading;
  }

  async function render() {
    const seq = ++renderSeq;
    releaseUrls();
    shownId = songId;
    radios = null;

    if (songId === null || songId === undefined) {
      content.replaceChildren(headingNode(panelHeadingFor(null, null)), el('p', 'c-panel-empty', EMPTY_PANEL_TEXT));
      return;
    }

    const catalog = services.catalog ?? { songs: [] };
    const song = catalog.songs.find((item) => item.id === songId) ?? null;
    const playing = services.player?.getState().track ?? null;
    const track = playing && playing.id === songId ? playing : null;
    if (!song && !track) {
      content.replaceChildren(headingNode(panelHeadingFor(songId, null)), el('p', 'c-panel-empty', 'Esta canción no está en el catálogo.'));
      return;
    }
    const view = songViewModel(song, track);

    let activeProfile = null;
    try {
      activeProfile = await services.store.getActiveProfileId();
    } catch {
      activeProfile = null;
    }
    if (!alive || seq !== renderSeq) return;
    profileId = activeProfile;
    const hasProfile = Boolean(profileId);

    // Portada de 160 px: sin imagen, la inicial. Va junto al título, así que su texto alternativo está vacío.
    const cover = el('div', 'c-panel-cover');
    cover.setAttribute('aria-hidden', 'true');
    if (track && track.coverUrl) {
      const image = el('img', 'c-panel-cover-img');
      image.alt = '';
      image.src = track.coverUrl;
      cover.append(image);
    } else {
      cover.textContent = view.initial;
    }

    const title = el('p', 'c-panel-song-title', view.title);
    const artist = el('p', 'c-panel-artist', view.artist);
    artist.hidden = !view.artist;

    // Familiaridad (C-5): cinco botones con el número visible y la leyenda debajo.
    const familiarityLabel = el('p', 'c-field-label', 'Familiaridad');
    familiarityLabel.id = 'c-panel-familiarity-label';
    const familiarity = createRadioGroup({
      labelId: familiarityLabel.id,
      testid: 'c-panel-familiarity',
      layout: 'familiarity',
      options: FAMILIARITY_VALUES.map((value) => ({ value, text: String(value), ariaLabel: `${value} ${FAMILIARITY_LABELS[value]}` })),
      onSelect: (value) => saveField('familiarity', value),
    });
    const legend = el('p', 'c-help c-panel-legend', FAMILIARITY_LEGEND);

    // Preferencia (C-6): tres segmentos con texto.
    const preferenceLabel = el('p', 'c-field-label', 'Preferencia');
    preferenceLabel.id = 'c-panel-preference-label';
    const preference = createRadioGroup({
      labelId: preferenceLabel.id,
      testid: 'c-panel-preference',
      layout: 'segments',
      options: PREFERENCE_OPTIONS.map((option) => ({ value: option.value, text: option.label })),
      onSelect: (value) => saveField('preference', value),
    });

    // Presentación (C-7): tres segmentos con dos líneas de texto.
    const presentationLabel = el('p', 'c-field-label', 'Presentación');
    presentationLabel.id = 'c-panel-presentation-label';
    const presentation = createRadioGroup({
      labelId: presentationLabel.id,
      testid: 'c-panel-presentation',
      layout: 'presentation',
      options: PRESENTATION_OPTIONS.map((option) => ({ value: option.value, text: option.label })),
      onSelect: (value) => saveField('presentation', value),
    });
    radios = { familiarity, preference, presentation };
    const disabled = !hasProfile;
    familiarity.setDisabled(disabled);
    preference.setDisabled(disabled);
    presentation.setDisabled(disabled);

    const note = el('p', 'c-help c-panel-note', hasProfile ? '' : 'Crea un perfil para guardar la familiaridad, la preferencia y la presentación.');
    note.hidden = hasProfile;

    const memoriesBlock = el('section', 'c-panel-block');
    memoriesBlock.append(el('h3', 'c-panel-subtitle', 'Recuerdos vinculados'));
    const memoryList = el('ul', 'c-panel-memories');
    memoriesBlock.append(memoryList);

    const actions = el('div', 'c-panel-actions');
    const previewBtn = el('button', 'c-btn c-btn--secondary', 'Ver como lo ve el paciente');
    previewBtn.type = 'button';
    previewBtn.disabled = !hasProfile;
    previewBtn.addEventListener('click', () => services.startPreview?.(profileId));
    const observeBtn = el('button', 'c-btn c-btn--secondary', 'Registrar observación');
    observeBtn.type = 'button';
    observeBtn.disabled = !hasProfile;
    observeBtn.addEventListener('click', () => openObservation());
    actions.append(previewBtn, observeBtn);

    const source = el('p', 'c-help c-panel-source', view.license ? `Fuente y licencia: ${view.license}` : 'Fuente y licencia: sin datos');

    content.replaceChildren(
      headingNode(panelHeadingFor(songId, playing?.id ?? null)),
      cover,
      title,
      artist,
      familiarityLabel,
      familiarity.element,
      legend,
      preferenceLabel,
      preference.element,
      presentationLabel,
      presentation.element,
      note,
      memoriesBlock,
      actions,
      alertEl,
      statusEl,
      source,
    );
    setStatus('');
    setError('');

    if (!hasProfile) {
      familiarity.setValue(null);
      preference.setValue(0);
      presentation.setValue('C0');
      memoryList.append(el('li', 'c-panel-memory-empty', 'Sin perfil activo no hay recuerdos vinculados.'));
      return;
    }

    // Valores guardados (o los iniciales si no hay asociación) y los recuerdos vinculados.
    try {
      const link = await services.store.getSongLink(profileId, songId);
      if (!alive || seq !== renderSeq) return;
      const values = linkValues(link);
      familiarity.setValue(values.familiarity || null);
      preference.setValue(values.preference);
      presentation.setValue(values.presentation);
    } catch (error) {
      if (alive && seq === renderSeq) setError(error.message ?? 'No se pudieron leer los datos de la canción.');
    }
    await renderMemories(seq, memoryList);
  }

  async function renderMemories(seq, list) {
    list.replaceChildren();
    try {
      const memories = await services.store.listMemories(profileId);
      if (!alive || seq !== renderSeq) return;
      const linked = linkedMemories(memories, songId);
      if (linked.length === 0) {
        list.append(el('li', 'c-panel-memory-empty', 'Ningún recuerdo vinculado a esta canción.'));
        return;
      }
      const photos = await services.store.listPhotos(profileId);
      if (!alive || seq !== renderSeq) return;
      for (const memory of linked) {
        const item = el('li');
        const button = el('button', 'c-memory-link');
        button.type = 'button';
        const thumb = el('span', 'c-memory-thumb');
        const photo = photos.find((entry) => (memory.photoIds ?? []).includes(entry.id));
        if (photo) {
          const url = services.store.getPhotoUrl(photo);
          objectUrls.push(url);
          const image = el('img');
          image.alt = '';
          image.src = url;
          thumb.append(image);
        } else {
          thumb.setAttribute('aria-hidden', 'true');
          thumb.append(icon('note', 'c-icon'));
        }
        button.append(thumb, el('span', 'c-memory-title', memory.title || 'Recuerdo sin título'));
        const memoryId = memory.id;
        button.addEventListener('click', () => services.navigate('recuerdo', { profileId, memoryId }));
        item.append(button);
        list.append(item);
      }
    } catch (error) {
      console.error('Reminiscencia: no se pudieron leer los recuerdos.', error);
      if (alive && seq === renderSeq) list.append(el('li', 'c-panel-memory-empty', 'No se pudieron leer los recuerdos.'));
    }
  }

  async function saveField(field, value) {
    if (!profileId || !songId || !radios) return;
    const previous = radios[field].selected;
    const label = field === 'familiarity' ? 'Familiaridad' : field === 'preference' ? 'Preferencia' : 'Presentación';
    try {
      const patch = songPatch(field, value);
      await services.store.setSongLink(profileId, songId, patch);
      if (!alive) return;
      radios[field].setValue(value);
      setStatus(`${label} guardada.`);
    } catch (error) {
      if (!alive) return;
      radios[field].setValue(previous);
      const reason = error instanceof Error ? error.message : '';
      setError(field === 'presentation'
        ? `No se pudo guardar la presentación. ${reason}`.trim()
        : `No se pudo guardar. ${reason}`.trim());
    }
  }

  async function openObservation() {
    if (!profileId) return;
    try {
      const { openObservationSheet } = await import('./observacion-hoja.js');
      await openObservationSheet(services, { profileId, songId });
    } catch (error) {
      console.error('Reminiscencia: no se pudo abrir la observación.', error);
      setError('No se pudo abrir la hoja de observación.');
    }
  }

  // Primer pintado: sin canción, el estado vacío.
  render();

  return {
    unmount() {
      if (!alive) return;
      alive = false;
      releaseUrls();
      root.replaceChildren();
    },
    setSong(nextId) {
      if (!alive) return;
      const normalized = nextId === undefined ? null : nextId;
      if (normalized === shownId) return;
      songId = normalized;
      render();
    },
    // Vuelve a pintar la canción mostrada (por ejemplo, cuando empieza a sonar): el encabezado y los datos se actualizan.
    refresh() {
      if (!alive) return;
      render();
    },
    focusHeading() {
      if (!alive) return;
      content.querySelector('.c-panel-title')?.focus();
    },
  };
}
