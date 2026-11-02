// Pantalla Escuchar del modo paciente (P1; DESIGN 3.1, 6.1 P-4 a P-10, 8.1 a 8.3; contrato 2.2 a 2.4 y 5).
// Portada, título, progreso, transporte, volumen, fotografía y recuerdo. Además, los dos diálogos que cuelgan
// de esta pantalla: el recuerdo ampliado (P1b) y el aviso de apagado (P6).
// Las funciones de formato y de presentación son puras (exportadas para las pruebas); el resto toca el DOM
// y pide la reproducción al reproductor de services. Nada se reproduce al abrir la pantalla (DESIGN 8.1).
import { createTapGuard, element, icon, nextId, openModal } from './shell.js';

export const ZOOM_LEVELS = Object.freeze([1, 1.5, 2, 3]);
export const PRESENTATIONS = Object.freeze(['C0', 'C1', 'C2']);
export const VOLUME_STEPS = 10;
export const SEEK_SECONDS = 5;
export const EXTEND_MINUTES = 15;
export const SLEEP_WARNING_MS = 30 * 1000;
export const NO_TRACK_TEXT = 'No suena nada. Elige una lista o una carpeta.';
export const NO_MEMORY_TEXT = 'Sin recuerdo guardado';
export const NO_PHOTO_TEXT = 'Sin fotografía';
export const NO_YEAR_TEXT = 'Año aproximado';
export const NO_ARTIST_TEXT = 'Artista desconocido';

const TICK_MS = 250;
// Valores por defecto de las opciones del paciente (DESIGN C3f), si el perfil no las trae.
const DEFAULT_OPTIONS = Object.freeze({ volumeLimit: 100, repeatList: true, resumeOnOpen: false, seekOnTap: false });

// ---------- Funciones puras ----------

// Número entero de pasos de volumen, de 0 a 10. Valores no válidos se leen como 0.
export function clampStep(step) {
  const value = Math.round(Number(step));
  if (!Number.isFinite(value)) return 0;
  return Math.min(VOLUME_STEPS, Math.max(0, value));
}

// Tiempo en m:ss, con cifras tabulares en pantalla. Valores no válidos o negativos se leen como 0:00.
export function formatClock(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

// Duración leída en voz alta, en español: «1 minuto 12 segundos».
export function spokenDuration(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  const parts = [];
  if (minutes > 0) parts.push(minutes === 1 ? '1 minuto' : `${minutes} minutos`);
  if (rest > 0 || minutes === 0) parts.push(rest === 1 ? '1 segundo' : `${rest} segundos`);
  return parts.join(' ');
}

// Texto del rol slider del progreso (P-6): «1 minuto 12 segundos de 3 minutos 45 segundos».
export function progressDescription(position, duration) {
  return `${spokenDuration(position)} de ${spokenDuration(duration)}`;
}

// Anuncio del volumen (P-8): «Volumen 6 de 10».
export function spokenVolume(step) {
  return `Volumen ${clampStep(step)} de ${VOLUME_STEPS}`;
}

// Porcentaje de la pista de progreso, de 0 a 100.
export function progressPercent(position, duration) {
  if (!(duration > 0)) return 0;
  const ratio = Math.min(1, Math.max(0, position / duration));
  return ratio * 100;
}

// Segundo de la canción al que corresponde un toque, a partir del ancho de la pista. null si no se puede calcular.
export function seekFromPointer(pointerX, trackLeft, trackWidth, duration) {
  if (!(trackWidth > 0) || !(duration > 0)) return null;
  const ratio = Math.min(1, Math.max(0, (pointerX - trackLeft) / trackWidth));
  return ratio * duration;
}

// El volumen baja mientras no esté en 0; sube mientras no llegue al límite del perfil (DESIGN P-8).
export function canVolumeDown(step) {
  return clampStep(step) > 0;
}

export function canVolumeUp(step, limitStep = VOLUME_STEPS) {
  return clampStep(step) < clampStep(limitStep);
}

// Inicial de la portada sin portada (P-4): la primera letra o cifra del título, en mayúscula.
export function initialOf(title) {
  const text = String(title ?? '').trim();
  const first = Array.from(text).find((char) => /[\p{L}\p{N}]/u.test(char));
  return first ? first.toLocaleUpperCase('es') : '';
}

// Presentación efectiva de una canción (DESIGN 8.2 y 8.3). Con «Solo audio» es C0 en toda la sesión; si no,
// la presentación de la asociación de la canción, y C0 si no la tiene.
export function resolvePresentation(condition, link) {
  if (condition === 'solo-audio') return 'C0';
  const value = link?.presentation;
  return PRESENTATIONS.includes(value) ? value : 'C0';
}

// Recuerdos del perfil que contienen la canción, en el orden del almacén.
export function memoriesForSong(memories, songId) {
  if (!Array.isArray(memories) || typeof songId !== 'string') return [];
  return memories.filter((memory) => Array.isArray(memory.songIds) && memory.songIds.includes(songId));
}

// Siguiente índice con vuelta al inicio (para «Otro recuerdo»).
export function nextIndex(index, length) {
  return length > 0 ? (index + 1) % length : 0;
}

// Índice válido dentro de una lista de longitud length (0 si la lista está vacía).
export function clampIndex(index, length) {
  const value = Number.isInteger(index) ? index : 0;
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, value));
}

