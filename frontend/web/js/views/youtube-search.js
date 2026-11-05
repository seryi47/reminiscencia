// Resultados de YouTube dentro del buscador (ADR-0021). Aparecen debajo de los de la biblioteca: solos si la biblioteca
// no tiene la canción y, si la tiene, al pulsar «Buscar en YouTube». «Escuchar» abre el reproductor incrustado de YouTube y
// empieza la descarga; «Descargar» solo la descarga. La descarga es la de Homeostasia (importYoutubeVideo).

import {
  YOUTUBE_MIN_QUERY,
  embedUrl,
  formatClock,
  searchYoutube,
  shouldSearchAutomatically,
  youtubeQuery,
} from '../youtube-search.js';
import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { importYoutubeVideo } from './homeostasia.js';

const DEBOUNCE_MS = 700;
const CACHE_LIMIT = 30;

// Estado que sobrevive a repintar los resultados (cada tecla, cada chip).
const cache = new Map();
const downloads = new Map();
let session = null;

// El vídeo vive en un panel fijo fuera de los resultados: si el buscador se repinta (por ejemplo al abrirse «Subir
// canciones» al empezar la descarga), el iframe no se destruye y la canción no se corta.
const dock = { id: null, node: null };

function closeDock() {
  dock.node?.remove();
  dock.node = null;
  dock.id = null;
  for (const button of document.querySelectorAll('.yt-listen')) button.lastChild.textContent = 'Escuchar';
}

function openDock(ctx, item) {
  closeDock();
  // La música de la biblioteca se pausa para no sonar a la vez que el vídeo.
  ctx.player?.pause?.();
  dock.id = item.id;
  dock.node = el('div', { class: 'yt-dock', role: 'region', 'aria-label': 'Reproductor de YouTube', 'data-testid': 'youtube-embed' },
    el('div', { class: 'yt-dock-bar' },
      el('p', { class: 'yt-dock-title' }, item.title),
      el('button', { type: 'button', class: 'button button-text button-small', 'aria-label': 'Cerrar el reproductor de YouTube', on: { click: closeDock } }, 'Cerrar')),
    el('iframe', {
      src: embedUrl(item.id),
      title: `Vídeo de YouTube: ${item.title}`,
      allow: 'autoplay; encrypted-media; picture-in-picture',
      allowfullscreen: true,
      referrerpolicy: 'strict-origin-when-cross-origin',
    }));
  document.body.append(dock.node);
  for (const button of document.querySelectorAll('.yt-listen')) {
    button.lastChild.textContent = button.closest('.yt-row')?.dataset.videoId === item.id ? 'Cerrar' : 'Escuchar';
  }
}

