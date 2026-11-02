// Arranque de Reminiscencia (contrato 2.1 a 2.4; DESIGN 3.3, 7.1, 8.1 a 8.4).
// Crea el almacén, el reproductor, las preferencias y el catálogo; elige el modo al abrir; enruta por hash y
// monta el marco de cada modo con sus servicios. Todo el registro del estudio pasa por recordStudyEvent: lo
// llaman Escuchar y el reproductor (onStudyEvent).
//
// Decisiones que el contrato deja abiertas:
// - Al abrir la página no se mueve el foco: el primer Tab debe llegar al enlace de salto. El foco solo se mueve
//   después de una acción del usuario (userNavigated). Por eso el título del modo paciente se fija sin foco hasta
//   entonces.
// - leavePatientMode no vuelve a pedir el PIN: el marco del paciente ya lo pide con P5 y solo después lo llama.
// - Con perfil activo al abrir en modo paciente se abre una sesión con la última condición usada (DESIGN 8.2: la
//   interfaz del paciente no caduca). Su apagado por defecto sale de los ajustes del dispositivo.
// - Si una sesión se cierra por tres horas sin reproducción, la siguiente reproducción abre otra con la misma
//   condición.
// - ?e2e=1 mide el apagado en segundos (60 minutos son 60 segundos) para probar el aviso P6.

import { openStore } from './store.js';
import { createPlayer, SESSION_IDLE_MS } from './player.js';
import { prefs, PREFS_STORAGE_KEY } from './prefs.js';
import { registerPwa } from './pwa.js';
import { randomId } from './crypto.js';
import {
  isSongId,
  STUDY_CONDITIONS,
  STUDY_EVENT_TYPES,
  STUDY_ORIGINS,
  STUDY_PRESENTATIONS,
} from './schema.js';
import { mountShell as mountPatientShell, element, nextId, openModal } from './paciente/shell.js';
import { openSleepWarning, resolvePresentation, routes as escucharRoutes } from './paciente/escuchar.js';
import {
  cachedSongPaths,
  songsOfList,
  trackOfSong,
  routes as listasRoutes,
} from './paciente/listas.js';
import { songsInFolder, routes as carpetasRoutes } from './paciente/carpetas.js';
import { routes as buscarRoutes } from './paciente/buscar.js';
import {
  mountShell as mountCaregiverShell,
  openDialog,
  applyDisplayAttributes,
  sectionOfRoute,
} from './cuidador/shell.js';
import { routes as inicioRoutes } from './cuidador/inicio.js';
import { routes as bibliotecaRoutes } from './cuidador/biblioteca.js';
import { routes as perfilesRoutes } from './cuidador/perfiles.js';
import { routes as perfilRoutes } from './cuidador/perfil.js';
import { routes as asistenteRoutes } from './cuidador/asistente.js';
import { routes as ajustesRoutes } from './cuidador/ajustes.js';
import { routes as recuerdoRoutes } from './cuidador/recuerdo-editor.js';
import { routes as listaRoutes } from './cuidador/lista-editor.js';
import { routes as observacionesRoutes } from './cuidador/observaciones.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const MODE_KEY = 'reminiscencia.modo';
const CONDITION_KEY = 'reminiscencia.condicion';
const CATALOG_URLS = Object.freeze({ songs: 'data/songs.json', folders: 'data/folders.json' });
const REMEMBER_MS = 10 * 1000;
const ANNOUNCE_DELAY_MS = 50;
const MAX_SECONDS = 86400;
const E2E_HOOK = typeof location !== 'undefined' && new URLSearchParams(location.search).get('e2e') === '1';

// Eventos que ocurren dentro de una pista (exigen canción, presentación, condición y origen; schema.js).
const TRACK_TYPES = new Set(['start', 'pause', 'resume', 'track-end', 'error', 'memory-seen', 'memory-other', 'photo-zoom']);
// Reproducir de nuevo tras una pausa larga o un cierre por inactividad abre una sesión nueva (DESIGN 8.2).
const REOPEN_TYPES = new Set(['start', 'resume']);
// Eventos del reproductor que dejan la última pista del perfil en el almacén.
const REMEMBER_TYPES = new Set(['start', 'resume', 'pause', 'track-end', 'error']);
// Eventos tras los que empieza a contar el tiempo sin reproducción.
const IDLE_TYPES = new Set(['pause', 'track-end', 'error']);

const PREVIEW_BAR_STYLE = 'flex:none;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;'
  + 'gap:8px 16px;padding:8px 16px;background:var(--acento-suave);color:var(--texto);';

// Sección de la navegación del paciente a la que pertenece cada ruta.
const PATIENT_SECTIONS = Object.freeze({
  escuchar: 'escuchar',
  listas: 'listas',
  lista: 'listas',
  carpetas: 'carpetas',
  carpeta: 'carpetas',
  buscar: 'buscar',
});

