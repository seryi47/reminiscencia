// Vista «Transferir música» (ADR-0044): hoja para traer canciones, álbumes y playlists de Spotify a la biblioteca por el
// recorrido Spotify → YouTube → Reminiscencia. Conectar cuenta → pegar enlace → analizar → revisar coincidencias (con
// alternativas y búsqueda manual) → transferir. La lógica está en js/spotify-transfer.js; el enganche al pipeline, en
// importYoutubeTracks (homeostasia.js). Web y APK comparten el motor y los endpoints del servidor.

import { el, openDialog, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  createTransferApi, beginConnect, isConnected, clearSession, resolveCollection, markDuplicates, selectedTracks,
} from '../spotify-transfer.js';
import { importYoutubeTracks } from './homeostasia.js';

const TIER_LABEL = { alta: 'Coincidencia segura', media: 'Elige la versión', baja: 'Revisa a mano' };
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
  const controller = { aborted: false };
  let abort = null;

  const state = { results: [], album: null, excluded: new Set(), overrides: new Map(), transferring: false };

  const setSection = (...children) => node.replaceChildren(...children);

  // --- Conectar --------------------------------------------------------------------------------------------------------
  function renderConnect(message) {
    const connect = el('button', {
      type: 'button', class: 'homeostasia-submit', 'data-testid': 'transferir-connect', 'data-autofocus': '',
      on: {
        click: async () => {
          try {
            const url = await beginConnect({ api, returnTo: '/#transferir' });
            window.location.href = url; // vuelve a #transferir tras autorizar; la sesión queda guardada
          } catch {
            toast('No se pudo iniciar sesión en Spotify. Inténtalo de nuevo.');
          }
        },
      },
    }, icon('note', { size: 18 }), 'Conectar con Spotify');
    setSection(
      el('p', { class: 'transferir-intro' },
        message || 'Conecta tu cuenta de Spotify para traer tus canciones, álbumes y playlists. Se identifican en YouTube y se añaden a tu biblioteca.'),
      connect,
    );
  }

  // --- Pegar enlace ----------------------------------------------------------------------------------------------------
  function renderInput(note) {
    const input = el('input', {
      type: 'url', class: 'input', 'data-testid': 'transferir-input', 'data-autofocus': '',
      placeholder: 'Pega un enlace de Spotify (canción, álbum o playlist)',
      'aria-label': 'Enlace de Spotify',
    });
    const analyze = el('button', {
      type: 'button', class: 'homeostasia-submit', 'data-testid': 'transferir-analyze',
      on: { click: () => analyzeUrl(input.value.trim()) },
    }, icon('search', { size: 18 }), 'Analizar');
    const disconnect = el('button', {
      type: 'button', class: 'button button-text', 'data-testid': 'transferir-disconnect',
      on: { click: () => { clearSession(); renderConnect('Sesión cerrada. Conecta de nuevo cuando quieras.'); } },
    }, 'Desconectar');
    setSection(
      el('p', { class: 'transferir-intro' }, note || 'Pega el enlace de lo que quieras transferir. Un álbum o una playlist mantienen su nombre y su orden.'),
      el('div', { class: 'transferir-form' }, input, analyze),
      disconnect,
    );
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') analyzeUrl(input.value.trim()); });
  }

  // --- Analizar --------------------------------------------------------------------------------------------------------
  async function analyzeUrl(url) {
    if (!url) { toast('Pega un enlace de Spotify.'); return; }
    const progress = el('p', { class: 'transferir-progress', 'data-testid': 'transferir-progress' }, 'Analizando…');
    setSection(progress);
    try {
      const out = await resolveCollection({
        api, url,
        onPage: ({ loaded, total }) => { progress.textContent = `Analizando ${loaded}${total ? ` de ${total}` : ''} canciones…`; },
      });
      state.results = markDuplicates(out.results, ctx.librarySongs());
      state.album = out.album;
      state.excluded = new Set();
      state.overrides = new Map();
      renderResults();
    } catch (error) {
      if (error?.needsAuth) { renderConnect('Tu sesión de Spotify ha caducado. Conéctala de nuevo.'); return; }
      setSection(
        el('p', { class: 'transferir-error', 'data-testid': 'transferir-error' }, error?.message || 'No se pudo analizar el enlace.'),
        el('button', { type: 'button', class: 'button button-text', on: { click: () => renderInput() } }, 'Volver'),
      );
    }
  }

  // --- Revisar coincidencias -------------------------------------------------------------------------------------------
  function chosenEntry(result) {
    return state.overrides.get(result.index) ?? (result.tier === 'alta' ? result.best : null);
  }

  function renderResults() {
    if (state.results.length === 0) {
      setSection(
        el('p', { class: 'transferir-intro', 'data-testid': 'transferir-vacio' },
          'No hay canciones accesibles aquí. En modo desarrollo, Spotify solo da el contenido de tus propias listas; '
          + 'prueba con un álbum, una canción suelta o una lista tuya.'),
        el('button', { type: 'button', class: 'homeostasia-submit', on: { click: () => renderInput() } }, 'Otro enlace'),
      );
      return;
    }
    const list = el('div', { class: 'transferir-list', 'data-testid': 'transferir-list' });
    for (const result of state.results) list.append(renderRow(result));

    const count = () => selectedTracks(state.results, { excluded: state.excluded, overrides: state.overrides }).length;
    const go = el('button', {
      type: 'button', class: 'homeostasia-submit', 'data-testid': 'transferir-go',
      on: { click: () => transfer() },
    }, icon('upload', { size: 18 }), el('span', { 'data-testid': 'transferir-go-text' }, `Transferir ${count()} canciones`));
    node._refreshCount = () => { go.querySelector('[data-testid="transferir-go-text"]').textContent = `Transferir ${count()} canciones`; };

    const already = state.results.filter((r) => r.inLibrary).length;
    const header = el('div', { class: 'transferir-summary', 'data-testid': 'transferir-summary' },
      `${state.album ? `«${state.album.name}» · ` : ''}${state.results.length} canciones`
      + (already ? ` · ${already} ya en tu biblioteca` : ''));

    setSection(
      header,
      list,
      el('div', { class: 'transferir-actions' },
        el('button', { type: 'button', class: 'button button-text', on: { click: () => renderInput() } }, 'Otro enlace'),
        go),
    );
  }

  function renderRow(result) {
    const dupe = result.inLibrary;
    const included = !dupe; // alta/dupe deciden el valor inicial; media/baja sin override no cuentan aunque esté marcado
    if (!included) state.excluded.add(result.index);

    const check = el('input', {
      type: 'checkbox', 'data-testid': 'transferir-include', 'data-index': String(result.index),
      ...(included ? { checked: '' } : {}), ...(dupe ? { disabled: '' } : {}),
      on: { change: (e) => { if (e.target.checked) state.excluded.delete(result.index); else state.excluded.add(result.index); node._refreshCount?.(); } },
    });

    const chosen = chosenEntry(result);
    const tierBadge = el('span', { class: `transferir-tier transferir-tier-${result.tier}` }, dupe ? 'Ya en tu biblioteca' : TIER_LABEL[result.tier]);
    const match = el('div', { class: 'transferir-match', 'data-testid': 'transferir-match' });
    paintMatch(match, result, chosen);

    const row = el('div', { class: 'transferir-row', 'data-testid': 'transferir-row', 'data-index': String(result.index) },
      el('label', { class: 'transferir-pick' }, check,
        el('span', { class: 'transferir-track' },
          el('span', { class: 'transferir-title' }, result.track.title),
          el('span', { class: 'transferir-artist' }, `${(result.track.artists || []).join(', ')} · ${fmtDuration((result.track.durationMs || 0) / 1000)}`))),
      tierBadge,
      match,
    );
    return row;
  }

  function paintMatch(container, result, chosen) {
    const options = dedupeCandidates([result.best, ...(result.alternatives || [])].filter(Boolean));
    if (result.tier !== 'alta' || options.length > 1 || !chosen) {
      // Selector de alternativas + búsqueda manual para media/baja (o cuando hay varias).
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
        if (entry) { state.overrides.set(result.index, entry); state.excluded.delete(result.index); }
        else state.overrides.delete(result.index);
        node._refreshCount?.();
      });
      const manual = manualSearch(result);
      container.replaceChildren(select, manual);
    } else {
      const c = chosen.candidate;
      container.replaceChildren(el('span', { class: 'transferir-chosen' },
        `${c.title} · ${fmtDuration(c.durationS)} · ${SOURCE_LABEL[c.source] || 'YouTube'}`));
    }
  }

  function manualSearch(result) {
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
            // Convierte los resultados de búsqueda en alternativas y repinta la fila.
            result.alternatives = items.map((it) => ({ candidate: { url: it.url, title: it.title, durationS: it.durationS, source: it.source || 'search', id: it.id } }));
            result.best = result.best || result.alternatives[0];
            const row = node.querySelector(`.transferir-row[data-index="${result.index}"] .transferir-match`);
            if (row) paintMatch(row, result, chosenEntry(result));
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
    const tracks = selectedTracks(state.results, { excluded: state.excluded, overrides: state.overrides });
    if (tracks.length === 0) { toast('Elige al menos una canción.'); return; }
    state.transferring = true;
    abort = new AbortController();
    const progress = el('p', { class: 'transferir-progress', 'data-testid': 'transferir-doing' }, `Preparando ${tracks.length} canciones…`);
    setSection(progress);
    try {
      const result = await importYoutubeTracks(ctx, tracks, {
        album: state.album,
        signal: abort.signal,
        onProgress: ({ processed, total, completed, failed }) => {
          progress.textContent = `Descargando ${processed || 0} de ${total} · ${completed || 0} listas${failed ? ` · ${failed} con error` : ''}…`;
        },
      });
      const added = result.files.length;
      const failed = result.errors.length;
      toast(added ? `${added} canciones añadidas. Se publicarán en un momento.` : 'No se pudo añadir ninguna canción.');
      setSection(
        el('p', { class: 'transferir-summary', 'data-testid': 'transferir-done' },
          `Añadidas ${added}${failed ? ` · ${failed} con error` : ''}. Verás el progreso de publicación en «Tu biblioteca».`),
        el('button', { type: 'button', class: 'homeostasia-submit', on: { click: () => renderInput('¿Transferir algo más?') } }, 'Transferir más'),
      );
    } catch (error) {
      if (error?.needsAuth) { renderConnect('Tu sesión de Spotify ha caducado. Conéctala de nuevo.'); return; }
      setSection(
        el('p', { class: 'transferir-error', 'data-testid': 'transferir-error' }, error?.message || 'No se pudo completar la transferencia.'),
        el('button', { type: 'button', class: 'button button-text', on: { click: () => renderResults() } }, 'Volver'),
      );
    } finally {
      state.transferring = false;
    }
  }

  // --- Arranque --------------------------------------------------------------------------------------------------------
  if (isConnected()) renderInput();
  else renderConnect();

  return {
    node,
    cleanup: () => { controller.aborted = true; abort?.abort(); },
  };
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