function remember(query, items) {
  cache.delete(query);
  cache.set(query, items);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

function endSession() {
  if (!session) return;
  clearTimeout(session.timer);
  session.controller.abort();
  session = null;
}

/** Sección «En YouTube» para el texto buscado. [songCount] son las canciones de la biblioteca que coinciden. */
export function youtubeSection(ctx, rawQuery, songCount) {
  endSession();
  const query = youtubeQuery(rawQuery);
  const section = el('section', { class: 'yt-section', 'aria-labelledby': 'resultados-youtube', 'data-testid': 'youtube-section' },
    el('h2', { class: 'shelf-title', id: 'resultados-youtube' }, 'En YouTube'));
  if (!query) {
    section.append(el('p', { class: 'empty-text', 'data-testid': 'youtube-hint' },
      `Escribe al menos ${YOUTUBE_MIN_QUERY} letras para buscar también en YouTube.`));
    return section;
  }
  const body = el('div', { class: 'yt-body' });
  section.append(body);
  const mine = { controller: new AbortController(), timer: null };
  session = mine;

  const show = (items) => {
    body.replaceChildren(...resultNodes(ctx, items, query));
  };
  const run = async () => {
    body.replaceChildren(el('p', { class: 'empty-text', role: 'status', 'data-testid': 'youtube-loading' }, 'Buscando en YouTube…'));
    try {
      const items = await searchYoutube(query, { signal: mine.controller.signal });
      remember(query, items);
      if (session === mine) show(items);
    } catch (error) {
      if (error?.name === 'AbortError' || session !== mine) return;
      body.replaceChildren(el('div', { class: 'yt-error', role: 'alert', 'data-testid': 'youtube-error' },
        el('p', { class: 'empty-text' }, error.message),
        el('button', { type: 'button', class: 'button button-outline button-small', on: { click: run } }, 'Reintentar')));
    }
  };

  if (cache.has(query)) {
    show(cache.get(query));
  } else if (shouldSearchAutomatically(songCount)) {
    if (navigator.onLine === false) {
      body.replaceChildren(el('p', { class: 'empty-text' }, 'Sin conexión: la búsqueda en YouTube necesita internet.'));
    } else {
      body.replaceChildren(el('p', { class: 'empty-text', role: 'status' }, 'Buscando en YouTube…'));
      mine.timer = setTimeout(() => { if (session === mine) run(); }, DEBOUNCE_MS);
    }
  } else {
    body.replaceChildren(el('button', {
      type: 'button',
      class: 'button button-outline',
      'data-testid': 'youtube-search-button',
      on: { click: run },
    }, icon('search', { size: 18 }), `Buscar «${query}» en YouTube`));
  }
  return section;
}

function resultNodes(ctx, items, query) {
  if (items.length === 0) {
    return [el('p', { class: 'empty-text', 'data-testid': 'youtube-empty' }, `YouTube no ha encontrado canciones para «${query}».`)];
  }
  return [
    el('p', { class: 'sr-only', role: 'status' }, `${items.length} ${items.length === 1 ? 'resultado' : 'resultados'} en YouTube.`),
    el('ul', { class: 'yt-list', 'data-testid': 'youtube-results' }, items.map((item) => resultRow(ctx, item))),
  ];
}

function resultRow(ctx, item) {
  const meta = [item.artist, item.durationS > 0 ? formatClock(item.durationS) : ''].filter(Boolean).join(' · ');
  const status = el('p', { class: 'yt-status', role: 'status', 'data-testid': 'youtube-status' });
  const listen = el('button', {
    type: 'button',
    class: 'button button-primary button-small yt-listen',
    'aria-label': `Escuchar ${item.title}`,
    'data-testid': 'youtube-listen',
  }, icon('play', { size: 16 }), 'Escuchar');
  const download = el('button', {
    type: 'button',
    class: 'button button-outline button-small yt-download',
    'aria-label': `Descargar ${item.title}`,
    'data-testid': 'youtube-download',
  }, icon('download', { size: 16 }), 'Descargar');
  const progress = el('button', {
    type: 'button',
    class: 'button button-text button-small',
    'data-testid': 'youtube-progress',
    hidden: true,
    on: { click: () => ctx.openUpload() },
  }, 'Ver el progreso');
  const row = el('li', { class: 'yt-row', 'data-testid': 'youtube-result', 'data-video-id': item.id },
    el('div', { class: 'yt-main' },
      el('div', { class: 'yt-info' },
        el('p', { class: 'yt-title' }, item.title),
        el('p', { class: 'yt-meta' }, meta)),
      el('div', { class: 'yt-actions' }, listen, download)),
    status, progress);

  const paint = () => {
    listen.lastChild.textContent = dock.id === item.id ? 'Cerrar' : 'Escuchar';
    const state = downloads.get(item.id);
    download.disabled = state?.state === 'running' || state?.state === 'queued';
    download.lastChild.textContent = state?.state === 'queued' ? 'En cola' : state?.state === 'running' ? 'Descargando…' : state?.state === 'error' ? 'Reintentar' : 'Descargar';
    status.textContent = state?.message ?? '';
    progress.hidden = state?.state !== 'queued';
  };

  const startDownload = async () => {
    if (downloads.get(item.id)?.state === 'running' || downloads.get(item.id)?.state === 'queued') return;
    downloads.set(item.id, { state: 'running', message: 'Preparando la descarga…' });
    paint();
    try {
      const result = await importYoutubeVideo(ctx, item.url, {
        onStatus: (message) => {
          downloads.set(item.id, { state: 'running', message });
          if (row.isConnected) paint();
        },
      });
      downloads.set(item.id, {
        state: 'queued',
        message: result === 'queued'
          ? 'Añadida a la cola de subidas. Estará en la biblioteca cuando se publique.'
          : 'Esta canción ya se había descargado.',
      });
    } catch (error) {
      downloads.set(item.id, { state: 'error', message: error?.message || 'No se pudo descargar la canción.' });
    }
    if (row.isConnected) paint();
  };

  const toggleEmbed = () => {
    if (dock.id === item.id) closeDock();
    else openDock(ctx, item);
  };

  listen.addEventListener('click', () => {
    const opening = dock.id !== item.id;
    toggleEmbed();
    if (opening) startDownload();
  });
  download.addEventListener('click', startDownload);
  paint();
  return row;
}