// Patrones de cada ruta por modo (contrato 2.4). Los segmentos «:nombre» son parámetros de la ruta.
// Lo que no encaja en el patrón viaja en la consulta («#/biblioteca?folderId=…»).
const ROUTE_PATTERNS = Object.freeze({
  paciente: Object.freeze({
    escuchar: 'escuchar',
    listas: 'listas',
    lista: 'lista/:listId',
    carpetas: 'carpetas',
    carpeta: 'carpeta/:folderId',
    buscar: 'buscar',
  }),
  cuidador: Object.freeze({
    inicio: 'inicio',
    biblioteca: 'biblioteca',
    perfiles: 'perfiles',
    perfil: 'perfil/:profileId/:tab',
    asistente: 'asistente',
    ajustes: 'ajustes',
    lista: 'lista/:profileId/:listId',
    recuerdo: 'recuerdo/:profileId/:memoryId',
    observaciones: 'observaciones/:profileId/nueva',
  }),
});

// Pantallas de cada modo: cada módulo exporta su objeto routes (name → mount).
const ROUTES = Object.freeze({
  paciente: Object.freeze({
    ...escucharRoutes,
    ...listasRoutes,
    ...carpetasRoutes,
    ...buscarRoutes,
  }),
  cuidador: Object.freeze({
    ...inicioRoutes,
    ...bibliotecaRoutes,
    ...perfilesRoutes,
    ...perfilRoutes,
    ...asistenteRoutes,
    ...ajustesRoutes,
    ...recuerdoRoutes,
    ...listaRoutes,
    ...observacionesRoutes,
  }),
});

// ---------------------------------------------------------------------------
// Estado del módulo
// ---------------------------------------------------------------------------

let store = null;
let playerApi = null;
let catalog = { songs: [], folders: [] };
let cachedPaths = new Set();
let profiles = [];
let activeId = null;
let activeProfile = null;
let currentMode = 'cuidador';
let services = null;
let shell = null; // { content, setActive, showPreviewButton, unmount } del marco activo.
let current = null; // Pantalla montada (su unmount()).
let renderSeq = 0;
let userNavigated = false;
let renderedHash = null;
let currentRouteName = null;
let previewing = false;
let previewReturn = null;
let session = null; // { id, profileId, condition, startPoint, links }
let resumeAllowed = false;
let lastCondition = 'segun-cancion';
let lastOrigin = null;
let recordingOn = true;
let idleTimer = null;
let studyChain = Promise.resolve();
let sleepDialogOpen = false;
let audioEl = null;
let mountEl = null;
let announcerEl = null;
let previewBar = null;

// ---------------------------------------------------------------------------
// Funciones puras (exportadas para las pruebas)
// ---------------------------------------------------------------------------

/** Fecha y hora ISO 8601 con el desplazamiento local, para que el día del registro sea el día local. */
export function zonedIso(ms) {
  const date = new Date(ms);
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  const offset = -date.getTimezoneOffset();
  const abs = Math.abs(offset);
  const sign = offset < 0 ? '-' : '+';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `.${pad(date.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function hasRoute(mode, route) {
  return Object.hasOwn(ROUTE_PATTERNS[mode] ?? {}, route) && typeof ROUTES[mode]?.[route] === 'function';
}

function decodeSegment(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Ruta y parámetros de un hash en un modo, o null si el hash no corresponde a ninguna ruta de ese modo. */
export function parseRoute(hash, mode) {
  const text = String(hash ?? '').replace(/^#\/?/, '');
  const cut = text.indexOf('?');
  const path = cut === -1 ? text : text.slice(0, cut);
  const query = cut === -1 ? '' : text.slice(cut + 1);
  const segments = path.split('/').filter((part) => part !== '').map(decodeSegment);
  for (const [route, pattern] of Object.entries(ROUTE_PATTERNS[mode] ?? {})) {
    if (!hasRoute(mode, route)) continue;
    const parts = pattern.split('/');
    if (parts.length !== segments.length) continue;
    const params = {};
    const matches = parts.every((part, index) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = segments[index];
        return true;
      }
      return part === segments[index];
    });
    if (!matches) continue;
    for (const [key, value] of new URLSearchParams(query)) {
      if (!Object.hasOwn(params, key)) params[key] = value;
    }
    return { route, params };
  }
  return null;
}

/** Hash canónico de una ruta con sus parámetros, o null si la ruta no existe en el modo o falta un parámetro. */
export function buildHash(mode, route, params = {}) {
  if (!hasRoute(mode, route)) return null;
  const used = new Set();
  const segments = [];
  for (const part of ROUTE_PATTERNS[mode][route].split('/')) {
    if (!part.startsWith(':')) {
      segments.push(part);
      continue;
    }
    const name = part.slice(1);
    const value = params[name];
    if (value === undefined || value === null || value === '') return null;
    used.add(name);
    segments.push(encodeURIComponent(String(value)));
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!used.has(key) && value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const search = query.toString();
  return `#/${segments.join('/')}${search ? `?${search}` : ''}`;
}

