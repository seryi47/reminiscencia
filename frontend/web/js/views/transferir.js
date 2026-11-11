// Vista «Transferir música» (ADR-0044): hoja para traer canciones, álbumes y playlists de Spotify a la biblioteca por el
// recorrido Spotify → YouTube → Reminiscencia. Conectar cuenta → ELEGIR de tu biblioteca (playlists + «Me gusta», como
// TuneMyMusic) o pegar un enlace (álbum/canción) → analizar → revisar coincidencias (alternativas y búsqueda manual) →
// transferir. La lógica está en js/spotify-transfer.js; el enganche al pipeline, en importYoutubeTracks (homeostasia.js).

import { el, openDialog, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  createTransferApi, beginConnect, isConnected, clearSession, listLibrary, resolveCollection, markDuplicates, buildTransferPlan,
} from '../spotify-transfer.js';
import { importYoutubeTracks } from './homeostasia.js';

const TIER_LABEL = { alta: 'Coincidencia segura', media: 'Revisar', baja: 'Elige una versión' };
const SOURCE_LABEL = { topic: 'Oficial (YouTube Music)', official: 'Canal oficial', search: 'YouTube' };

const fmtDuration = (seconds) => {
  if (!Number.isFinite(seconds)) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export function openTransferirSheet(ctx) {
  return openDialog({
    title: 'Transferir música',
    className: 'dialog-transferir',
    testid: 'transferir-sheet',
    render: (body, close, dialog) => {
      const panel = transferPanel(ctx);
      dialog?.addEventListener('close', () => panel.cleanup());
      body.replaceChildren(panel.node);
      body.querySelector('[data-autofocus]')?.focus();
    },
  });
}

function transferPanel(ctx) {
  const api = createTransferApi();
  const node = el('div', { class: 'transferir' });
  let abort = null;

  // sources: Map clave→{label, source?|ref?|url?}. collections: [{name, album, results, excluded:Set, overrides:Map}].
  const state = { library: null, sources: new Map(), collections: [], transferring: false };

  const setSection = (...children) => node.replaceChildren(...children);

  // --- Conectar --------------------------------------------------------------------------------------------------------
  function renderConnect(message) {
    const connect = el('button', {
      type: 'button', class: 'homeostasia-submit', 'data-testid': 'transferir-connect', 'data-autofocus': '',
      on: {
        click: async () => {
          try {
            const url = await beginConnect({ api, returnTo: '/#transferir' });
            window.location.href = url;
          } catch {
            toast('No se pudo iniciar sesión en Spotify. Inténtalo de nuevo.');
          }
        },
      },
    }, icon('note', { size: 18 }), 'Conectar con Spotify');
    setSection(
      el('p', { class: 'transferir-intro' },
        message || 'Conecta tu cuenta de Spotify para elegir tus playlists y tus canciones favoritas. Se identifican en YouTube y se añaden a tu biblioteca.'),
      connect,
    );
  }

  // --- Elegir de tu biblioteca -----------------------------------------------------------------------------------------
  async function renderLibrary(note) {
    setSection(el('p', { class: 'transferir-progress', 'data-testid': 'transferir-progress' }, 'Cargando tu biblioteca de Spotify…'));
    try {
      state.library = state.library ?? await listLibrary({ api });
    } catch (error) {
      if (error?.needsAuth) { renderConnect('Tu sesión de Spotify ha caducado. Conéctala de nuevo.'); return; }
      setSection(
        el('p', { class: 'transferir-error', 'data-testid': 'transferir-error' }, error?.message || 'No se pudo leer tu biblioteca.'),
        el('button', { type: 'button', class: 'button button-text', on: { click: () => renderLibrary() } }, 'Reintentar'),
      );
      return;
    }
    paintLibrary(note);
  }

  function paintLibrary(note) {
    const { playlists = [], liked = 0 } = state.library;
    const list = el('div', { class: 'transferir-list', 'data-testid': 'transferir-biblioteca' });

    // «Me gusta».
    if (liked > 0) list.append(sourceRow('liked', 'Canciones favoritas', `${liked} canciones`, { source: 'liked' }));
    // Playlists (con buscador).
    const playlistsBox = el('div', { class: 'transferir-list' });
    const paintPlaylists = (q = '') => {
      const query = q.trim().toLowerCase();
      const shown = playlists.filter((p) => !query || p.name.toLowerCase().includes(query));
      playlistsBox.replaceChildren(...shown.map((p) =>
        sourceRow(`pl:${p.id}`, p.name, `${p.total} canciones`, { ref: { type: 'playlist', id: p.id } })));
    };
    const search = el('input', {
      type: 'search', class: 'input', placeholder: `Buscar entre tus ${playlists.length} playlists…`, 'aria-label': 'Buscar playlists',
      on: { input: (e) => paintPlaylists(e.target.value) },
    });
    paintPlaylists();

    // Pegar un enlace suelto (álbum o canción, que no están en esta lista).
    const linkInput = el('input', { type: 'url', class: 'input', placeholder: 'o pega un enlace de álbum o canción' });
    const addLink = el('button', {
      type: 'button', class: 'button button-text',
      on: { click: () => { const u = linkInput.value.trim(); if (u) { toggleSource(`url:${u}`, { label: u, url: u }, true); linkInput.value = ''; analyzeSelected(); } } },
    }, 'Analizar enlace');

    const go = el('button', {
      type: 'button', class: 'homeostasia-submit', 'data-testid': 'transferir-analyze',
      on: { click: () => analyzeSelected() },
    }, icon('search', { size: 18 }), el('span', { 'data-testid': 'transferir-analyze-text' }, analyzeLabel()));
    node._refreshAnalyze = () => { go.querySelector('[data-testid="transferir-analyze-text"]').textContent = analyzeLabel(); };

    setSection(
      el('p', { class: 'transferir-intro' }, note || 'Elige qué traer. Las playlists mantienen su nombre y su orden. (En modo desarrollo, Spotify solo da el contenido de tus propias listas.)'),
      liked > 0 ? list : el('div'),
      el('p', { class: 'transferir-sub' }, `Tus playlists (${playlists.length})`),
      search,
      playlistsBox,
      el('div', { class: 'transferir-form' }, linkInput, addLink),
      go,
      el('button', { type: 'button', class: 'button button-text', 'data-testid': 'transferir-disconnect', on: { click: () => { clearSession(); state.library = null; state.sources.clear(); renderConnect('Sesión cerrada. Conecta de nuevo cuando quieras.'); } } }, 'Desconectar'),
    );
    if (liked > 0) search.focus();
  }

  const analyzeLabel = () => (state.sources.size > 0 ? `Analizar ${state.sources.size} selección${state.sources.size > 1 ? 'es' : ''}` : 'Elige algo para analizar');

  function sourceRow(key, title, subtitle, source) {
    const check = el('input', {
      type: 'checkbox', 'data-testid': 'transferir-source', 'data-key': key,
      ...(state.sources.has(key) ? { checked: '' } : {}),
      on: { change: (e) => toggleSource(key, { label: title, ...source }, e.target.checked) },
    });
    return el('label', { class: 'transferir-source-row' }, check,
      el('span', { class: 'transferir-track' },
        el('span', { class: 'transferir-title' }, title),
        el('span', { class: 'transferir-artist' }, subtitle)));
  }

  function toggleSource(key, source, on) {
    if (on) state.sources.set(key, source); else state.sources.delete(key);
    node._refreshAnalyze?.();
  }

  // --- Analizar las selecciones ----------------------------------------------------------------------------------------
  async function analyzeSelected() {
    if (state.sources.size === 0) { toast('Elige al menos una playlist, «Me gusta» o pega un enlace.'); return; }
    const progress = el('p', { class: 'transferir-progress', 'data-testid': 'transferir-progress' }, 'Analizando…');
    setSection(progress);
    const collections = [];
    try {
      for (const [, source] of state.sources) {
        progress.textContent = `Analizando «${source.label}»…`;
        const target = source.source ? { source: source.source } : (source.ref ? { ref: source.ref } : { url: source.url });
        const out = await resolveCollection({
          api, ...target,
          onPage: ({ loaded, total }) => { progress.textContent = `«${source.label}»: ${loaded}${total ? ` de ${total}` : ''} canciones…`; },
        });
        markDuplicates(out.results, ctx.librarySongs());
        collections.push({ name: source.label, album: out.album, results: out.results, excluded: new Set(), overrides: new Map() });
      }
      state.collections = collections;
      renderReview();
    } catch (error) {
      if (error?.needsAuth) { renderConnect('Tu sesión de Spotify ha caducado. Conéctala de nuevo.'); return; }
      setSection(
        el('p', { class: 'transferir-error', 'data-testid': 'transferir-error' }, error?.message || 'No se pudo analizar.'),
        el('button', { type: 'button', class: 'button button-text', on: { click: () => paintLibrary() } }, 'Volver'),
      );
    }
  }

  // --- Revisar ---------------------------------------------------------------------------------------------------------
  const chosenEntry = (collection, result) => collection.overrides.get(result.index) ?? result.best;
  const totalSelected = () => buildTransferPlan(state.collections).reduce((n, c) => n + c.tracks.length, 0);

  function renderReview() {
    const empty = state.collections.every((c) => c.results.length === 0);
    if (empty) {
      setSection(
        el('p', { class: 'transferir-intro', 'data-testid': 'transferir-vacio' },
          'No hay canciones accesibles en lo que elegiste. En modo desarrollo, Spotify solo da el contenido de tus propias listas; prueba con otra lista tuya, un álbum o una canción.'),
        el('button', { type: 'button', class: 'homeostasia-submit', on: { click: () => paintLibrary() } }, 'Volver'),
      );
      return;
    }
    const blocks = [];
    for (const collection of state.collections) {
      if (collection.results.length === 0) continue;
      const already = collection.results.filter((r) => r.inLibrary).length;
      blocks.push(el('p', { class: 'transferir-sub' },
        `${collection.name} · ${collection.results.length} canciones${already ? ` · ${already} ya en tu biblioteca` : ''}`));
      const list = el('div', { class: 'transferir-list', 'data-testid': 'transferir-list' });
      for (const result of collection.results) list.append(renderRow(collection, result));
      blocks.push(list);
    }
    const go = el('button', {
      type: 'button', class: 'homeostasia-submit', 'data-testid': 'transferir-go',
      on: { click: () => transfer() },
    }, icon('upload', { size: 18 }), el('span', { 'data-testid': 'transferir-go-text' }, `Transferir ${totalSelected()} canciones`));
    node._refreshCount = () => { go.querySelector('[data-testid="transferir-go-text"]').textContent = `Transferir ${totalSelected()} canciones`; };

    setSection(
      ...blocks,
      el('div', { class: 'transferir-actions' },
        el('button', { type: 'button', class: 'button button-text', on: { click: () => paintLibrary() } }, 'Elegir otra cosa'),
        go),
    );
  }

  function renderRow(collection, result) {
    const dupe = result.inLibrary;
    // Por defecto se incluye si hay una coincidencia (alta O media, ya pre-elegida la mejor); las duplicadas y las de
    // confianza baja sin candidato quedan fuera hasta que el usuario elija una versión.
    const hasPick = Boolean(chosenEntry(collection, result));
    if (dupe || !hasPick) collection.excluded.add(result.index);
    const included = !collection.excluded.has(result.index) && !dupe;
    const check = el('input', {
      type: 'checkbox', 'data-testid': 'transferir-include', 'data-index': String(result.index),
      ...(included ? { checked: '' } : {}), ...(dupe ? { disabled: '' } : {}),
      on: { change: (e) => { if (e.target.checked) collection.excluded.delete(result.index); else collection.excluded.add(result.index); node._refreshCount?.(); } },
    });

    const tierBadge = el('span', { class: `transferir-tier transferir-tier-${result.tier}` }, dupe ? 'Ya en tu biblioteca' : TIER_LABEL[result.tier]);
    const match = el('div', { class: 'transferir-match', 'data-testid': 'transferir-match' });
    paintMatch(collection, match, result, chosenEntry(collection, result));

    return el('div', { class: 'transferir-row', 'data-testid': 'transferir-row', 'data-index': String(result.index) },
      el('label', { class: 'transferir-pick' }, check,
        el('span', { class: 'transferir-track' },
          el('span', { class: 'transferir-title' }, result.track.title),
          el('span', { class: 'transferir-artist' }, `${(result.track.artists || []).join(', ')} · ${fmtDuration((result.track.durationMs || 0) / 1000)}`))),
      tierBadge,
      match);
  }

  function paintMatch(collection, container, result, chosen) {
    const options = dedupeCandidates([result.best, ...(result.alternatives || [])].filter(Boolean));
    if (result.tier !== 'alta' || options.length > 1 || !chosen) {
      const select = el('select', { class: 'input transferir-alt', 'data-testid': 'transferir-alt', 'data-index': String(result.index) });
      if (!chosen) select.append(el('option', { value: '' }, '— Elige una versión —'));
      for (const entry of options) {
        const c = entry.candidate;
        const opt = el('option', { value: c.url }, `${c.title} · ${fmtDuration(c.durationS)} · ${SOURCE_LABEL[c.source] || 'YouTube'}`);
        if (chosen && chosen.candidate.url === c.url) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener('change', () => {
        const entry = options.find((o) => o.candidate.url === select.value);
        if (entry) { collection.overrides.set(result.index, entry); collection.excluded.delete(result.index); }
        else collection.overrides.delete(result.index);
        node._refreshCount?.();
        const row = node.querySelector(`.transferir-row[data-index="${result.index}"] [data-testid="transferir-include"]`);
        if (row) row.checked = !collection.excluded.has(result.index);
      });
      container.replaceChildren(select, manualSearch(collection, result));
    } else {
      const c = chosen.candidate;
      container.replaceChildren(el('span', { class: 'transferir-chosen' }, `${c.title} · ${fmtDuration(c.durationS)} · ${SOURCE_LABEL[c.source] || 'YouTube'}`));
    }
  }

  function manualSearch(collection, result) {
    const input = el('input', { type: 'search', class: 'input transferir-manual', placeholder: 'Buscar en YouTube…', 'aria-label': 'Buscar en YouTube' });
    const button = el('button', {
      type: 'button', class: 'button button-text', 'data-testid': 'transferir-manual-go',
      on: {
        click: async () => {
          const q = input.value.trim();
          if (!q) return;
          button.disabled = true;
          try {
            const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}`);
            const data = await res.json().catch(() => ({}));
            const items = Array.isArray(data.items) ? data.items : [];
            if (items.length === 0) { toast('Sin resultados en YouTube.'); return; }
            result.alternatives = items.map((it) => ({ candidate: { url: it.url, title: it.title, durationS: it.durationS, source: it.source || 'search', id: it.id } }));
            result.best = result.best || result.alternatives[0];
            const cell = node.querySelector(`.transferir-row[data-index="${result.index}"] .transferir-match`);
            if (cell) paintMatch(collection, cell, result, chosenEntry(collection, result));
          } catch {
            toast('No se pudo buscar en YouTube.');
          } finally {
            button.disabled = false;
          }
        },
      },
    }, 'Buscar');
    return el('div', { class: 'transferir-manual-row' }, input, button);
  }

  // --- Transferir ------------------------------------------------------------------------------------------------------
  async function transfer() {
    if (state.transferring) return;
    const plan = buildTransferPlan(state.collections); // ya sin repetir una misma canción entre listas
    const totalTracks = plan.reduce((n, c) => n + c.tracks.length, 0);
    if (totalTracks === 0) { toast('Elige al menos una canción.'); return; }
    state.transferring = true;
    abort = new AbortController();
    const progress = el('p', { class: 'transferir-progress', 'data-testid': 'transferir-doing' }, `Preparando ${totalTracks} canciones…`);
    setSection(progress);
    let added = 0;
    let failed = 0;
    try {
      let base = 0;
      for (const collection of plan) {
        const result = await importYoutubeTracks(ctx, collection.tracks, {
          album: collection.album,
          signal: abort.signal,
          onProgress: ({ processed, total }) => { progress.textContent = `Descargando ${base + (processed || 0)} de ${totalTracks}…`; },
        });
        added += result.files.length;
        failed += result.errors.length;
        base += collection.tracks.length;
      }
      toast(added ? `${added} canciones añadidas. Se publicarán en un momento.` : 'No se pudo añadir ninguna canción.');
      setSection(
        el('p', { class: 'transferir-summary', 'data-testid': 'transferir-done' },
          `Añadidas ${added}${failed ? ` · ${failed} con error` : ''}. Verás el progreso de publicación en «Tu biblioteca».`),
        el('button', { type: 'button', class: 'homeostasia-submit', on: { click: () => { state.sources.clear(); state.collections = []; paintLibrary('¿Transferir algo más?'); } } }, 'Transferir más'),
      );
    } catch (error) {
      if (error?.needsAuth) { renderConnect('Tu sesión de Spotify ha caducado. Conéctala de nuevo.'); return; }
      setSection(
        el('p', { class: 'transferir-error', 'data-testid': 'transferir-error' }, error?.message || 'No se pudo completar la transferencia.'),
        el('button', { type: 'button', class: 'button button-text', on: { click: () => renderReview() } }, 'Volver'),
      );
    } finally {
      state.transferring = false;
    }
  }

  // --- Arranque --------------------------------------------------------------------------------------------------------
  if (isConnected()) renderLibrary();
  else renderConnect();

  return { node, cleanup: () => { abort?.abort(); } };
}

function dedupeCandidates(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const url = entry?.candidate?.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(entry);
  }
  return out;
}
