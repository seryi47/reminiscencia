// Pantalla Inicio del cuidador (DESIGN C1; contrato 2.4 y 5). routes = { inicio: mountHome }.
// mountHome(root, services) muestra el perfil activo, los pendientes con enlace, la última sesión, el resumen
// del día y los avisos. El título y la sección activa los pone la pantalla con services.setTitle y setActive.
//
// Decisiones que el contrato deja abiertas:
// - El registro del estudio se lee de los ajustes del dispositivo (store.getSettings().studyRecording). Ese
//   campo aún no existe en store.js: mientras falte, se toma el valor por defecto del DESIGN (activado).
// - Las fechas se leen de la propia marca ISO 8601 con zona (AAAA-MM-DDThh:mm...), sin depender de Intl.
// - Los avisos no se cierran solos (DESIGN C-17). Cada aviso es role="status" y, si procede, enlaza a Ajustes.

import { formatBytes } from '../offline-core.js';

export const BACKUP_REMINDER_DAYS = 14;
export const STORAGE_WARNING_RATIO = 0.8;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = Object.freeze(['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']);

/** Días completos entre dos marcas de tiempo en milisegundos (nunca negativo). */
export function daysBetween(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.max(0, Math.floor((toMs - fromMs) / DAY_MS));
}

/** Día local en formato AAAA-MM-DD, el que usa el registro del estudio para filtrar por día. */
export function localDayKey(date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Fecha y hora legibles a partir de una marca ISO 8601 con zona: «2 nov 2026, 15:30». Vacío si no es válida. */
export function formatStudyTime(at) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(at ?? ''));
  if (!match) return '';
  const day = Number(match[3]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return '';
  return `${day} ${MONTHS[month - 1]} ${match[1]}, ${match[4]}:${match[5]}`;
}

/** Marca de la última sesión (evento session-start), o null si no hay ninguna. */
export function lastSessionAt(events = []) {
  let last = null;
  for (const event of events) {
    if (event && event.type === 'session-start' && typeof event.at === 'string') last = event.at;
  }
  return last;
}

/** Resumen del día: escuchas, minutos y saltadas, según el historial agrupado por día. null si no hay escuchas hoy. */
export function todaySummary(days = [], today) {
  const day = days.find((entry) => entry.day === today);
  return day && day.summary ? day.summary : null;
}

/** Texto del resumen: «14 escuchas · 42 minutos · 3 saltadas». */
export function summaryText(summary) {
  const listens = summary.listens ?? 0;
  const minutes = summary.minutes ?? 0;
  const skipped = summary.skipped ?? 0;
  return [
    `${listens} ${listens === 1 ? 'escucha' : 'escuchas'}`,
    `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`,
    `${skipped} ${skipped === 1 ? 'saltada' : 'saltadas'}`,
  ].join(' · ');
}

/**
 * Pendientes del perfil (DESIGN C1): canciones del catálogo sin familiaridad valorada, recuerdos sin fotografía
 * y listas vacías. links son las asociaciones del perfil; songs, el catálogo.
 */
export function summarizePending({ songs = [], links = [], memories = [], playlists = [] }) {
  const rated = new Set(links.filter((link) => link.familiarity >= 1).map((link) => link.songId));
  const songsWithoutFamiliarity = songs.filter((song) => !rated.has(song.id)).length;
  const memoriesWithoutPhoto = memories.filter((memory) => !Array.isArray(memory.photoIds) || memory.photoIds.length === 0).length;
  const emptyPlaylists = playlists.filter((list) => !Array.isArray(list.songIds) || list.songIds.length === 0).length;
  return { songsWithoutFamiliarity, memoriesWithoutPhoto, emptyPlaylists };
}