/** Modo con el que se abre la app: sin perfiles, cuidador; si no, paciente con «Abrir siempre», o el último modo. */
export function initialModeFor({ hasProfiles = false, alwaysPatientMode = false, lastMode = null } = {}) {
  if (!hasProfiles) return 'cuidador';
  if (alwaysPatientMode) return 'paciente';
  return lastMode === 'paciente' ? 'paciente' : 'cuidador';
}

/** Perfil con la forma que espera el reproductor (límite de volumen y repetición de la lista). */
export function playerProfileOf(profile) {
  const options = profile?.options ?? {};
  return {
    id: profile.id,
    volumeLimit: Number.isFinite(options.volumeLimit) ? options.volumeLimit : 100,
    repeatList: options.repeatList !== false,
  };
}

function clampSeconds(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(MAX_SECONDS, Math.max(0, number)) : 0;
}

function validOrigin(value) {
  return STUDY_ORIGINS.includes(value) ? value : 'continua';
}

// En la prueba ?e2e=1 cada «minuto» del apagado dura un segundo.
function scaleMinutes(minutes) {
  if (!E2E_HOOK || minutes === null || minutes === undefined) return minutes;
  return Number(minutes) / 60;
}

// Presentación del evento. Si la pantalla la pide de forma válida, se usa; si no, la regla de Escuchar
// (solo audio fuerza C0; si no, la asociación de la canción, por defecto C0).
function presentationFor(open, songId, requested) {
  if (STUDY_PRESENTATIONS.includes(requested)) return requested;
  return resolvePresentation(open.condition, open.links.get(songId) ?? null);
}

// ---------------------------------------------------------------------------
// Preferencias, almacenamiento local y avisos
// ---------------------------------------------------------------------------

const prefsService = Object.freeze({
  get: (key) => prefs.get(key),
  set(key, value) {
    const saved = prefs.set(key, value);
    applyDisplay();
    return saved;
  },
  all: () => prefs.all(),
});

function applyDisplay() {
  try {
    applyDisplayAttributes(prefs.all(), document.documentElement);
  } catch (error) {
    console.error('Reminiscencia: no se pudieron aplicar las preferencias de pantalla.', error);
  }
}

function readLocal(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function saveLocal(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Sin almacenamiento, el valor vale solo hasta recargar.
  }
}

// Región aria-live del body. Se vacía antes de escribir para que un mismo texto vuelva a leerse.
function announce(text) {
  if (!announcerEl) return;
  const value = String(text ?? '');
  announcerEl.textContent = '';
  setTimeout(() => {
    if (announcerEl) announcerEl.textContent = value;
  }, ANNOUNCE_DELAY_MS);
}

// Título del modo paciente sin mover el foco (arranque): el marco de paciente lo enfoca siempre.
function setTitleQuietly(text) {
  const value = String(text ?? '');
  const heading = document.querySelector('#app .p-title');
  if (heading) heading.textContent = value;
  document.title = value ? `${value} · Reminiscencia` : 'Reminiscencia';
}

function focusHeading() {
  const heading = document.querySelector('#app .c-title, #app .p-title');
  if (heading && typeof heading.focus === 'function') heading.focus();
}

// ---------------------------------------------------------------------------
// Confirmaciones (services.confirm)
// ---------------------------------------------------------------------------

function confirmInCaregiverMode({ title, body, confirmLabel, cancelLabel, danger }) {
  return openDialog({
    title,
    className: danger ? 'c-dialog--danger' : '',
    cancelValue: false,
    initialFocus: (dialog) => dialog.querySelector('[data-testid="app-confirm-cancel"]'),
    render(content, close) {
      if (body) content.append(element('p', { text: body }));
      const cancel = element('button', {
        type: 'button',
        class: 'c-btn c-btn--secondary',
        'data-testid': 'app-confirm-cancel',
        text: cancelLabel,
        on: { click: () => close(false) },
      });
      const accept = element('button', {
        type: 'button',
        class: danger ? 'c-btn c-btn--danger' : 'c-btn c-btn--primary',
        'data-testid': 'app-confirm-ok',
        text: confirmLabel,
        on: { click: () => close(true) },
      });
      content.append(element('div', { class: 'c-dialog-actions' }, [cancel, accept]));
    },
  }).then(Boolean);
}

function confirmInPatientMode({ title, body, confirmLabel, cancelLabel }) {
  const titleId = nextId('app-confirmar');
  let modal = null;
  const cancel = element('button', {
    type: 'button',
    class: 'p-boton p-boton--secundario',
    'data-testid': 'app-confirm-cancel',
    text: cancelLabel,
    on: { click: () => modal?.close(false) },
  });
  const accept = element('button', {
    type: 'button',
    class: 'p-boton p-boton--primario',
    'data-testid': 'app-confirm-ok',
    text: confirmLabel,
    on: { click: () => modal?.close(true) },
  });
  const panel = element('section', {
    class: 'p-dialogo',
    role: 'alertdialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    'data-testid': 'app-confirm',
  }, [
    element('h2', { id: titleId, tabindex: '-1', text: title }),
    body ? element('p', { text: body }) : null,
    element('div', { class: 'p-dialogo-acciones' }, [cancel, accept]),
  ]);
  modal = openModal({ panel, initialFocus: cancel, onEscape: () => modal?.close(false) });
  return modal.promise.then(Boolean);
}