// Año del recuerdo: cuatro cifras, o «Año aproximado» si no hay año.
export function yearLabel(year) {
  return Number.isInteger(year) ? String(year) : NO_YEAR_TEXT;
}

// Línea de año y personas del recuerdo: «1974 · Hermana, Tío Julio».
export function memoryMetaLine(memory) {
  const parts = [yearLabel(memory?.year ?? null)];
  if (Array.isArray(memory?.people) && memory.people.length > 0) parts.push(memory.people.join(', '));
  return parts.join(' · ');
}

// Texto alternativo de la fotografía: la descripción del cuidador o, si falta, el título del recuerdo.
export function photoAltText(photo, memory) {
  const caption = typeof photo?.caption === 'string' ? photo.caption.trim() : '';
  return caption || `Fotografía del recuerdo «${memory?.title ?? ''}»`;
}

// Contador de fotografías: «1 de 3». Vacío si no hay ninguna.
export function photoCounter(index, total) {
  return total > 0 ? `${index + 1} de ${total}` : '';
}

// Zoom del recuerdo ampliado: avanza o retrocede un nivel sin salir de la lista (DESIGN P1b).
export function zoomStep(index, direction) {
  return clampIndex(index + direction, ZOOM_LEVELS.length);
}

// Pista de la cola a partir de una canción del catálogo. Misma forma que en las listas (audio/<id>.opus).
export function trackFromSong(song) {
  return {
    id: song.id,
    title: song.title ?? '',
    artist: song.artist ?? '',
    year: song.year ?? null,
    coverUrl: null,
    audioUrl: song.audio ?? `audio/${song.id}.opus`,
    folderId: song.folder_id ?? null,
  };
}

// Texto e icono del botón Reproducir/Pausar (P-7): durante la reproducción dice «Pausar».
export function playbackLabels(playing) {
  return { toggle: playing ? 'Pausar' : 'Reproducir', icon: playing ? 'pausar' : 'reproducir' };
}

// Mensaje de ausencia de recuerdo o de carga (DESIGN 8.3 y «Cargando…»).
export function memoryAbsenceText(loading) {
  return loading ? 'Cargando…' : NO_MEMORY_TEXT;
}

// ---------- Recuerdo ampliado (P1b) ----------

// Diálogo del recuerdo completo: fotografía a ancho completo con zoom, texto completo y «Cerrar».
// options.startIndex indica qué fotografía de la lista se muestra. Al cerrar, el foco vuelve al disparador.
export function openMemoryDialog(services, memory, photos = [], options = {}) {
  const list = Array.isArray(photos) ? photos : [];
  const titleId = nextId('p1b');
  const photo = list[clampIndex(options.startIndex ?? 0, list.length)] ?? null;
  let zoomIndex = 0;
  let photoUrl = null;

  const titleNode = element('h2', { class: 'p1b-titulo', id: titleId, tabindex: '-1', text: memory?.title ?? '' });
  const children = [
    element('p', { class: 'p1b-etiqueta', text: 'Recuerdo' }),
    titleNode,
    element('p', { class: 'p1b-meta', text: memoryMetaLine(memory) }),
  ];

  let image = null;
  let zoomOut = null;
  let zoomIn = null;
  if (photo) {
    try {
      photoUrl = services.store.getPhotoUrl(photo);
    } catch (error) {
      console.error('Reminiscencia: no se pudo mostrar la fotografía.', error);
    }
    if (photoUrl) {
      image = element('img', { class: 'p1b-imagen', src: photoUrl, alt: photoAltText(photo, memory) });
      const photoBox = element('div', { class: 'p1b-foto', 'data-testid': 'p1b-photo' }, [image]);
      zoomOut = element('button', {
        type: 'button',
        class: 'p-boton p1b-zoom',
        'data-testid': 'p1b-zoom-out',
        'aria-label': 'Reducir la fotografía',
        on: { click: () => setZoom(zoomStep(zoomIndex, -1)) },
      }, [icon('menos')]);
      zoomIn = element('button', {
        type: 'button',
        class: 'p-boton p1b-zoom',
        'data-testid': 'p1b-zoom-in',
        'aria-label': 'Ampliar la fotografía',
        on: { click: () => setZoom(zoomStep(zoomIndex, 1)) },
      }, [icon('mas')]);
      children.push(photoBox, element('div', { class: 'p1b-zoom-barra' }, [zoomOut, zoomIn]));
    }
  }

  // Zoom por niveles (DESIGN P1b): el «+» y el «−» cambian el ancho de la imagen dentro de su caja con desplazamiento.
  function setZoom(index) {
    zoomIndex = clampIndex(index, ZOOM_LEVELS.length);
    if (image) image.style.width = `${ZOOM_LEVELS[zoomIndex] * 100}%`;
    zoomOut?.setAttribute('aria-disabled', String(zoomIndex === 0));
    zoomIn?.setAttribute('aria-disabled', String(zoomIndex === ZOOM_LEVELS.length - 1));
  }
  setZoom(0);

  if (memory?.text) children.push(element('div', { class: 'p1b-texto', text: memory.text }));

  const closeButton = element('button', {
    type: 'button',
    class: 'p-boton p-boton--secundario p1b-cerrar',
    'data-testid': 'p1b-close',
    text: 'Cerrar',
    on: { click: () => dialog.close() },
  });
  children.push(closeButton);

  const panel = element('section', {
    class: 'p-dialogo p1b',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    'data-testid': 'p1b-dialog',
  }, children);
  const dialog = openModal({ panel, initialFocus: closeButton, onEscape: () => dialog.close() });
  // Se libera la URL de la fotografía al cerrar, para no retener la imagen en memoria.
  dialog.promise.then(() => {
    if (photoUrl) services.store.revokePhotoUrl(photoUrl);
  });
  return dialog.promise;
}

