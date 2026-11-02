// Editor de recuerdo (DESIGN C3c y C-21, c-memory-*). Ruta recuerdo/:profileId/:memoryId; «nuevo» crea.
// Campos: título (obligatorio, 80), texto (1000, con contador), año (cuatro cifras o «Año aproximado»), personas por
// alias (hasta 20), canciones (hasta 50) y fotografías (hasta 10, cada una con su descripción de hasta 200).
// Las fotografías se preparan al añadirlas (se reducen y pierden sus metadatos), pero solo se guardan en el almacén
// al pulsar «Guardar recuerdo»: salir sin guardar no deja fotografías huérfanas.

import { PHOTO_TYPES } from '../schema.js';
import {
  charCount, counterLine, createField, formatDuration, h, messageOf, moveItem, nextId, normalizeSearch, pluralize,
  textLengthError,
} from './observacion-hoja.js';
import { mergeSelection, openSongPicker } from './lista-editor.js';

// Límites del recuerdo (DESIGN C-11, C-12 y C-22; contrato 3.2). El almacén admite fotografías de hasta 8 MB, pero
// aquí se aceptan 10 MB de origen: lo que se guarda ya está reducido a 1600 px y codificado como JPEG al 85 %.
export const MEMORY_LIMITS = Object.freeze({
  title: 80,
  text: 1000,
  personAlias: 60,
  people: 20,
  songs: 50,
  photos: 10,
  caption: 200,
  photoBytes: 10 * 1024 * 1024,
  photoSide: 1600,
  jpegQuality: 0.85,
  yearMin: 1000,
  draftMs: 5000,
});

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

// Problema del título, o null si vale. Es obligatorio: sin título no se guarda el recuerdo.
export function validateMemoryTitle(title) {
  return textLengthError(title, {
    max: MEMORY_LIMITS.title,
    required: true,
    emptyMessage: 'Escribe un título para guardar el recuerdo.',
    tooLongMessage: `El título no puede superar ${MEMORY_LIMITS.title} caracteres.`,
  });
}

// Problema del texto del recuerdo (varias líneas admitidas), o null si vale.
export function validateMemoryText(text) {
  return textLengthError(text, {
    max: MEMORY_LIMITS.text,
    multiline: true,
    tooLongMessage: `El texto no puede superar ${MEMORY_LIMITS.text} caracteres.`,
  });
}

// Año escrito en el campo: { year, error }. Vacío significa sin año (null). Si no tiene cuatro cifras, no vale.
export function parseMemoryYear(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { year: null, error: null };
  const year = /^\d{4}$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(year) || year < MEMORY_LIMITS.yearMin) {
    return { year: null, error: 'El año debe tener cuatro cifras, por ejemplo 1974.' };
  }
  return { year, error: null };
}

// Problema de un alias de persona antes de añadirlo a la lista de personas, o null si vale.
export function validatePersonAlias(alias, people = []) {
  const text = String(alias ?? '').trim();
  if (text === '') return 'Escribe el alias de la persona.';
  if (Array.from(text).length > MEMORY_LIMITS.personAlias) {
    return `El alias no puede superar ${MEMORY_LIMITS.personAlias} caracteres.`;
  }
  if (CONTROL_CHARACTERS.test(text)) return 'El alias contiene caracteres no permitidos.';
  const wanted = normalizeSearch(text);
  if (people.some((person) => normalizeSearch(person) === wanted)) return 'Esa persona ya está en la lista.';
  if (people.length >= MEMORY_LIMITS.people) return `Un recuerdo admite hasta ${MEMORY_LIMITS.people} personas.`;
  return null;
}

// Problema de un archivo de fotografía (tipo y tamaño), o null si puede prepararse.
export function validatePhotoFile(file) {
  const type = String(file?.type ?? '').split(';')[0].trim().toLowerCase();
  if (!PHOTO_TYPES.includes(type)) return 'Solo se admiten fotografías JPEG, PNG o WebP.';
  if (!(file.size > 0)) return 'La fotografía está vacía.';
  if (file.size > MEMORY_LIMITS.photoBytes) return 'La fotografía supera el tamaño máximo de 10 MB.';
  return null;
}

// Límite de fotografías: el número actual más las que se quieren añadir no puede superar 10.
export function validatePhotoCount(current, adding = 1) {
  return current + adding > MEMORY_LIMITS.photos
    ? `Un recuerdo admite hasta ${MEMORY_LIMITS.photos} fotografías.`
    : null;
}

// Problema de la descripción de una fotografía (hasta 200 caracteres), o null si vale.
export function validatePhotoCaption(caption) {
  return textLengthError(caption, {
    max: MEMORY_LIMITS.caption,
    tooLongMessage: `La descripción no puede superar ${MEMORY_LIMITS.caption} caracteres.`,
  });
}