function askConfirmation({ title = '', body = '', confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false } = {}) {
  return currentMode === 'paciente'
    ? confirmInPatientMode({ title, body, confirmLabel, cancelLabel })
    : confirmInCaregiverMode({ title, body, confirmLabel, cancelLabel, danger });
}

// ---------------------------------------------------------------------------
// Estructura de la página
// ---------------------------------------------------------------------------

function ensureAppRoot() {
  let root = document.getElementById('app');
  if (!root) {
    root = document.createElement('div');
    root.id = 'app';
    document.body.append(root);
  }
  return root;
}

// El audio oculto y el contenedor de los marcos van dentro de #app. Los marcos solo reemplazan su contenedor.
function buildFrame(root) {
  audioEl = element('audio', { preload: 'metadata', hidden: true, 'data-testid': 'app-audio' });
  mountEl = element('div', { class: 'app-mount' });
  root.append(audioEl, mountEl);
  announcerEl = element('div', {
    class: 'visually-hidden',
    'aria-live': 'polite',
    'aria-atomic': 'true',
    'data-testid': 'app-announce',
  });
  document.body.append(announcerEl);
}

function showBootError() {
  document.title = 'Reminiscencia';
  const target = document.getElementById('app') ?? document.body;
  const reload = element('button', {
    type: 'button',
    class: 'p-boton p-boton--primario',
    text: 'Recargar la página',
    on: { click: () => location.reload() },
  });
  const message = element('section', { class: 'app-error', role: 'alert', 'data-testid': 'app-error' }, [
    element('h1', { text: 'Reminiscencia no se ha podido abrir' }),
    element('p', { text: 'Recarga la página. Si sigue sin abrirse, prueba con otro navegador o revisa que el sitio pueda guardar datos.' }),
    reload,
  ]);
  target.replaceChildren(message);
}

// Barra de «Vista previa» del paciente: va dentro del contenedor, encima del marco del paciente.
function previewBarNode() {
  if (!previewBar) {
    previewBar = element('div', {
      class: 'app-preview',
      role: 'region',
      'aria-label': 'Vista previa',
      'data-testid': 'app-preview',
      style: PREVIEW_BAR_STYLE,
    }, [
      element('p', { text: 'Vista previa como paciente', style: 'margin:0' }),
      element('button', {
        type: 'button',
        class: 'p-boton p-boton--compacto',
        'data-testid': 'app-preview-exit',
        text: 'Volver al modo cuidador',
        on: { click: () => endPreview().catch(logError('Reminiscencia: no se pudo volver al modo cuidador.')) },
      }),
    ]);
  }
  return previewBar;
}

function syncPreviewChrome() {
  if (previewing && currentMode === 'paciente') {
    mountEl.prepend(previewBarNode());
    mountEl.style.cssText = 'display:flex;flex-direction:column;height:100dvh;';
    const frame = mountEl.querySelector('.p-shell');
    if (frame) frame.style.cssText = 'flex:1 1 auto;min-height:0;height:auto;';
  } else {
    previewBar?.remove();
    mountEl.style.cssText = '';
  }
}

// ---------------------------------------------------------------------------
// Registro del estudio y sesión de escucha (DESIGN 8.2 y 8.4)
// ---------------------------------------------------------------------------

// Las escrituras del estudio van en cola, en orden: inicio de sesión, eventos y fin de sesión no se cruzan.
function enqueue(task) {
  studyChain = studyChain
    .then(task)
    .catch((error) => console.error('Reminiscencia: no se pudo completar una operación del registro.', error));
  return studyChain;
}

async function writeEvent(record) {
  if (!recordingOn) return;
  try {
    await store.recordStudyEvent(record);
  } catch (error) {
    console.error('Reminiscencia: no se pudo registrar un evento del estudio.', error);
  }
}

function buildRecord(open, type, atMs, fields) {
  const track = TRACK_TYPES.has(type);
  const songId = track && isSongId(fields.songId) ? fields.songId : null;
  return {
    type,
    at: zonedIso(atMs),
    sessionId: open.id,
    profileId: open.profileId,
    songId,
    presentation: track ? presentationFor(open, songId, fields.presentation) : null,
    condition: open.condition,
    origin: track ? validOrigin(fields.origin) : null,
    seconds: fields.seconds ?? null,
    completed: fields.completed ?? null,
    trackSeconds: fields.trackSeconds ?? null,
  };
}