/** true si el navegador es de Apple móvil (iPhone, iPad o iPod, o un iPadOS que se identifica como Mac). */
export function isIosBrowser(userAgent = '', { maxTouchPoints = 0, platform = '' } = {}) {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

/**
 * Avisos de la pantalla de Inicio (DESIGN C1): copia con más de 14 días, almacenamiento por encima del 80 %,
 * almacenamiento persistente no concedido, registro del estudio activo y app sin instalar en iOS.
 * Devuelve la lista de { key, text, link } en ese orden. Sin datos no hay aviso.
 */
export function buildNotices({
  now,
  hasProfiles,
  lastBackupAt = null,
  usage = null,
  quota = null,
  persisted = null,
  studyRecording = true,
  iosNotInstalled = false,
}) {
  const notices = [];
  if (hasProfiles) {
    if (lastBackupAt === null || lastBackupAt === undefined) {
      notices.push({ key: 'backup', text: 'Todavía no se ha hecho ninguna copia. Haz una copia cifrada en Ajustes.', link: 'ajustes' });
    } else {
      const days = daysBetween(lastBackupAt, now);
      if (days > BACKUP_REMINDER_DAYS) {
        notices.push({ key: 'backup', text: `Hace ${days} días que no se hace una copia. Haz una copia cifrada en Ajustes.`, link: 'ajustes' });
      }
    }
  }
  if (Number.isFinite(usage) && Number.isFinite(quota) && quota > 0 && usage / quota > STORAGE_WARNING_RATIO) {
    const percent = Math.round((usage / quota) * 100);
    notices.push({ key: 'storage', text: `El almacenamiento del navegador está al ${percent} % de su cuota.`, link: 'ajustes' });
  }
  if (hasProfiles && persisted === false) {
    notices.push({ key: 'persist', text: 'El navegador puede borrar estos datos si necesita espacio. Pide almacenamiento persistente en Ajustes.', link: 'ajustes' });
  }
  if (studyRecording) {
    notices.push({ key: 'study', text: 'El registro del estudio está activo: se guardan eventos de escucha en este navegador.', link: 'ajustes' });
  }
  if (iosNotInstalled) {
    notices.push({ key: 'ios', text: 'En iPhone y iPad, añade Reminiscencia a la pantalla de inicio. Así Safari conserva mejor los datos.', link: null });
  }
  return notices;
}

/** true si la app se abre instalada (pantalla de inicio o modo independiente). */
export function isStandaloneApp({ matchesStandalone = false, navigatorStandalone = false } = {}) {
  return Boolean(matchesStandalone || navigatorStandalone);
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

// Lee todo lo necesario para la pantalla. Cada parte falla por separado y no tumba la pantalla.
async function loadHome(services) {
  const today = localDayKey(new Date());
  const profileId = await services.store.getActiveProfileId();
  const profiles = await services.store.listProfiles();
  const profile = profiles.find((item) => item.id === profileId) ?? null;
  const data = { profile, profiles, today, pending: null, lastSession: null, daySummary: null };

  if (profile) {
    const [links, memories, playlists, events, days] = await Promise.all([
      services.store.listSongLinks(profile.id),
      services.store.listMemories(profile.id),
      services.store.listPlaylists(profile.id),
      services.store.listStudyEvents({ profileId: profile.id }),
      services.store.listListeningHistory({ profileId: profile.id, from: today, to: today }).catch(() => []),
    ]);
    data.pending = summarizePending({ songs: services.catalog?.songs ?? [], links, memories, playlists });
    data.lastSession = lastSessionAt(events);
    data.daySummary = todaySummary(days, today);
  }

  let lastBackupAt = null;
  try {
    lastBackupAt = await services.store.getLastBackupAt();
  } catch {
    lastBackupAt = null;
  }
  let settings = {};
  try {
    settings = await services.store.getSettings();
  } catch {
    settings = {};
  }

  let usage = null;
  let quota = null;
  let persisted = null;
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      usage = Number.isFinite(estimate.usage) ? estimate.usage : null;
      quota = Number.isFinite(estimate.quota) ? estimate.quota : null;
    }
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  } catch {
    persisted = null;
  }

  const standalone = isStandaloneApp({
    matchesStandalone: typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches,
    navigatorStandalone: navigator.standalone === true,
  });
  const ios = isIosBrowser(navigator.userAgent ?? '', {
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    platform: navigator.platform ?? '',
  });

  data.notices = buildNotices({
    now: Date.now(),
    hasProfiles: profiles.length > 0,
    lastBackupAt,
    usage,
    quota,
    persisted,
    studyRecording: settings.studyRecording !== false,
    iosNotInstalled: ios && !standalone,
  });
  return data;
}