// ---------- Aviso de apagado (P6) ----------

// Aviso 30 segundos antes del apagado programado. «Seguir 15 minutos más» amplía el temporizador;
// «Parar ahora» pausa y cancela el temporizador. Sin respuesta, la música se pausa y la app no se cierra
// (la pausa la hace el reproductor al llegar a cero). Resuelve con: extend, stop, sin-respuesta, fin o cerrado.
export function openSleepWarning(services) {
  const titleId = nextId('p6');
  let done = false;
  let timeout = null;
  let poll = null;

  function finish(result) {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    clearInterval(poll);
    const player = services.player;
    if (result === 'extend') {
      player.extendSleepTimer(EXTEND_MINUTES);
      services.announce?.(`Se añaden ${EXTEND_MINUTES} minutos.`);
    } else if (result === 'stop') {
      player.setSleepTimer(null);
      player.pause();
      services.announce?.('La música está parada.');
    }
    dialog.close(result);
  }

  const extendButton = element('button', {
    type: 'button',
    class: 'p-boton p-boton--primario p-boton--grande',
    'data-testid': 'p6-extend',
    text: `Seguir ${EXTEND_MINUTES} minutos más`,
    on: { click: () => finish('extend') },
  });
  const stopButton = element('button', {
    type: 'button',
    class: 'p-boton p-boton--secundario p-boton--grande',
    'data-testid': 'p6-stop',
    text: 'Parar ahora',
    on: { click: () => finish('stop') },
  });
  const titleNode = element('h2', { class: 'p6-titulo', id: titleId, tabindex: '-1', text: 'La música se para en 30 segundos.' });
  const panel = element('section', {
    class: 'p-dialogo p6',
    role: 'alertdialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    'data-testid': 'p6-dialog',
  }, [titleNode, element('div', { class: 'p6-acciones' }, [extendButton, stopButton])]);

  const dialog = openModal({ panel, initialFocus: extendButton, onEscape: () => finish('cerrado') });
  timeout = setTimeout(() => finish('sin-respuesta'), SLEEP_WARNING_MS);
  // Si el temporizador ya terminó o se canceló desde fuera, el aviso se cierra solo.
  poll = setInterval(() => {
    const state = services.player.getState();
    if (state.sleepMinutesLeft === null || state.sleepMinutesLeft === undefined) finish('fin');
  }, 1000);
  return dialog.promise;
}

// ---------- Pantalla ----------