async function loadLinks(profileId) {
  try {
    const links = await store.listSongLinks(profileId);
    return new Map(links.map((link) => [link.songId, link]));
  } catch (error) {
    console.error('Reminiscencia: no se pudieron leer las asociaciones de canciones.', error);
    return new Map();
  }
}

function cancelIdle() {
  clearTimeout(idleTimer);
  idleTimer = null;
}

// Tras tres horas sin reproducción la sesión se cierra en el registro (DESIGN 8.2).
function armIdle(fromMs) {
  cancelIdle();
  if (!session) return;
  const delay = Math.max(0, fromMs + SESSION_IDLE_MS - Date.now());
  idleTimer = setTimeout(() => {
    idleTimer = null;
    enqueue(() => endSession(fromMs + SESSION_IDLE_MS));
  }, delay);
}

async function beginSession(profile, request = {}) {
  await endSession(Date.now());
  const condition = STUDY_CONDITIONS.includes(request.condition) ? request.condition : 'segun-cancion';
  const links = await loadLinks(profile.id);
  const now = Date.now();
  session = {
    id: randomId(),
    profileId: profile.id,
    condition,
    startPoint: request.startPoint ?? null,
    links,
  };
  resumeAllowed = true;
  lastCondition = condition;
  saveLocal(CONDITION_KEY, condition);
  await writeEvent(buildRecord(session, 'session-start', now, {}));
  armIdle(now);
}

async function endSession(atMs) {
  cancelIdle();
  const ended = session;
  if (!ended) return;
  session = null;
  await writeEvent(buildRecord(ended, 'session-end', atMs, {}));
}

// Al volver a sonar tras un cierre por inactividad se abre una sesión nueva con la misma condición.
async function reopenSession() {
  if (session || !resumeAllowed || previewing || currentMode !== 'paciente' || !activeProfile) return;
  await beginSession(activeProfile, { condition: lastCondition, startPoint: null });
}

function sessionView() {
  if (!session || previewing) return null;
  return {
    id: session.id,
    condition: session.condition,
    profileId: session.profileId,
    startPoint: session.startPoint,
  };
}

async function readRecordingSetting() {
  try {
    return (await store.getSettings()).studyRecording !== false;
  } catch {
    return true;
  }
}

/**
 * Registra un evento del estudio (services.recordStudyEvent). Solo hay registro con sesión abierta, fuera de la
 * vista previa y con el registro activado en ajustes. El instante puede venir en fields.at (ms).
 */
function recordStudyEvent(type, fields = {}) {
  if (previewing || !recordingOn || !STUDY_EVENT_TYPES.includes(type)) return Promise.resolve();
  const at = Number.isFinite(fields.at) ? fields.at : Date.now();
  const captured = {
    songId: fields.songId ?? null,
    presentation: fields.presentation,
    origin: validOrigin(fields.origin ?? lastOrigin),
    seconds: fields.seconds ?? null,
    completed: fields.completed ?? null,
    trackSeconds: fields.trackSeconds ?? null,
  };
  return enqueue(async () => {
    if (REOPEN_TYPES.has(type)) {
      await reopenSession();
      // Está sonando: no debe contar el tiempo de inactividad.
      cancelIdle();
    }
    const open = session;
    if (!open) return;
    const record = buildRecord(open, type, at, captured);
    if (TRACK_TYPES.has(type) && record.songId === null) return;
    await writeEvent(record);
  });
}

// Eventos del reproductor: se reenvían a recordStudyEvent y llevan la cuenta de la inactividad y de la última pista.
function onPlayerStudyEvent(event) {
  const type = String(event.type ?? '');
  const parsed = Date.parse(event.at);
  const at = Number.isFinite(parsed) ? parsed : Date.now();
  if (event.origin) lastOrigin = event.origin;
  const duration = playerApi ? clampSeconds(playerApi.getState().duration) : 0;
  const seconds = clampSeconds(event.position);
  const songId = event.songId ?? null;
  const origin = event.origin ?? lastOrigin;
  if (REOPEN_TYPES.has(type)) cancelIdle();
  if (REMEMBER_TYPES.has(type)) rememberPlayback(songId, seconds, origin);
  recordStudyEvent(type, {
    at,
    songId,
    origin,
    seconds,
    completed: typeof event.completed === 'boolean' ? event.completed : null,
    trackSeconds: duration >= 1 ? duration : null,
  });
  if (IDLE_TYPES.has(type)) enqueue(() => armIdle(at));
}

// ---------------------------------------------------------------------------
// Reproductor
// ---------------------------------------------------------------------------

// Sin conexión solo suenan las canciones guardadas (DESIGN 8.1).
function isPlayable(item) {
  return typeof navigator === 'undefined' || navigator.onLine !== false || cachedPaths.has(item?.audioUrl);
}