/** Monta la pantalla Inicio en root. Devuelve { unmount }. */
export function mountHome(root, services) {
  let alive = true;
  services.setTitle?.('Inicio');
  services.setActive?.('inicio');

  const screen = el('section', 'c-screen c-inicio');
  screen.dataset.testid = 'c-inicio';
  screen.setAttribute('aria-busy', 'true');
  screen.append(el('p', 'c-help', 'Cargando…'));
  root.replaceChildren(screen);

  const go = (route, params) => services.navigate(route, params);

  function profileSection(data) {
    const section = el('section', 'c-section');
    section.append(el('h2', 'c-section-title', 'Perfil activo'));
    const card = el('div', 'c-card c-profile-card');
    if (data.profile) {
      const top = el('div', 'c-profile-head');
      const avatar = el('span', 'c-avatar c-avatar--lg', Array.from(data.profile.alias)[0]?.toLocaleUpperCase('es') ?? '?');
      avatar.setAttribute('aria-hidden', 'true');
      const names = el('div', 'c-profile-names');
      names.append(el('p', 'c-card-title', data.profile.alias));
      names.append(el('p', 'c-meta', data.profile.code ? `Código: ${data.profile.code}` : 'Sin código de participante'));
      top.append(avatar, names);
      card.append(top);
    } else {
      card.append(el('p', 'c-card-title', 'Sin perfil activo'));
      card.append(el('p', 'c-help', 'Crea un perfil antes de abrir el modo paciente.'));
    }
    // Siempre visible: sin perfil, la hoja «Empezar sesión» explica que hace falta crear uno (DESIGN 3.3).
    const open = el('button', 'c-btn c-btn--primary c-btn--block');
    open.type = 'button';
    open.dataset.testid = 'c-inicio-open-patient';
    open.textContent = 'Abrir modo paciente';
    open.addEventListener('click', () => services.openSession?.({}));
    card.append(open);
    if (!data.profile) {
      const create = el('button', 'c-btn c-btn--secondary c-btn--block');
      create.type = 'button';
      create.textContent = 'Crear perfil';
      create.addEventListener('click', () => go('perfiles'));
      card.append(create);
    }
    section.append(card);
    return section;
  }

  function pendingSection(data) {
    const section = el('section', 'c-section');
    section.dataset.testid = 'c-inicio-pending';
    section.append(el('h2', 'c-section-title', 'Pendientes'));
    const pending = data.pending;
    if (!pending) {
      section.append(el('p', 'c-help', 'Elige o crea un perfil para ver sus pendientes.'));
      return section;
    }
    const items = [];
    if (pending.songsWithoutFamiliarity > 0) {
      items.push({ text: `${pending.songsWithoutFamiliarity} ${pending.songsWithoutFamiliarity === 1 ? 'canción sin familiaridad' : 'canciones sin familiaridad'}`, action: () => go('biblioteca', { filter: 'sin-familiaridad' }) });
    }
    if (pending.memoriesWithoutPhoto > 0) {
      items.push({ text: `${pending.memoriesWithoutPhoto} ${pending.memoriesWithoutPhoto === 1 ? 'recuerdo sin fotografía' : 'recuerdos sin fotografía'}`, action: () => go('perfil', { profileId: data.profile.id, tab: 'recuerdos' }) });
    }
    if (pending.emptyPlaylists > 0) {
      items.push({ text: `${pending.emptyPlaylists} ${pending.emptyPlaylists === 1 ? 'lista vacía' : 'listas vacías'}`, action: () => go('perfil', { profileId: data.profile.id, tab: 'listas' }) });
    }
    if (items.length === 0) {
      section.append(el('p', 'c-help', 'No hay pendientes.'));
      return section;
    }
    const list = el('ul', 'c-pending-list');
    for (const item of items) {
      const li = el('li');
      const button = el('button', 'c-link', item.text);
      button.type = 'button';
      button.addEventListener('click', item.action);
      li.append(button);
      list.append(li);
    }
    section.append(list);
    return section;
  }

  function activitySection(data) {
    const section = el('section', 'c-section');
    section.append(el('h2', 'c-section-title', 'Actividad'));
    if (!data.profile) {
      section.append(el('p', 'c-help', 'Sin perfil activo no hay actividad que mostrar.'));
      return section;
    }
    const last = data.lastSession ? formatStudyTime(data.lastSession) : '';
    section.append(el('p', 'c-body', last ? `Última sesión: ${last}` : 'Todavía no hay sesiones registradas.'));
    section.append(el('p', 'c-body', data.daySummary ? `Hoy: ${summaryText(data.daySummary)}` : 'Hoy no hay escuchas registradas.'));
    return section;
  }

  function noticesSection(data) {
    const section = el('section', 'c-section');
    section.dataset.testid = 'c-inicio-notices';
    section.append(el('h2', 'c-section-title', 'Avisos'));
    if (data.notices.length === 0) {
      section.append(el('p', 'c-help', 'No hay avisos.'));
      return section;
    }
    for (const notice of data.notices) {
      const box = el('div', 'c-notice');
      box.setAttribute('role', 'status');
      box.append(el('p', 'c-notice-text', notice.text));
      if (notice.link === 'ajustes') {
        const link = el('button', 'c-link', 'Ir a Ajustes');
        link.type = 'button';
        link.addEventListener('click', () => go('ajustes'));
        box.append(link);
      }
      section.append(box);
    }
    return section;
  }

  // Carga y pintado. Si la pantalla se desmonta antes, no se pinta nada.
  loadHome(services)
    .then((data) => {
      if (!alive) return;
      screen.removeAttribute('aria-busy');
      screen.replaceChildren(profileSection(data), pendingSection(data), activitySection(data), noticesSection(data));
    })
    .catch((error) => {
      console.error('Reminiscencia: no se pudo cargar Inicio.', error);
      if (!alive) return;
      screen.removeAttribute('aria-busy');
      screen.replaceChildren(el('p', 'c-form-error', 'No se pudieron leer los datos de Inicio. Recarga la página.'));
    });

  return {
    unmount() {
      if (!alive) return;
      alive = false;
      root.replaceChildren();
    },
  };
}

export const routes = Object.freeze({ inicio: mountHome });