// Medidas tras reducir la imagen: el lado mayor cabe en maxSide y la proporción se conserva. Nunca se amplía.
export function computeResizedSize(width, height, maxSide = MEMORY_LIMITS.photoSide) {
  if (!(width > 0) || !(height > 0)) throw new RangeError('La imagen no tiene tamaño.');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// Qué hay que hacer con las fotografías al guardar. entries: [{ key, id, caption, originalCaption }], donde id es
// null en las nuevas y originalCaption lo que había al abrir el recuerdo. Una fotografía cuya descripción cambió se
// vuelve a subir (el almacén no edita descripciones) y la anterior se retira si ya no la usa nadie.
export function planPhotoSave(entries, originalIds = []) {
  const uploads = [];
  const keeps = new Map();
  for (const entry of entries) {
    if (entry.id === null || entry.id === undefined) {
      uploads.push({ key: entry.key, caption: entry.caption, replaces: null });
    } else if (entry.caption !== entry.originalCaption) {
      uploads.push({ key: entry.key, caption: entry.caption, replaces: entry.id });
    } else {
      keeps.set(entry.key, entry.id);
    }
  }
  const kept = new Set(keeps.values());
  const removedIds = originalIds.filter((id) => !kept.has(id));
  return { uploads, keeps, removedIds };
}

// Identificadores definitivos en el orden de las fotografías: los que se conservan y los de las subidas nuevas.
export function assemblePhotoIds(entries, plan, uploadedIds) {
  return entries.map((entry) => plan.keeps.get(entry.key) ?? uploadedIds.get(entry.key));
}

// Instantánea de lo que la persona puede cambiar en el formulario. Sirve para saber si hay cambios sin guardar.
export function snapshotMemory(state) {
  return JSON.stringify({
    title: state.title,
    text: state.text,
    yearText: state.yearText,
    yearApproximate: state.yearApproximate,
    people: state.people,
    songIds: state.songIds,
    photos: state.photos.map((photo) => [photo.key, photo.id, photo.caption]),
  });
}

// Carga una imagen para dibujarla. Devuelve la fuente, sus medidas y la forma de liberarla.
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
    } catch {
      // Sin decodificación directa: se usa el elemento img de respaldo.
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

// Prepara una fotografía: reduce el lado mayor a 1600 px y la codifica como JPEG al 85 %. Al dibujarla en un canvas
// se pierden los metadatos EXIF, incluida la ubicación. El fondo blanco evita que la transparencia de un PNG salga negra.
export async function reencodePhoto(file) {
  const decoded = await decodeImage(file);
  try {
    const { width, height } = computeResizedSize(decoded.width, decoded.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Este navegador no permite preparar fotografías.');
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, width, height);
    context.drawImage(decoded.source, 0, 0, width, height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo preparar la fotografía.'))),
        'image/jpeg',
        MEMORY_LIMITS.jpegQuality,
      );
    });
  } finally {
    decoded.release();
  }
}