// Última pista del perfil (solo en modo paciente y fuera de la vista previa).
function rememberPlayback(songId, position, origin) {
  if (!songId || previewing || currentMode !== 'paciente' || !activeProfile) return;
  store.saveLastTrack(activeProfile.id, {
    songId,
    position: clampSeconds(position),
    origin: validOrigin(origin),
    at: zonedIso(Date.now()),
  }).catch((error) => console.error('Reminiscencia: no se pudo guardar la última pista.', error));
}

function rememberPlaying() {
  if (!playerApi) return;
  const state = playerApi.getState();
  if (state.track) rememberPlayback(state.track.id, state.position, lastOrigin);
}

function createPlayerApi(settings) {
  const base = createPlayer({
    audio: audioEl,
    profile: null,
    mode: 'cuidador',
    wakeLockEnabled: settings.wakeLock !== false,
    isAvailable: isPlayable,
    onStudyEvent: onPlayerStudyEvent,
    onNotice: onPlayerNotice,
    onSleepWarning: onPlayerSleepWarning,
    onSleep: onPlayerSleep,
  });
  return {
    ...base,
    load(items, startAt = 0, origin = null, presentation = null) {
      lastOrigin = origin ?? null;
      return base.load(items, startAt, origin, presentation);
    },
    restoreLast(item, startAt = 0) {
      lastOrigin = 'continua';
      return base.restoreLast(item, startAt);
    },
    setSleepTimer: (minutes) => base.setSleepTimer(scaleMinutes(minutes)),
    extendSleepTimer: (minutes) => base.extendSleepTimer(scaleMinutes(minutes)),
  };
}

function onPlayerNotice(text) {
  // Escuchar y el marco del cuidador ya muestran sus avisos; aquí solo se leen en las demás pantallas del paciente.
  if (text && currentMode === 'paciente' && currentRouteName !== 'escuchar') announce(text);
}

function onPlayerSleepWarning() {
  if (currentMode !== 'paciente' || sleepDialogOpen) return;
  sleepDialogOpen = true;
  openSleepWarning(services)
    .catch((error) => console.error('Reminiscencia: no se pudo mostrar el aviso de apagado.', error))
    .finally(() => {
      sleepDialogOpen = false;
    });
}

function onPlayerSleep() {
  announce('La música se ha parado por el temporizador.');
}

// Punto de inicio de una sesión: carga su lista o carpeta sin reproducir nada (DESIGN C4).
async function loadStartPoint(profile, point) {
  let queue = [];
  let origin = null;
  if (point.type === 'lista') {
    const lists = await store.listPlaylists(profile.id);
    const list = lists.find((item) => item.id === point.id);
    if (list) {
      queue = songsOfList(list, catalog.songs);
      origin = 'lista';
    }
  } else {
    const folder = catalog.folders.find((item) => item.id === point.id);
    if (folder) {
      queue = songsInFolder(folder, catalog.songs);
      origin = 'carpeta';
    }
  }
  if (queue.length > 0) playerApi.load(queue.map(trackOfSong), 0, origin, null);
}

// ---------------------------------------------------------------------------
// Perfiles y catálogo
// ---------------------------------------------------------------------------

async function refreshProfileState() {
  try {
    profiles = await store.listProfiles();
    activeId = await store.getActiveProfileId();
  } catch (error) {
    console.error('Reminiscencia: no se pudieron leer los perfiles.', error);
  }
  activeProfile = profiles.find((profile) => profile.id === activeId) ?? null;
  if (activeProfile) playerApi.setProfile(playerProfileOf(activeProfile));
}

async function findProfile(profileId) {
  if (typeof profileId !== 'string' || profileId === '') return null;
  profiles = await store.listProfiles();
  return profiles.find((profile) => profile.id === profileId) ?? null;
}

async function fetchList(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`Reminiscencia: no se pudo cargar ${url}.`, error);
    return [];
  }
}

async function loadCatalog() {
  const [songs, folders] = await Promise.all([fetchList(CATALOG_URLS.songs), fetchList(CATALOG_URLS.folders)]);
  return { songs, folders };
}

async function refreshCachedPaths() {
  cachedPaths = await cachedSongPaths(catalog.songs);
}

// ---------------------------------------------------------------------------
// Modos, marcos y servicios
// ---------------------------------------------------------------------------

function defaultRouteFor(mode) {
  if (mode === 'paciente') return { route: 'escuchar', params: {} };
  return { route: profiles.length > 0 ? 'inicio' : 'asistente', params: {} };
}

function sectionFor(mode, route) {
  if (mode === 'paciente') return Object.hasOwn(PATIENT_SECTIONS, route) ? PATIENT_SECTIONS[route] : null;
  return sectionOfRoute(route);
}