// Monta la pantalla Escuchar en root y devuelve { unmount() }. Al montarla no suena nada: si el perfil tiene una
// última pista, se deja cargada en pausa (y suena solo con «Reanudar al abrir»).
export function mount(root, services, params = {}) {
  const store = services.store;
  const player = services.player;
  const tap = createTapGuard();
  const titleId = nextId('p1-titulo');

  // ---- Portada (P-4): cuadrada, no interactiva. Sin portada, la inicial en 96 px.
  const coverNode = element('div', { class: 'p1-portada', 'data-testid': 'p1-cover' });

  // ---- Título y artista (P-5); sin pista, la zona de «No suena nada».
  const titleNode = element('h2', { class: 'p1-titulo', 'data-testid': 'p1-title', id: titleId });
  const artistNode = element('p', { class: 'p1-artista', 'data-testid': 'p1-artist' });
  const goListsButton = element('button', {
    type: 'button',
    class: 'p-boton p-boton--secundario',
    'data-testid': 'p1-ir-listas',
    text: 'Ir a Listas',
    on: { click: (event) => goTo('listas', event.currentTarget) },
  });
  const goFoldersButton = element('button', {
    type: 'button',
    class: 'p-boton p-boton--secundario',
    'data-testid': 'p1-ir-carpetas',
    text: 'Ir a Carpetas',
    on: { click: (event) => goTo('carpetas', event.currentTarget) },
  });
  const emptyNode = element('div', { class: 'p1-vacio', 'data-testid': 'p1-empty', hidden: true }, [
    element('p', { class: 'p1-vacio-texto', text: NO_TRACK_TEXT }),
    element('div', { class: 'p1-vacio-acciones' }, [goListsButton, goFoldersButton]),
  ]);

  // ---- Progreso (P-6): zona de 56 px; rol slider con aria-valuetext. Informativo salvo «Saltar al tocar la barra».
  const timeNow = element('span', { class: 'p1-tiempo', 'data-testid': 'p1-time-now', text: '0:00' });
  const timeTotal = element('span', { class: 'p1-tiempo', 'data-testid': 'p1-time-total', text: '0:00' });
  const trackNode = element('span', { class: 'p1-pista', on: { click: (event) => onProgressClick(event) } }, [
    element('span', { class: 'p1-pista-barra' }, [element('span', { class: 'p1-relleno' })]),
    element('span', { class: 'p1-pulgar' }),
  ]);
  const progressNode = element('div', {
    class: 'p1-progreso',
    'data-testid': 'p1-progress',
    role: 'slider',
    'aria-label': 'Progreso de la canción',
    'aria-valuemin': '0',
    'aria-valuemax': '0',
    'aria-valuenow': '0',
    'aria-readonly': 'true',
    'aria-disabled': 'true',
    tabindex: '-1',
    on: { keydown: (event) => onProgressKey(event) },
  }, [timeNow, trackNode, timeTotal]);

  // ---- Transporte (P-7): el texto de la etiqueta va dentro del botón, debajo del círculo.
  const prevButton = element('button', {
    type: 'button',
    class: 'p1-boton p1-boton-lateral',
    'data-testid': 'p1-prev',
    'aria-disabled': 'true',
    on: { click: (event) => onTransport('prev', event.currentTarget) },
  }, [icon('anterior'), element('span', { class: 'p1-etiqueta', text: 'Anterior' })]);
  const toggleIconHolder = element('span', { class: 'p1-icono-zona' }, [icon('reproducir')]);
  const toggleLabel = element('span', { class: 'p1-etiqueta', text: 'Reproducir' });
  const toggleButton = element('button', {
    type: 'button',
    class: 'p1-boton p1-boton-principal',
    'data-testid': 'p1-toggle',
    'aria-disabled': 'true',
    on: { click: (event) => onTransport('toggle', event.currentTarget) },
  }, [toggleIconHolder, toggleLabel]);
  const nextButton = element('button', {
    type: 'button',
    class: 'p1-boton p1-boton-lateral',
    'data-testid': 'p1-next',
    'aria-disabled': 'true',
    on: { click: (event) => onTransport('next', event.currentTarget) },
  }, [icon('siguiente'), element('span', { class: 'p1-etiqueta', text: 'Siguiente' })]);
  const transportNode = element('div', { class: 'p1-transporte' }, [prevButton, toggleButton, nextButton]);

  // ---- Volumen (P-8): diez segmentos decorativos y un aviso que lee «Volumen 6 de 10».
  const segments = Array.from({ length: VOLUME_STEPS }, () => element('span', { class: 'p1-nivel' }));
  const stepsNode = element('div', { class: 'p1-niveles', 'data-testid': 'p1-vol-steps', 'aria-hidden': 'true' }, segments);
  const volumeDown = element('button', {
    type: 'button',
    class: 'p1-boton-volumen',
    'data-testid': 'p1-vol-down',
    'aria-label': 'Bajar volumen',
    'aria-disabled': 'false',
    on: { click: (event) => onVolume(-1, event.currentTarget) },
  }, [icon('menos')]);
  const volumeUp = element('button', {
    type: 'button',
    class: 'p1-boton-volumen',
    'data-testid': 'p1-vol-up',
    'aria-label': 'Subir volumen',
    'aria-disabled': 'false',
    on: { click: (event) => onVolume(1, event.currentTarget) },
  }, [icon('mas')]);
  const volumeLive = element('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const volumeNode = element('div', { class: 'p1-volumen' }, [volumeDown, stepsNode, volumeUp, volumeLive]);

  // ---- Fotografía (P-9): marco 4:3 con su propia caja; la fila de «Foto anterior» queda debajo, fuera del marco.
  const photoImage = element('img', { class: 'p1-foto-imagen', alt: '' });
  const photoButton = element('button', {
    type: 'button',
    class: 'p1-foto-boton',
    'aria-label': 'Ampliar la fotografía',
    on: { click: (event) => onPhotoZoom(event) },
  }, [photoImage]);
  const photoEmpty = element('div', { class: 'p1-foto-vacia' }, [
    icon('foto'),
    element('p', { class: 'p1-foto-texto', text: NO_PHOTO_TEXT }),
  ]);
  const photoFrame = element('div', { class: 'p1-foto', 'data-testid': 'p1-photo' }, [photoButton, photoEmpty]);
  const photoPrevButton = element('button', {
    type: 'button',
    class: 'p-boton p-boton--secundario',
    'data-testid': 'p1-photo-prev',
    text: 'Foto anterior',
    'aria-disabled': 'true',
    on: { click: (event) => movePhoto(-1, event.currentTarget) },
  });
  const photoCountNode = element('span', { class: 'p1-foto-contador', 'data-testid': 'p1-photo-count', 'aria-live': 'polite' });
  const photoNextButton = element('button', {
    type: 'button',
    class: 'p-boton p-boton--secundario',
    'data-testid': 'p1-photo-next',
    text: 'Foto siguiente',
    'aria-disabled': 'true',
    on: { click: (event) => movePhoto(1, event.currentTarget) },
  });
  const photoNav = element('div', { class: 'p1-foto-nav' }, [photoPrevButton, photoCountNode, photoNextButton]);
  const photoZone = element('div', { class: 'p1-foto-zona' }, [photoFrame, photoNav]);

  // ---- Recuerdo (P-10): etiqueta «Recuerdo», título, año y personas, texto con cuatro líneas y dos acciones.
  const memoryLabel = element('p', { class: 'p1-etiqueta-recuerdo', text: 'Recuerdo' });
  const memoryTitle = element('h3', { class: 'p1-titulo-recuerdo', 'data-testid': 'p1-memory-title' });
  const memoryMeta = element('p', { class: 'p1-meta-recuerdo' });
  const memoryText = element('div', { class: 'p1-texto-recuerdo', 'data-testid': 'p1-memory-text' });
  const moreButton = element('button', {
    type: 'button',
    class: 'p-boton p-boton--secundario',
    'data-testid': 'p1-memory-more',
    text: 'Leer todo',
    on: { click: (event) => onReadMore(event) },
  });
  const otherButton = element('button', {
    type: 'button',
    class: 'p-boton p-boton--secundario',
    'data-testid': 'p1-memory-other',
    text: 'Otro recuerdo',
    on: { click: (event) => onOtherMemory(event) },
  });
  const memoryCard = element('article', { class: 'p1-tarjeta', 'data-testid': 'p1-memory' }, [
    memoryLabel,
    memoryTitle,
    memoryMeta,
    memoryText,
    element('div', { class: 'p1-tarjeta-acciones' }, [moreButton, otherButton]),
  ]);

  // Avisos del reproductor (fin de la lista, error de audio, sin conexión), dentro de la pantalla.
  const noticeNode = element('p', { class: 'p1-aviso', role: 'status' });

  const principal = element('div', { class: 'p1-principal' }, [
    coverNode,
    element('div', { class: 'p1-cabecera-pista' }, [titleNode, artistNode, emptyNode]),
    element('section', { class: 'p1-reproductor', 'aria-label': 'Reproductor' }, [
      progressNode,
      transportNode,
      volumeNode,
      noticeNode,
    ]),
  ]);
  const recuerdo = element('div', { class: 'p1-recuerdo' }, [photoZone, memoryCard]);
  const screen = element('div', { class: 'p1-root', 'data-testid': 'p1-root' }, [principal, recuerdo]);
  screen.classList.toggle('escala-grande', currentTextScale() >= 1.5);
  root.replaceChildren(screen);

  // ---- Estado de la pantalla
  const state = {
    ready: false,
    profileId: null,
    songs: new Map(),
    memories: [],
    photos: new Map(),
    trackId: null,
    track: null,
    link: null,
    songMemories: [],
    memoryIndex: 0,
    photoIndex: 0,
    currentMemory: null,
    currentPhotos: [],
    presentation: 'C0',
    condition: 'segun-cancion',
    loadSeq: 0,
    loading: false,
    seekOnTap: false,
    shownKeys: new Set(),
    photoUrl: null,
    photoShownId: null,
    coverKey: undefined,
    toggleIcon: null,
    volumeAnnounced: undefined,
  };
  let disposed = false;
  let timer = null;

  // Preferencias y sesión: la escala de texto decide una columna (DESIGN 5.3); la condición decide la presentación.
  function currentTextScale() {
    try {
      return Number(services.prefs?.get?.('textScale') ?? 1);
    } catch {
      return 1;
    }
  }

  function currentCondition() {
    const session = typeof services.session === 'function' ? services.session() : null;
    return session?.condition === 'solo-audio' ? 'solo-audio' : 'segun-cancion';
  }

  function setText(node, value) {
    const text = String(value ?? '');
    if (node.textContent !== text) node.textContent = text;
  }

  function setAria(node, name, value) {
    const text = String(value);
    if (node.getAttribute(name) !== text) node.setAttribute(name, text);
  }

  function announce(text) {
    services.announce?.(text);
  }

  // Registro del estudio (DESIGN 8.4): services.recordStudyEvent completa la sesión, el perfil y el origen.
  function record(type, fields = {}) {
    if (typeof services.recordStudyEvent !== 'function') return;
    try {
      Promise.resolve(services.recordStudyEvent(type, {
        songId: state.track?.id ?? null,
        presentation: state.presentation,
        ...fields,
      })).catch((error) => console.error('Reminiscencia: no se pudo registrar el evento.', error));
    } catch (error) {
      console.error('Reminiscencia: no se pudo registrar el evento.', error);
    }
  }

  // Un recuerdo se registra como visto una vez por pista (DESIGN 8.4); las condiciones C0 no lo muestran.
  function markShown(memory) {
    if (!memory || state.presentation === 'C0') return;
    const key = `${state.track?.id}/${memory.id}`;
    if (state.shownKeys.has(key)) return;
    state.shownKeys.add(key);
    record('memory-seen');
  }

  function goTo(route, control) {
    if (!tap.accept(control)) return;
    Promise.resolve(services.navigate(route)).catch((error) => console.error('Reminiscencia: navegación.', error));
  }

  // ---- Reproducción: el estado llega del reproductor (contrato 2.2); se consulta al ritmo de TICK_MS.
  function renderCover(track) {
    const key = track ? track.id : null;
    if (state.coverKey === key) return;
    state.coverKey = key;
    coverNode.replaceChildren();
    if (!track) return;
    if (track.coverUrl) {
      coverNode.append(element('img', { class: 'p1-portada-imagen', src: track.coverUrl, alt: '' }));
    } else {
      coverNode.append(element('span', { class: 'p1-inicial', 'aria-hidden': 'true', text: initialOf(track.title) }));
    }
  }

  function renderPlayback(current) {
    const track = current.track ?? null;
    const hasTrack = Boolean(track);
    const position = Number(current.position) || 0;
    const duration = Number(current.duration) || 0;
    const playing = Boolean(current.playing);

    // Título, artista y zona «No suena nada» (P-5).
    renderCover(track);
    emptyNode.hidden = hasTrack;
    setText(titleNode, hasTrack ? track.title || 'Sin título' : 'Ninguna canción');
    setText(artistNode, hasTrack ? track.artist || NO_ARTIST_TEXT : '');

    // Progreso (P-6). Solo es saltable con «Saltar al tocar la barra» y con pista.
    setText(timeNow, formatClock(position));
    setText(timeTotal, formatClock(duration));
    trackNode.style.setProperty('--pct', `${progressPercent(position, duration)}%`);
    setAria(progressNode, 'aria-valuemax', Math.round(duration));
    setAria(progressNode, 'aria-valuenow', Math.round(position));
    setAria(progressNode, 'aria-valuetext', hasTrack ? progressDescription(position, duration) : 'Sin canción');
    setAria(progressNode, 'aria-disabled', hasTrack ? 'false' : 'true');
    const seekable = hasTrack && state.seekOnTap;
    setAria(progressNode, 'aria-readonly', seekable ? 'false' : 'true');
    progressNode.tabIndex = seekable ? 0 : -1;
    trackNode.classList.toggle('es-saltable', seekable);

    // Transporte (P-7): sin pista, aria-disabled="true"; la etiqueta de Reproducir cambia a Pausar.
    setAria(prevButton, 'aria-disabled', hasTrack ? 'false' : 'true');
    setAria(nextButton, 'aria-disabled', hasTrack ? 'false' : 'true');
    setAria(toggleButton, 'aria-disabled', hasTrack ? 'false' : 'true');
    const labels = playbackLabels(playing);
    setText(toggleLabel, labels.toggle);
    if (state.toggleIcon !== labels.icon) {
      state.toggleIcon = labels.icon;
      toggleIconHolder.replaceChildren(icon(labels.icon));
    }

    // Volumen (P-8): segmentos rellenos hasta el nivel actual; los botones se marcan en el mínimo y en el límite.
    const step = clampStep(current.volumeStep);
    const limit = clampStep(current.volumeLimitStep ?? VOLUME_STEPS);
    segments.forEach((segment, index) => segment.classList.toggle('is-on', index < step));
    setAria(volumeDown, 'aria-disabled', canVolumeDown(step) ? 'false' : 'true');
    setAria(volumeUp, 'aria-disabled', canVolumeUp(step, limit) ? 'false' : 'true');
    if (state.volumeAnnounced === undefined) {
      state.volumeAnnounced = step;
    } else if (state.volumeAnnounced !== step) {
      state.volumeAnnounced = step;
      setText(volumeLive, spokenVolume(step));
    }

    // Aviso del reproductor dentro de la pantalla (DESIGN 8.1).
    setText(noticeNode, current.notice ?? '');
  }

  // Cambio de pista: se busca el enlace de la canción y sus recuerdos; el aviso se anuncia una vez por pista.
  function onTrackChanged(playing) {
    const seq = ++state.loadSeq;
    state.link = null;
    state.songMemories = [];
    state.memoryIndex = 0;
    state.photoIndex = 0;
    state.loading = Boolean(state.track);
    renderRecuerdo();
    if (!state.track) return;
    announce(playing ? `Suena: ${state.track.title}.` : `Canción lista: ${state.track.title}.`);
    loadLinkFor(state.track.id, seq);
  }

  async function loadLinkFor(songId, seq) {
    try {
      if (state.profileId) {
        const link = await store.getSongLink(state.profileId, songId);
        if (disposed || seq !== state.loadSeq) return;
        state.link = link ?? null;
      }
      state.songMemories = memoriesForSong(state.memories, songId);
    } catch (error) {
      console.error('Reminiscencia: no se pudieron cargar los datos de la canción.', error);
    }
    if (disposed || seq !== state.loadSeq) return;
    state.loading = false;
    renderRecuerdo();
  }

  function tick() {
    if (disposed || !state.ready) return;
    const current = player.getState();
    const trackId = current.track ? current.track.id : null;
    if (trackId !== state.trackId) {
      state.trackId = trackId;
      state.track = current.track ? { ...current.track } : null;
      onTrackChanged(Boolean(current.playing));
    }
    renderPlayback(current);
    const condition = currentCondition();
    if (condition !== state.condition) {
      state.condition = condition;
      renderRecuerdo();
    }
  }

  // ---- Recuerdo y fotografía (P-9 y P-10): presentación C0, C1 o C2 según la sesión y la asociación.
  function photosOf(memory) {
    return (memory.photoIds ?? []).map((id) => state.photos.get(id)).filter(Boolean);
  }

  function releasePhoto() {
    if (state.photoUrl) store.revokePhotoUrl(state.photoUrl);
    state.photoUrl = null;
    state.photoShownId = null;
  }

  function showPhoto(photo, memory) {
    if (state.photoShownId === photo.id) return;
    releasePhoto();
    try {
      state.photoUrl = store.getPhotoUrl(photo);
    } catch (error) {
      console.error('Reminiscencia: no se pudo mostrar la fotografía.', error);
      return;
    }
    state.photoShownId = photo.id;
    photoImage.src = state.photoUrl;
    photoImage.alt = photoAltText(photo, memory);
    // El nombre del botón describe la acción y lo que se ve: «Ampliar la fotografía: Playa con sombrilla».
    photoButton.setAttribute('aria-label', `Ampliar la fotografía: ${photoImage.alt}`);
    // Fundido de 300 ms al cambiar de foto (DESIGN P-9); con reducir movimiento la duración es 0.
    photoImage.classList.remove('is-fundido');
    void photoImage.offsetWidth;
    photoImage.classList.add('is-fundido');
  }

  function renderRecuerdo() {
    const presentation = state.track ? resolvePresentation(currentCondition(), state.link) : 'C0';
    state.presentation = presentation;
    const shown = presentation === 'C0' ? [] : state.songMemories;
    if (state.memoryIndex >= shown.length) state.memoryIndex = 0;
    const memory = shown[state.memoryIndex] ?? null;
    const photos = memory && presentation === 'C2' ? photosOf(memory) : [];
    if (state.photoIndex >= photos.length) state.photoIndex = 0;
    state.currentMemory = memory;
    state.currentPhotos = photos;

    // Tarjeta de recuerdo (P-10): con recuerdo, sus textos; sin él, el mismo bloque con el texto de ausencia.
    if (memory) {
      memoryLabel.classList.remove('p1-oculto');
      memoryTitle.classList.remove('p1-ausente');
      setText(memoryTitle, memory.title);
      setText(memoryMeta, memoryMetaLine(memory));
      setText(memoryText, memory.text ?? '');
      moreButton.classList.remove('p1-oculto');
      otherButton.classList.toggle('p1-oculto', shown.length < 2);
    } else {
      memoryLabel.classList.add('p1-oculto');
      memoryTitle.classList.add('p1-ausente');
      setText(memoryTitle, memoryAbsenceText(state.loading));
      setText(memoryMeta, '');
      setText(memoryText, '');
      moreButton.classList.add('p1-oculto');
      otherButton.classList.add('p1-oculto');
    }
    // El texto solo es enfocable (para leerlo con el teclado) si desborda sus cuatro líneas.
    const overflows = memoryText.scrollHeight > memoryText.clientHeight + 1;
    memoryText.tabIndex = overflows ? 0 : -1;
    if (overflows) memoryText.setAttribute('aria-label', 'Texto del recuerdo');
    else memoryText.removeAttribute('aria-label');

    // Fotografía (P-9): la foto de la posición actual o el texto «Sin fotografía».
    if (photos.length > 0) {
      showPhoto(photos[state.photoIndex], memory);
      photoButton.hidden = false;
      photoEmpty.hidden = true;
    } else {
      releasePhoto();
      photoImage.removeAttribute('src');
      photoButton.hidden = true;
      photoEmpty.hidden = false;
    }
    const multiple = photos.length > 1;
    photoPrevButton.classList.toggle('p1-oculto', !multiple);
    photoNextButton.classList.toggle('p1-oculto', !multiple);
    photoCountNode.classList.toggle('p1-oculto', !multiple);
    setText(photoCountNode, multiple ? photoCounter(state.photoIndex, photos.length) : '');
    setAria(photoPrevButton, 'aria-disabled', state.photoIndex <= 0 ? 'true' : 'false');
    setAria(photoNextButton, 'aria-disabled', state.photoIndex >= photos.length - 1 ? 'true' : 'false');

    if (memory) markShown(memory);
  }

  // ---- Acciones
  function onTransport(action, control) {
    if (!tap.accept(control)) return;
    if (!state.track) {
      if (action === 'toggle') announce(NO_TRACK_TEXT);
      return;
    }
    if (action === 'prev') player.previous();
    else if (action === 'next') player.next();
    else player.toggle();
    renderPlayback(player.getState());
  }

  function onVolume(delta, control) {
    if (!tap.accept(control)) return;
    const current = player.getState();
    const step = clampStep(current.volumeStep);
    const limit = clampStep(current.volumeLimitStep ?? VOLUME_STEPS);
    if (delta < 0) {
      if (!canVolumeDown(step)) return;
      player.setVolumeStep(step - 1);
    } else {
      if (!canVolumeUp(step, limit)) {
        announce(`Límite de volumen del perfil: ${limit} de ${VOLUME_STEPS}.`);
        return;
      }
      player.setVolumeStep(step + 1);
    }
    renderPlayback(player.getState());
  }

  function onProgressClick(event) {
    if (!state.track || !state.seekOnTap) return;
    const current = player.getState();
    const rect = trackNode.getBoundingClientRect();
    const seconds = seekFromPointer(event.clientX, rect.left, rect.width, current.duration);
    if (seconds === null) return;
    player.seekTo(seconds);
    renderPlayback(player.getState());
  }

  function onProgressKey(event) {
    if (!state.track || !state.seekOnTap) return;
    if (event.key === 'ArrowLeft') player.seekBy(-SEEK_SECONDS);
    else if (event.key === 'ArrowRight') player.seekBy(SEEK_SECONDS);
    else return;
    event.preventDefault();
    renderPlayback(player.getState());
  }

  function movePhoto(delta, control) {
    if (!tap.accept(control)) return;
    const next = state.photoIndex + delta;
    if (next < 0 || next >= state.currentPhotos.length) return;
    state.photoIndex = next;
    renderRecuerdo();
  }

  function onPhotoZoom(event) {
    if (!tap.accept(event.currentTarget)) return;
    const memory = state.currentMemory;
    if (!memory) return;
    record('photo-zoom');
    openMemoryDialog(services, memory, state.currentPhotos, { startIndex: state.photoIndex });
  }

  function onReadMore(event) {
    if (!tap.accept(event.currentTarget)) return;
    const memory = state.currentMemory;
    if (!memory) return;
    openMemoryDialog(services, memory, state.currentPhotos, { startIndex: state.photoIndex });
  }

  function onOtherMemory(event) {
    if (!tap.accept(event.currentTarget)) return;
    const shown = state.presentation === 'C0' ? [] : state.songMemories;
    if (shown.length < 2) return;
    record('memory-other');
    state.memoryIndex = nextIndex(state.memoryIndex, shown.length);
    state.photoIndex = 0;
    renderRecuerdo();
  }

  // ---- Arranque: perfil, opciones, datos del almacén y última pista (contrato 2.3 y DESIGN 8.1).
  async function init() {
    try {
      state.songs = new Map((services.catalog?.songs ?? []).map((song) => [song.id, song]));
      state.profileId = (await store.getActiveProfileId()) ?? null;
      let profile = null;
      if (state.profileId) {
        const profiles = await store.listProfiles();
        profile = profiles.find((item) => item.id === state.profileId) ?? null;
        state.memories = await store.listMemories(state.profileId);
        const photos = await store.listPhotos(state.profileId);
        state.photos = new Map(photos.map((photo) => [photo.id, photo]));
      }
      const options = { ...DEFAULT_OPTIONS, ...(profile?.options ?? {}) };
      state.seekOnTap = options.seekOnTap === true;
      if (profile) player.setProfileLimit(options.volumeLimit);
      // Última pista del perfil (contrato 2.3): se deja cargada en pausa, salvo que «Reanudar al abrir» esté activo.
      const current = player.getState();
      const lastTrack = state.profileId ? await store.getLastTrack(state.profileId) : null;
      if (!current.track && lastTrack) {
        const song = state.songs.get(lastTrack.songId);
        if (song) {
          player.restoreLast(trackFromSong(song), lastTrack.position ?? 0);
          if (options.resumeOnOpen) player.play();
        }
      }
      state.condition = currentCondition();
    } catch (error) {
      console.error('Reminiscencia: no se pudieron cargar los datos de Escuchar.', error);
      setText(noticeNode, 'No se pudieron cargar los datos. Vuelve a intentarlo.');
    }
    state.ready = true;
    tick();
  }

  function unmount() {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    releasePhoto();
    root.replaceChildren();
  }

  services.setTitle?.('Escuchar');
  // Estado inicial de la tarjeta de recuerdo (P-10): sin pista, «Sin recuerdo guardado» y sin etiqueta ni botones.
  // Sin esta llamada, la tarjeta conserva su marcado inicial hasta que suene una pista.
  renderRecuerdo();
  timer = setInterval(tick, TICK_MS);
  init();
  return { unmount };
}

// Rutas que atiende este módulo (contrato 2.4).
export const routes = Object.freeze({ escuchar: mount });