// Editor de un recuerdo. params: { profileId, memoryId }; memoryId «nuevo» crea un recuerdo.
export function mountMemoryEditor(root, services, params = {}) {
  const profileId = params.profileId ?? null;
  const requestedId = params.memoryId ?? 'nuevo';
  const seq = nextId('cc-recuerdo');
  const songById = new Map((services.catalog?.songs ?? []).map((song) => [song.id, song]));
  const state = { title: '', text: '', yearText: '', yearApproximate: false, people: [], songIds: [], photos: [] };
  const ui = {};
  const photoFields = new Map();
  let currentId = requestedId === 'nuevo' ? null : requestedId;
  let originalIds = [];
  let savedSnapshot = '';
  let draftSnapshot = null;
  let profileAlias = '';
  let loaded = false;
  let busy = false;
  let disposed = false;
  let photoSequence = 0;
  let draftTimer = null;

  services.setTitle?.(currentId ? 'Editar recuerdo' : 'Nuevo recuerdo');
  root.replaceChildren(h('p', { class: 'cc-estado', role: 'status', text: 'Cargando el recuerdo…' }));
  window.addEventListener('beforeunload', onBeforeUnload);
  init();
  return { unmount };

  // Hay cambios si el formulario, las personas, las canciones o las fotografías difieren de lo guardado.
  function isDirty() {
    return loaded && snapshotMemory(state) !== savedSnapshot;
  }

  async function init() {
    try {
      if (!profileId) throw new Error('Falta el perfil del recuerdo.');
      const profiles = await services.store.listProfiles();
      const profile = profiles.find((item) => item.id === profileId);
      if (!profile) throw new Error('No se encuentra el perfil.');
      let memory = null;
      let storedPhotos = [];
      if (currentId) {
        const memories = await services.store.listMemories(profileId);
        memory = memories.find((item) => item.id === currentId) ?? null;
        if (!memory) throw new Error('No se encuentra ese recuerdo en este perfil.');
        if (memory.photoIds.length > 0) storedPhotos = await services.store.listPhotos(profileId);
      }
      if (disposed) return;
      profileAlias = profile.alias;
      if (memory) fillFromMemory(memory, storedPhotos);
      loaded = true;
      savedSnapshot = snapshotMemory(state);
      build();
      draftTimer = setInterval(autosave, MEMORY_LIMITS.draftMs);
    } catch (error) {
      if (!disposed) renderFailure(messageOf(error, 'No se pudo abrir el recuerdo.'));
    }
  }

  function fillFromMemory(memory, storedPhotos) {
    state.title = memory.title ?? '';
    state.text = memory.text ?? '';
    state.yearText = memory.year === null || memory.year === undefined ? '' : String(memory.year);
    state.yearApproximate = Boolean(memory.yearApproximate) && state.yearText !== '';
    state.people = [...(memory.people ?? [])];
    state.songIds = [...(memory.songIds ?? [])];
    originalIds = [...(memory.photoIds ?? [])];
    const byId = new Map(storedPhotos.map((photo) => [photo.id, photo]));
    state.photos = originalIds
      .map((photoId) => byId.get(photoId))
      .filter(Boolean)
      .map((photo) => ({
        key: `s-${photo.id}`,
        id: photo.id,
        caption: photo.caption ?? '',
        originalCaption: photo.caption ?? '',
        blob: photo.blob,
        previewUrl: services.store.getPhotoUrl(photo),
      }));
  }

  function renderFailure(message) {
    root.replaceChildren(h('div', { class: 'cc-editor' },
      h('button', {
        type: 'button',
        class: 'cc-enlace',
        text: '‹ Volver a recuerdos',
        onClick: () => leave('perfil', { profileId, tab: 'recuerdos' }),
      }),
      h('p', { class: 'cc-alerta', role: 'alert', text: message })));
  }

  // Construye el formulario una sola vez. Después, las personas, las canciones y las fotografías se repintan por partes.
  function build() {
    const id = (name) => `${seq}-${name}`;
    const toRecuerdos = () => leave('perfil', { profileId, tab: 'recuerdos' });

    ui.alertNode = h('div', { class: 'cc-alerta', role: 'alert', hidden: true });
    ui.draftNode = h('p', { class: 'cc-estado-borrador', 'data-testid': 'c-memory-draft' });
    ui.previewButton = h('button', {
      type: 'button',
      class: 'cc-boton cc-boton--secundario',
      text: 'Ver como lo ve el paciente',
      onClick: preview,
    });

    // Título y texto (obligatorio el título; el texto admite 1000 caracteres con contador).
    ui.titleInput = h('input', {
      type: 'text',
      class: 'cc-control',
      autocomplete: 'off',
      value: state.title,
      'data-testid': 'c-memory-title',
    });
    ui.titleField = createField({
      label: 'Título (obligatorio)',
      control: ui.titleInput,
      help: `Hasta ${MEMORY_LIMITS.title} caracteres.`,
    });
    ui.titleInput.addEventListener('input', () => {
      state.title = ui.titleInput.value;
      ui.titleField.setError(null);
      refresh();
    });

    ui.counterNode = h('p', { class: 'cc-contador' });
    ui.textInput = h('textarea', {
      class: 'cc-control',
      rows: 6,
      value: state.text,
      'data-testid': 'c-memory-text',
    });
    ui.textField = createField({
      label: 'Texto del recuerdo',
      control: ui.textInput,
      counter: ui.counterNode,
      help: 'Lo que cuenta la persona o lo que se sabe del recuerdo.',
    });
    ui.textInput.addEventListener('input', () => {
      state.text = ui.textInput.value;
      ui.textField.setError(null);
      refresh();
    });

    // Año: cuatro cifras, con la casilla «Año aproximado».
    ui.yearInput = h('input', {
      type: 'text',
      class: 'cc-control cc-control-corto',
      inputmode: 'numeric',
      autocomplete: 'off',
      maxlength: '4',
      value: state.yearText,
      'data-testid': 'c-memory-year',
    });
    ui.yearField = createField({
      label: 'Año',
      control: ui.yearInput,
      help: 'Cuatro cifras, por ejemplo 1974. Déjalo vacío si no lo sabes.',
    });
    ui.yearInput.addEventListener('input', () => {
      state.yearText = ui.yearInput.value;
      ui.yearField.setError(null);
      refresh();
    });
    ui.approxInput = h('input', { type: 'checkbox', checked: state.yearApproximate });
    ui.approxInput.addEventListener('change', () => {
      state.yearApproximate = ui.approxInput.checked;
      refresh();
    });

    // Personas por alias: fichas con «Quitar» y un campo para añadir.
    ui.personInput = h('input', {
      type: 'text',
      class: 'cc-control',
      autocomplete: 'off',
      enterkeyhint: 'done',
      onKeydown: (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addPerson();
      },
    });
    ui.personField = createField({
      label: 'Añadir persona (alias)',
      control: ui.personInput,
      help: 'Usa un alias o iniciales. No hace falta el nombre real.',
    });
    ui.peopleList = h('ul', { class: 'cc-chips', 'aria-label': 'Personas del recuerdo' });
    ui.peopleEmpty = h('p', { class: 'cc-campo-ayuda', text: 'Todavía no hay personas en este recuerdo.' });

    // Canciones y fotografías (columna lateral en escritorio).
    ui.songsHeading = h('h2', { id: id('canciones'), class: 'cc-seccion-titulo' });
    ui.songsButton = h('button', {
      type: 'button',
      class: 'cc-boton cc-boton--secundario',
      text: 'Elegir canciones',
      onClick: chooseSongs,
    });
    ui.songsEmpty = h('p', { class: 'cc-vacio', text: 'Todavía no hay canciones en este recuerdo.' });
    ui.songsList = h('ul', { class: 'cc-lista-simple', 'aria-labelledby': id('canciones') });

    ui.photosHeading = h('h2', { id: id('fotos'), class: 'cc-seccion-titulo' });
    ui.zoneHint = h('p', { class: 'cc-zona-texto', text: 'Arrastra fotografías aquí o usa «Elegir fotografías».' });
    const dropZone = h('div', {
      class: 'cc-zona-fotos',
      onDragover: (event) => {
        event.preventDefault();
        dropZone.classList.add('cc-zona-fotos--activa');
      },
      onDragleave: () => dropZone.classList.remove('cc-zona-fotos--activa'),
      onDrop: (event) => {
        event.preventDefault();
        dropZone.classList.remove('cc-zona-fotos--activa');
        addFiles(Array.from(event.dataTransfer?.files ?? []));
      },
    },
    ui.zoneHint,
    h('p', { class: 'cc-campo-ayuda', text: 'JPEG, PNG o WebP de hasta 10 MB.' }));
    ui.fileInput = h('input', { type: 'file', accept: PHOTO_TYPES.join(','), multiple: true, hidden: true });
    ui.fileInput.addEventListener('change', () => {
      const files = Array.from(ui.fileInput.files ?? []);
      ui.fileInput.value = '';
      addFiles(files);
    });
    ui.pickButton = h('button', {
      type: 'button',
      class: 'cc-boton cc-boton--secundario',
      text: 'Elegir fotografías',
      onClick: () => ui.fileInput.click(),
    });
    ui.photoMessage = h('p', { class: 'cc-estado', role: 'status' });
    ui.photoEmpty = h('p', { class: 'cc-vacio', text: 'Todavía no hay fotografías en este recuerdo.' });
    ui.photoList = h('ul', { class: 'cc-miniaturas', 'aria-labelledby': id('fotos') });

    // Eliminar (solo recuerdos guardados) y acciones del pie.
    ui.deleteButton = currentId
      ? h('button', { type: 'button', class: 'cc-boton cc-boton--peligro', 'data-testid': 'c-memory-delete', text: 'Eliminar recuerdo', onClick: deleteMemory })
      : null;
    ui.cancelButton = h('button', { type: 'button', class: 'cc-boton cc-boton--secundario', text: 'Cancelar', onClick: toRecuerdos });
    ui.saveButton = h('button', {
      type: 'button',
      class: 'cc-boton cc-boton--primario',
      'data-testid': 'c-memory-save',
      text: 'Guardar recuerdo',
      onClick: () => save(),
    });

    root.replaceChildren(h('div', { class: 'cc-editor cc-editor-recuerdo' },
      h('div', { class: 'cc-editor-cabecera' },
        h('button', { type: 'button', class: 'cc-enlace', text: '‹ Volver a recuerdos', onClick: toRecuerdos }),
        h('p', { class: 'cc-editor-perfil', text: `Perfil: ${profileAlias}` }),
        ui.draftNode,
        ui.previewButton),
      h('div', { class: 'cc-editor-cuerpo' },
        h('form', { class: 'cc-formulario', novalidate: true, onSubmit: (event) => event.preventDefault() },
          ui.alertNode,
          ui.titleField.root,
          ui.textField.root,
          h('div', { class: 'cc-fila-campos' }, ui.yearField.root,
            h('label', { class: 'cc-casilla' }, ui.approxInput, h('span', { text: 'Año aproximado' }))),
          h('section', { class: 'cc-seccion', 'aria-labelledby': id('personas') },
            h('h2', { id: id('personas'), class: 'cc-seccion-titulo', text: 'Personas' }),
            ui.peopleList, ui.peopleEmpty,
            h('div', { class: 'cc-fila-campos' },
              ui.personField.root,
              h('button', { type: 'button', class: 'cc-boton cc-boton--secundario', text: 'Añadir persona', onClick: addPerson }))),
          ui.deleteButton ? h('div', { class: 'cc-zona-peligro' }, ui.deleteButton) : null),
        h('aside', { class: 'cc-columna-lateral', 'aria-label': 'Canciones y fotografías' },
          h('section', { class: 'cc-seccion', 'aria-labelledby': id('canciones') },
            h('div', { class: 'cc-seccion-cabecera' }, ui.songsHeading, ui.songsButton),
            ui.songsEmpty, ui.songsList),
          h('section', { class: 'cc-seccion', 'aria-labelledby': id('fotos') },
            h('div', { class: 'cc-seccion-cabecera' }, ui.photosHeading, ui.pickButton),
            dropZone, ui.fileInput, ui.photoMessage, ui.photoEmpty, ui.photoList))),
      h('div', { class: 'cc-pie' }, ui.cancelButton, ui.saveButton)));

    renderPeople();
    renderSongs();
    renderPhotos();
    refresh();
  }

  // Texto de estado del borrador: «Borrador guardado» solo si el borrador ya contiene el último cambio.
  function draftStatusText() {
    if (busy) return 'Guardando…';
    if (!isDirty()) return currentId ? 'Todo guardado' : 'Sin cambios';
    return draftSnapshot !== null && draftSnapshot === snapshotMemory(state)
      ? 'Borrador guardado'
      : 'Cambios sin guardar';
  }

  // Repinta lo que depende del estado: contador, borrador y encabezados con recuentos.
  function refresh() {
    if (!loaded || disposed) return;
    ui.counterNode.textContent = counterLine(charCount(state.text), MEMORY_LIMITS.text);
    ui.draftNode.textContent = draftStatusText();
    ui.songsHeading.textContent = `Canciones (${state.songIds.length} de ${MEMORY_LIMITS.songs})`;
    ui.photosHeading.textContent = `Fotografías (${state.photos.length} de ${MEMORY_LIMITS.photos})`;
  }

  function setBusy(on) {
    busy = on;
    for (const control of [ui.saveButton, ui.cancelButton, ui.previewButton, ui.deleteButton]) {
      if (control) control.disabled = on;
    }
    refresh();
  }

  function showAlert(message) {
    ui.alertNode.textContent = message;
    ui.alertNode.hidden = false;
  }

  function clearErrors() {
    ui.alertNode.hidden = true;
    ui.titleField.setError(null);
    ui.textField.setError(null);
    ui.yearField.setError(null);
    for (const field of photoFields.values()) field.setError(null);
  }

  // Problemas actuales del formulario. count suma todos los campos con error.
  function collectProblems() {
    const problems = {
      title: validateMemoryTitle(state.title),
      text: validateMemoryText(state.text),
      year: parseMemoryYear(state.yearText).error,
      photos: {},
    };
    for (const photo of state.photos) {
      const message = validatePhotoCaption(photo.caption);
      if (message) problems.photos[photo.key] = message;
    }
    problems.count = [problems.title, problems.text, problems.year].filter(Boolean).length
      + Object.keys(problems.photos).length;
    return problems;
  }

  function showProblems(problems) {
    ui.titleField.setError(problems.title);
    ui.textField.setError(problems.text);
    ui.yearField.setError(problems.year);
    for (const [key, message] of Object.entries(problems.photos)) photoFields.get(key)?.setError(message);
    showAlert('Revisa los campos marcados.');
    const firstPhotoKey = Object.keys(problems.photos)[0];
    const target = problems.title ? ui.titleInput
      : problems.text ? ui.textInput
        : problems.year ? ui.yearInput
          : photoFields.get(firstPhotoKey)?.control;
    target?.focus();
    services.announce?.('Revisa los campos marcados.');
  }

  // Guarda el recuerdo y, salvo que leaveAfter sea false, vuelve a la pestaña Recuerdos del perfil.
  // Devuelve true si se guardó.
  async function save({ leaveAfter = true } = {}) {
    if (busy || !loaded || disposed) return false;
    clearErrors();
    const problems = collectProblems();
    if (problems.count > 0) {
      showProblems(problems);
      return false;
    }
    setBusy(true);
    const uploaded = new Map();
    try {
      const entries = state.photos.map((photo) => ({
        key: photo.key,
        id: photo.id,
        caption: photo.caption.trim(),
        originalCaption: photo.originalCaption,
      }));
      const plan = planPhotoSave(entries, originalIds);
      try {
        for (const upload of plan.uploads) {
          const photo = state.photos.find((item) => item.key === upload.key);
          const stored = await services.store.addPhoto(profileId, photo.blob, { caption: upload.caption });
          uploaded.set(upload.key, stored.id);
        }
      } catch (error) {
        await discardPhotos(uploaded);
        throw error;
      }
      const photoIds = assemblePhotoIds(entries, plan, uploaded);
      const year = parseMemoryYear(state.yearText).year;
      let record;
      try {
        record = await services.store.saveMemory({
          ...(currentId ? { id: currentId } : {}),
          profileId,
          title: state.title.trim(),
          text: state.text.trim(),
          year,
          yearApproximate: year !== null && state.yearApproximate,
          people: [...state.people],
          songIds: [...state.songIds],
          photoIds,
        });
      } catch (error) {
        await discardPhotos(uploaded);
        throw error;
      }
      currentId = record.id;
      try {
        await releaseUnusedPhotos(plan.removedIds, currentId);
      } catch {
        // El recuerdo ya está guardado: las fotografías sobrantes se quedan y no impiden continuar.
      }
      originalIds = [...photoIds];
      adoptSavedPhotos(uploaded);
      savedSnapshot = snapshotMemory(state);
      draftSnapshot = null;
      services.announce?.('Recuerdo guardado.');
      if (leaveAfter) services.navigate('perfil', { profileId, tab: 'recuerdos' });
      return true;
    } catch (error) {
      if (!disposed) showAlert(messageOf(error, 'No se pudo guardar el recuerdo. Inténtalo de nuevo.'));
      return false;
    } finally {
      if (!disposed) setBusy(false);
    }
  }

  // Tras guardar, las fotografías subidas pasan a ser existentes y las anteriores ya no cuentan como cambios.
  function adoptSavedPhotos(uploaded) {
    for (const photo of state.photos) {
      const storedId = uploaded.get(photo.key);
      if (storedId) photo.id = storedId;
      photo.originalCaption = photo.caption.trim();
    }
  }

  // Borra las fotografías subidas en un guardado que no llegó a completarse.
  async function discardPhotos(uploaded) {
    for (const storedId of uploaded.values()) {
      try {
        await services.store.deletePhoto(storedId);
      } catch {
        // Si no se puede borrar, queda una fotografía sin uso; no bloquea el error de fondo.
      }
    }
  }

  // Retira las fotografías que ya no usa ningún recuerdo (excepto exceptMemoryId, si se indica).
  // Una fotografía que otro recuerdo sigue usando se conserva.
  async function releaseUnusedPhotos(photoIds, exceptMemoryId) {
    if (photoIds.length === 0) return;
    const memories = await services.store.listMemories(profileId);
    for (const photoId of photoIds) {
      const used = memories.some((memory) => memory.id !== exceptMemoryId && memory.photoIds.includes(photoId));
      if (!used) await services.store.deletePhoto(photoId);
    }
  }

  async function deleteMemory() {
    if (!currentId || busy || disposed) return;
    const confirmed = await services.confirm({
      title: '¿Eliminar este recuerdo?',
      body: 'Se borran el texto, las personas, las canciones y las fotografías que no usa otro recuerdo. No se puede deshacer.',
      confirmLabel: 'Eliminar recuerdo',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!confirmed || disposed) return;
    setBusy(true);
    try {
      const removedIds = [...originalIds];
      await services.store.deleteMemory(currentId);
      try {
        await releaseUnusedPhotos(removedIds, null);
      } catch {
        // El recuerdo ya se ha borrado; las fotografías sobrantes se quedan sin uso.
      }
      savedSnapshot = snapshotMemory(state);
      services.announce?.('Recuerdo eliminado.');
      services.navigate('perfil', { profileId, tab: 'recuerdos' });
    } catch (error) {
      if (!disposed) {
        setBusy(false);
        showAlert(messageOf(error, 'No se pudo eliminar el recuerdo.'));
      }
    }
  }

  // Añade fotografías del equipo: valida, prepara cada una y las pone en la lista. Lo que no vale se dice.
  async function addFiles(files) {
    if (busy || disposed || files.length === 0) return;
    const valid = files.filter((file) => validatePhotoFile(file) === null);
    if (valid.length === 0) {
      setPhotoMessage(validatePhotoFile(files[0]) ?? 'No hay fotografías que añadir.');
      return;
    }
    const countProblem = validatePhotoCount(state.photos.length, valid.length);
    if (countProblem) {
      setPhotoMessage(countProblem);
      return;
    }
    let addedCount = 0;
    for (let index = 0; index < valid.length; index += 1) {
      setPhotoMessage(`Preparando la fotografía ${index + 1} de ${valid.length}…`);
      try {
        const blob = await reencodePhoto(valid[index]);
        if (disposed) return;
        photoSequence += 1;
        state.photos = [...state.photos, {
          key: `n-${photoSequence}`,
          id: null,
          caption: '',
          originalCaption: null,
          blob,
          previewUrl: URL.createObjectURL(blob),
        }];
        addedCount += 1;
      } catch {
        // Esta fotografía no se puede leer: se sigue con las demás y se cuenta al final.
      }
    }
    if (disposed) return;
    renderPhotos();
    refresh();
    const notAdded = files.length - addedCount;
    const parts = [];
    if (addedCount > 0) parts.push(`${pluralize(addedCount, 'fotografía añadida', 'fotografías añadidas')}.`);
    if (notAdded > 0) {
      parts.push(`${pluralize(notAdded, 'fotografía no se añadió', 'fotografías no se añadieron')}: `
        + 'formato, tamaño o lectura no válidos.');
    }
    setPhotoMessage(parts.join(' '));
  }

  function setPhotoMessage(text) {
    ui.photoMessage.textContent = text;
  }

  function renderPhotos() {
    photoFields.clear();
    ui.photoList.replaceChildren(...state.photos.map((photo, index) => photoItem(photo, index)));
    ui.photoList.hidden = state.photos.length === 0;
    ui.photoEmpty.hidden = state.photos.length > 0;
  }

  // Una fotografía: miniatura, descripción (hasta 200 caracteres) y los botones de orden y de quitar.
  function photoItem(photo, index) {
    const number = index + 1;
    const total = state.photos.length;
    const compact = 'cc-boton cc-boton--secundario cc-boton--compacto';
    const captionInput = h('input', { type: 'text', class: 'cc-control', autocomplete: 'off', value: photo.caption });
    const field = createField({
      label: `Descripción de la fotografía ${number}`,
      control: captionInput,
      help: `Hasta ${MEMORY_LIMITS.caption} caracteres.`,
    });
    captionInput.addEventListener('input', () => {
      photo.caption = captionInput.value;
      field.setError(null);
      refresh();
    });
    photoFields.set(photo.key, field);
    return h('li', { class: 'cc-miniatura' },
      h('img', {
        class: 'cc-miniatura-imagen',
        src: photo.previewUrl,
        alt: photo.caption || `Fotografía ${number} sin descripción`,
      }),
      field.root,
      h('div', { class: 'cc-acciones-fila' },
        h('button', { type: 'button', class: compact, disabled: index === 0, onClick: () => movePhoto(index, -1) },
          'Subir', h('span', { class: 'visually-hidden', text: ` fotografía ${number}` })),
        h('button', { type: 'button', class: compact, disabled: index === total - 1, onClick: () => movePhoto(index, 1) },
          'Bajar', h('span', { class: 'visually-hidden', text: ` fotografía ${number}` })),
        h('button', { type: 'button', class: compact, onClick: () => removePhoto(index) },
          'Quitar', h('span', { class: 'visually-hidden', text: ` fotografía ${number}` }))));
  }

  // Lleva el foco al primer botón activo de la miniatura; devuelve false si no existe.
  function focusPhoto(index) {
    const target = ui.photoList.children[index]?.querySelector('button:not([disabled])');
    target?.focus();
    return Boolean(target);
  }

  function movePhoto(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= state.photos.length) return;
    state.photos = moveItem(state.photos, index, delta);
    renderPhotos();
    refresh();
    focusPhoto(target);
  }

  function removePhoto(index) {
    const removed = state.photos[index];
    if (!removed) return;
    state.photos = state.photos.filter((_, position) => position !== index);
    if (removed.previewUrl) services.store.revokePhotoUrl(removed.previewUrl);
    renderPhotos();
    refresh();
    if (!focusPhoto(index)) ui.pickButton.focus();
  }

  function renderPeople() {
    ui.peopleList.replaceChildren(...state.people.map((person, index) => h('li', { class: 'cc-chip' },
      h('span', { class: 'cc-chip-texto', text: person }),
      h('button', { type: 'button', class: 'cc-chip-quitar', onClick: () => removePerson(index) },
        'Quitar', h('span', { class: 'visually-hidden', text: ` ${person}` })))));
    ui.peopleList.hidden = state.people.length === 0;
    ui.peopleEmpty.hidden = state.people.length > 0;
  }

  function addPerson() {
    const candidate = ui.personInput.value.trim();
    const problem = validatePersonAlias(candidate, state.people);
    if (problem) {
      ui.personField.setError(problem);
      ui.personInput.focus();
      return;
    }
    state.people = [...state.people, candidate];
    ui.personInput.value = '';
    ui.personField.setError(null);
    renderPeople();
    refresh();
  }

  function removePerson(index) {
    state.people = state.people.filter((_, position) => position !== index);
    renderPeople();
    refresh();
    ui.personInput.focus();
  }

  // Selector de canciones del catálogo (hasta 50). Lo elegido sustituye a la selección, con el orden existente.
  async function chooseSongs() {
    const picked = await openSongPicker(services, {
      selectedIds: state.songIds,
      max: MEMORY_LIMITS.songs,
      title: 'Elegir canciones',
    });
    if (!picked || disposed) return;
    state.songIds = mergeSelection(state.songIds, picked);
    renderSongs();
    refresh();
    services.announce?.(`El recuerdo tiene ${pluralize(state.songIds.length, 'canción', 'canciones')}.`);
    ui.songsButton.focus();
  }

  function renderSongs() {
    ui.songsList.replaceChildren(...state.songIds.map((songId, index) => {
      const song = songById.get(songId);
      const title = song?.title || 'Canción no disponible en el catálogo';
      const details = [song?.artist, formatDuration(song?.duration_s)].filter(Boolean).join(' · ');
      return h('li', { class: 'cc-fila-simple' },
        h('div', { class: 'cc-fila-texto' },
          h('p', { class: 'cc-fila-titulo', text: title }),
          details ? h('p', { class: 'cc-meta', text: details }) : null),
        h('button', { type: 'button', class: 'cc-boton cc-boton--secundario cc-boton--compacto', onClick: () => removeSong(index) },
          'Quitar', h('span', { class: 'visually-hidden', text: ` ${title}` })));
    }));
    ui.songsList.hidden = state.songIds.length === 0;
    ui.songsEmpty.hidden = state.songIds.length > 0;
  }

  function removeSong(index) {
    state.songIds = state.songIds.filter((_, position) => position !== index);
    renderSongs();
    refresh();
    ui.songsButton.focus();
  }

  // Vista previa del paciente: no registra nada. Si hay cambios, se ofrece guardarlos antes.
  async function preview() {
    if (!loaded || busy || disposed) return;
    if (isDirty()) {
      const saveFirst = await services.confirm({
        title: 'Guardar antes de ver',
        body: 'La vista previa muestra el recuerdo tal como está guardado.',
        confirmLabel: 'Guardar y ver',
        cancelLabel: 'Seguir editando',
        danger: false,
      });
      if (!saveFirst) return;
      const saved = await save({ leaveAfter: false });
      if (!saved || disposed) return;
    }
    services.startPreview?.(profileId);
  }

  // Salir (volver o cancelar) con cambios sin guardar pide confirmación.
  async function leave(route, routeParams) {
    if (isDirty()) {
      const leaveNow = await services.confirm({
        title: 'Salir sin guardar',
        body: 'El recuerdo tiene cambios que no se han guardado.',
        confirmLabel: 'Salir sin guardar',
        cancelLabel: 'Seguir editando',
        danger: true,
      });
      if (!leaveNow) return;
    }
    services.navigate(route, routeParams);
  }

  // Borrador automático cada 5 s. El almacén todavía no ofrece borradores: mientras falte store.saveMemoryDraft,
  // el estado se queda en «Cambios sin guardar», que es lo que de verdad ocurre (ver apisFaltantes del informe).
  async function autosave() {
    if (disposed || busy || !isDirty()) return;
    if (typeof services.store.saveMemoryDraft !== 'function') return;
    const snapshot = snapshotMemory(state);
    try {
      await services.store.saveMemoryDraft(profileId, currentId, {
        title: state.title,
        text: state.text,
        yearText: state.yearText,
        yearApproximate: state.yearApproximate,
        people: [...state.people],
        songIds: [...state.songIds],
      });
      if (!disposed) {
        draftSnapshot = snapshot;
        refresh();
      }
    } catch {
      // Sin borrador: el estado sigue siendo «Cambios sin guardar».
    }
  }

  function onBeforeUnload(event) {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  function unmount() {
    disposed = true;
    clearInterval(draftTimer);
    window.removeEventListener('beforeunload', onBeforeUnload);
    for (const photo of state.photos) {
      if (photo.previewUrl) services.store.revokePhotoUrl(photo.previewUrl);
    }
    root.replaceChildren();
  }
}

// Ruta del recuerdo (contrato 2.4): recuerdo/:profileId/:memoryId.
export const routes = Object.freeze({ recuerdo: mountMemoryEditor });