// Servicios que reciben las pantallas. Cada marco recibe el suyo; un servicio de un modo ya cerrado no navega.
function createServices(mode) {
  const isCurrent = () => mode === currentMode;
  return {
    mode,
    store,
    player: playerApi,
    prefs: prefsService,
    catalog,
    navigate: (route, params) => (isCurrent() ? navigateTo(route, params ?? {}) : undefined),
    announce,
    confirm: (options) => (isCurrent() ? askConfirmation(options) : Promise.resolve(false)),
    enterPatientMode,
    leavePatientMode,
    startPreview: (profileId) => startPreview(profileId).catch(logError('Reminiscencia: no se pudo abrir la vista previa.')),
    endPreview: () => endPreview().catch(logError('Reminiscencia: no se pudo volver al modo cuidador.')),
    session: sessionView,
    recordStudyEvent,
  };
}

// Registra un fallo de una operación iniciada desde la interfaz sin dejar una promesa rechazada sin tratar.
function logError(message) {
  return (error) => console.error(message, error);
}

function disposeScreen(screen) {
  if (typeof screen?.unmount !== 'function') return;
  try {
    screen.unmount();
  } catch (error) {
    console.error('Reminiscencia: no se pudo cerrar la pantalla.', error);
  }
}

function disposeCurrent() {
  const screen = current;
  current = null;
  disposeScreen(screen);
}

/** Monta el marco del modo indicado y la pantalla de ese modo lo reemplaza todo. No pone el foco. */
function mountMode(mode) {
  renderSeq += 1;
  disposeCurrent();
  try {
    shell?.unmount();
  } catch (error) {
    console.error('Reminiscencia: no se pudo cerrar el marco.', error);
  }
  shell = null;
  mountEl.replaceChildren();
  currentMode = mode;
  document.documentElement.dataset.modo = mode;
  services = createServices(mode);
  if (mode === 'paciente') {
    const patient = mountPatientShell(mountEl, services);
    services.setTitle = (text) => (userNavigated ? patient.setTitle(text) : setTitleQuietly(text));
    services.setActive = (key) => patient.setActive(key);
    shell = {
      content: patient.content,
      setActive: (key) => patient.setActive(key),
      showPreviewButton() {},
      unmount: () => patient.unmount(),
    };
  } else {
    const caregiver = mountCaregiverShell(mountEl, services);
    services.headerSlot = caregiver.headerSlot;
    shell = {
      content: caregiver.content,
      setActive: (key) => caregiver.setActive(key),
      showPreviewButton: (show) => caregiver.showPreviewButton(show),
      unmount: () => caregiver.unmount(),
    };
  }
  playerApi.setMode(mode);
  syncPreviewChrome();
  applyDisplay();
}

// Monta la pantalla de una ruta dentro del contenido del marco activo.
async function render(route, params, { moveFocus = true } = {}) {
  renderSeq += 1;
  const seq = renderSeq;
  const frame = shell;
  const mode = currentMode;
  currentRouteName = route;
  disposeCurrent();
  frame.content.replaceChildren();
  frame.content.scrollTop = 0;
  frame.setActive(sectionFor(mode, route));
  frame.showPreviewButton(mode === 'cuidador' && (route === 'perfiles' || route === 'perfil'));
  await refreshProfileState();
  if (seq !== renderSeq) return;
  let screen = null;
  try {
    screen = await ROUTES[mode][route](frame.content, services, params);
  } catch (error) {
    console.error('Reminiscencia: no se pudo abrir la pantalla.', error);
    frame.content.replaceChildren(element('p', {
      role: 'alert',
      text: 'No se pudo abrir esta pantalla. Vuelve a intentarlo.',
    }));
    return;
  }
  if (seq !== renderSeq) {
    disposeScreen(screen);
    return;
  }
  current = screen;
  if (moveFocus) focusHeading();
}

function targetFor(mode, route, params) {
  const hash = buildHash(mode, route, params);
  if (hash !== null) return { route, params, hash };
  const fallback = defaultRouteFor(mode);
  return { route: fallback.route, params: fallback.params, hash: buildHash(mode, fallback.route, fallback.params) };
}

/** Cambia de pantalla: actualiza el hash (apila o reemplaza) y monta la pantalla. */
function navigateTo(route, params = {}, { replace = false, moveFocus = true, userAction = true } = {}) {
  if (userAction) userNavigated = true;
  const target = targetFor(currentMode, route, params);
  if (location.hash !== target.hash) history[replace ? 'replaceState' : 'pushState'](null, '', target.hash);
  renderedHash = target.hash;
  return render(target.route, target.params, { moveFocus });
}

// Atrás y adelante, o una edición manual del hash.
function onLocationChange() {
  if (!shell || location.hash === renderedHash) return;
  userNavigated = true;
  const parsed = parseRoute(location.hash, currentMode);
  if (!parsed) {
    const fallback = defaultRouteFor(currentMode);
    navigateTo(fallback.route, fallback.params, { replace: true });
    return;
  }
  renderedHash = location.hash;
  render(parsed.route, parsed.params, { moveFocus: true });
}

/** Pasa al modo paciente. Sin PIN. Con options.session abre la sesión y, si hay punto de inicio, carga su cola. */
async function enterPatientMode(profileId, options = {}) {
  const profile = await findProfile(profileId);
  if (!profile) throw new Error('Elige un perfil para empezar la sesión.');
  previewing = false;
  previewReturn = null;
  if (activeId !== profile.id) await store.setActiveProfileId(profile.id);
  activeId = profile.id;
  activeProfile = profile;
  playerApi.setProfile(playerProfileOf(profile));
  recordingOn = await readRecordingSetting();
  await enqueue(() => endSession(Date.now()));
  const request = options.session ?? null;
  resumeAllowed = false;
  if (request?.startPoint) await loadStartPoint(profile, request.startPoint);
  mountMode('paciente');
  if (request) await enqueue(() => beginSession(profile, request));
  saveLocal(MODE_KEY, 'paciente');
  await navigateTo('escuchar', {}, { replace: true, moveFocus: false });
  // La hoja de sesión sigue abierta mientras esto ocurre: el foco va al título cuando se cierre.
  setTimeout(focusHeading, 0);
}

/** Sale al modo cuidador. P5 ya ha pedido el PIN antes de llamar aquí; la reproducción no se detiene. */
async function leavePatientMode() {
  if (previewing) return endPreview();
  if (currentMode !== 'paciente') return undefined;
  await enqueue(() => endSession(Date.now()));
  resumeAllowed = false;
  mountMode('cuidador');
  saveLocal(MODE_KEY, 'cuidador');
  const fallback = defaultRouteFor('cuidador');
  await navigateTo(fallback.route, fallback.params, { replace: true });
  return undefined;
}

/** Vista previa del paciente desde el cuidador: sin PIN, sin sesión y sin eventos. */
async function startPreview(profileId) {
  if (currentMode !== 'cuidador') return;
  const profile = await findProfile(profileId);
  if (!profile) {
    announce('Crea o elige un perfil para ver la vista previa.');
    return;
  }
  if (activeId !== profile.id) await store.setActiveProfileId(profile.id);
  previewReturn = parseRoute(location.hash, 'cuidador') ?? defaultRouteFor('cuidador');
  previewing = true;
  activeId = profile.id;
  activeProfile = profile;
  playerApi.setProfile(playerProfileOf(profile));
  mountMode('paciente');
  await navigateTo('escuchar', {}, { replace: true });
}

/** Vuelve de la vista previa a la pantalla del cuidador desde la que se abrió. */
async function endPreview() {
  if (!previewing) return;
  previewing = false;
  const back = previewReturn ?? defaultRouteFor('cuidador');
  previewReturn = null;
  mountMode('cuidador');
  await navigateTo(back.route, back.params, { replace: true });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function readSettings() {
  try {
    return await store.getSettings();
  } catch (error) {
    console.error('Reminiscencia: no se pudieron leer los ajustes.', error);
    return {};
  }
}

function listen() {
  window.addEventListener('popstate', onLocationChange);
  window.addEventListener('hashchange', onLocationChange);
  window.addEventListener('storage', (event) => {
    if (event.key === PREFS_STORAGE_KEY) applyDisplay();
  });
  window.addEventListener('offline', () => {
    refreshCachedPaths();
  });
  window.addEventListener('pagehide', rememberPlaying);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') rememberPlaying();
  });
}

function startTimers() {
  setInterval(() => {
    if (playerApi?.getState().playing) rememberPlaying();
  }, REMEMBER_MS);
}

async function start() {
  registerPwa().catch(() => {});
  try {
    buildFrame(ensureAppRoot());
    listen();
    applyDisplay();
    store = await openStore();
    const settings = await readSettings();
    recordingOn = settings.studyRecording !== false;
    catalog = await loadCatalog();
    playerApi = createPlayerApi(settings);
    await refreshProfileState();
    await refreshCachedPaths();
    const savedCondition = readLocal(CONDITION_KEY);
    lastCondition = STUDY_CONDITIONS.includes(savedCondition) ? savedCondition : 'segun-cancion';
    const mode = initialModeFor({
      hasProfiles: profiles.length > 0,
      alwaysPatientMode: settings.alwaysPatientMode === true,
      lastMode: readLocal(MODE_KEY),
    });
    mountMode(mode);
    if (mode === 'paciente' && activeProfile) {
      await enqueue(() => beginSession(activeProfile, { condition: lastCondition, startPoint: null }));
      playerApi.setSleepTimer(settings.sleepTimerMinutes ?? null);
    }
    startTimers();
    const wanted = profiles.length === 0
      ? { route: 'asistente', params: {} }
      : parseRoute(location.hash, mode) ?? defaultRouteFor(mode);
    await navigateTo(wanted.route, wanted.params, { replace: true, moveFocus: false, userAction: false });
  } catch (error) {
    console.error('Reminiscencia: no se pudo iniciar la aplicación.', error);
    showBootError();
  }
}

if (typeof document !== 'undefined') start();
