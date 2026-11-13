// Vista «Transferir música» (ADR-0044): hoja para traer canciones, álbumes y playlists de Spotify a la biblioteca por el
// recorrido Spotify → YouTube → Reminiscencia. Conectar cuenta → ELEGIR de tu biblioteca (playlists + «Me gusta», como
// TuneMyMusic) o pegar un enlace (álbum/canción) → analizar → revisar coincidencias (alternativas y búsqueda manual) →
// transferir. La lógica está en js/spotify-transfer.js; el enganche al pipeline, en importYoutubeTracks (homeostasia.js).

import { el, openDialog, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  createTransferApi, beginConnect, isConnected, clearSession, listLibrary, resolveCollection, markDuplicates, buildTransferPlan,
  transferStats, compareCollection, transferTrackKey,
} from '../spotify-transfer.js';
import { importYoutubeTracks, isUploadedRecently } from './homeostasia.js';

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
  // compareCache: clave→{total,have,missing} de la comparación ligera al abrir (ADR-0046). transferredKeys: título|artista
  // de lo recién transferido (aún sin publicar), para la actualización EN VIVO del contador. countLibrary: catálogo fresco
  // para esa comparación (se lee una vez por pintado del navegador).
  const state = {
    library: null, sources: new Map(), collections: [], transferring: false, recolocated: 0,
    compareCache: new Map(), transferredKeys: new Set(), countLibrary: null,
  };

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
      playlistsBox.replaceChildren(...shown.map((p) => {
        // En modo desarrollo la API no da el contenido de listas ajenas, pero si la lista es PÚBLICA se lee por el embed
        // (hasta ~100 pistas). Se deja seleccionable con un aviso; si fuera privada, al analizar saldrá vacía con su mensaje.
        const notMine = p.mine === false;
        return sourceRow(`pl:${p.id}`, p.name, `${p.total} canciones`, { ref: { type: 'playlist', id: p.id } },
          { note: notMine ? `No es tuya (de ${p.ownerName || 'otra cuenta'}): se importa por la vía pública, máx 100` : null });
      }));
      // Recuento automático al abrir (ADR-0046), solo de las listas PROPIAS visibles (las ajenas no dan contenido en dev).
      unawaitedCounts(shown.filter((p) => p.mine !== false).map((p) => ({ key: `pl:${p.id}`, source: { ref: { type: 'playlist', id: p.id } } })));
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
    // Recuento automático de «Me gusta» al abrir (ADR-0046).
    unawaitedCounts(liked > 0 ? [{ key: 'liked', source: { source: 'liked' } }] : []);
  }

  const analyzeLabel = () => (state.sources.size > 0 ? `Analizar ${state.sources.size} selección${state.sources.size > 1 ? 'es' : ''}` : 'Elige algo para analizar');

  function sourceRow(key, title, subtitle, source, { disabled = false, note = null } = {}) {
    const check = el('input', {
      type: 'checkbox', 'data-testid': 'transferir-source', 'data-key': key,
      ...(disabled ? { disabled: '' } : {}),
      ...(state.sources.has(key) ? { checked: '' } : {}),
      on: { change: (e) => toggleSource(key, { label: title, ...source }, e.target.checked) },
    });
    const cached = state.compareCache.get(key);
    return el('label', { class: `transferir-source-row${disabled ? ' transferir-source-off' : ''}` }, check,
      el('span', { class: 'transferir-track' },
        el('span', { class: 'transferir-title' }, title),
        el('span', { class: 'transferir-artist' }, subtitle),
        // Recuento «faltan K de N» que se rellena solo al abrir el panel (ADR-0046), sin iniciar una transferencia.
        el('span', { class: 'transferir-count', 'data-testid': 'transferir-source-count', 'data-count-key': key },
          cached ? countLabel(cached) : ''),
        ...(note ? [el('span', { class: 'transferir-note' }, note)] : [])));
  }

  const countLabel = ({ total, have, missing }) =>
    missing === 0 ? `✓ Ya las tienes todas (${total})` : `Faltan ${missing} de ${total} · ya tienes ${have}`;

  const targetOf = (source) => (source.source ? { source: source.source } : (source.ref ? { ref: source.ref } : { url: source.url }));

  // Rellena en segundo plano (concurrencia 2, con caché) el recuento de cada fila visible comparando con tu biblioteca, SIN
  // resolver YouTube (compareOnly). La actualización en vivo pasa `transferredKeys` como «ya la tienes».
  const unawaitedCounts = (entries) => { if (entries.length) void refreshRowCounts(entries).catch(() => {}); };

  async function refreshRowCounts(entries) {
    state.countLibrary = state.countLibrary ?? (await freshLibrary()).songs;
    const pending = entries.filter(({ key }) => !state.compareCache.has(key));
    let next = 0;
    const worker = async () => {
      while (next < pending.length) {
        const { key, source } = pending[next++];
        try {
          const stats = await compareCollection({
            api, ...targetOf(source), songs: state.countLibrary, owned: state.transferredKeys,
          });
          if (stats.total > 0) {
            state.compareCache.set(key, stats);
            const span = node.querySelector(`[data-count-key="${CSS.escape(key)}"]`);
            if (span) span.textContent = countLabel(stats);
          }
        } catch { /* una lista que no se puede leer (p. ej. privada ajena) se deja sin recuento */ }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  function toggleSource(key, source, on) {
    if (on) state.sources.set(key, source); else state.sources.delete(key);
    node._refreshAnalyze?.();
  }

  // Lee el catálogo PUBLICADO fresco del servidor (sin caché), para que la comparación «ya la tienes» no use la copia en
  // memoria, que puede estar desactualizada en una pestaña abierta hace rato (por eso ofrecía canciones ya transferidas).
  async function freshLibrary() {
    const get = async (url, fallback) => {
      try {
        const res = await fetch(`${url}?cb=${Date.now()}`, { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        return Array.isArray(data) ? data : fallback;
      } catch { return fallback; }
    };
    const [songs, folders] = await Promise.all([
      get('data/songs.json', ctx.librarySongs()),
      get('data/folders.json', ctx.libraryFolders?.() ?? []),
    ]);
    return { songs, folders };
  }

  // --- Analizar las selecciones ----------------------------------------------------------------------------------------
  async function analyzeSelected() {
    if (state.sources.size === 0) { toast('Elige al menos una playlist, «Me gusta» o pega un enlace.'); return; }
    const progress = el('p', { class: 'transferir-progress', 'data-testid': 'transferir-progress' }, 'Analizando…');
    setSection(progress);
    const collections = [];
    try {
      const library = await freshLibrary(); // catálogo publicado al día, para comparar bien
      for (const [, source] of state.sources) {
        progress.textContent = `Analizando «${source.label}»…`;
        const target = source.source ? { source: source.source } : (source.ref ? { ref: source.ref } : { url: source.url });
        const out = await resolveCollection({
          api, ...target,
          onPage: ({ loaded, total }) => { progress.textContent = `«${source.label}»: ${loaded}${total ? ` de ${total}` : ''} canciones…`; },
        });
        markDuplicates(out.results, library.songs);
        // Además de lo publicado, cuenta como «ya la tienes» lo recién subido/en cola (aún sin publicar), para no ofrecer
        // como nuevas las que acabas de transferir hace un momento.
        for (const r of out.results) {
          if (r.inLibrary) continue;
          if (r.best && isUploadedRecently(r.best.candidate.url)) r.inLibrary = true;
          else if (state.transferredKeys.has(transferTrackKey(r.track))) r.inLibrary = true; // recién transferida (en vivo)
        }
        collections.push({ name: source.label, album: out.album, results: out.results, excluded: new Set(), overrides: new Map() });
      }
      state.collections = collections;
      // Recoloca al momento lo que ya tienes pero suelto/en otro álbum (cubre también el caso «todo ya lo tienes», en el
      // que no hay nada que transferir pero sí que recolocar).
      progress.textContent = 'Ordenando álbumes…';
      state.recolocated = await recolocateOwned(library.folders);
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
    // Compara cada lista/álbum de Spotify con TU biblioteca (markDuplicates ya marcó `inLibrary`) y resume qué es nuevo y
    // qué ya tienes. Solo se LISTAN las que conviene revisar (media/baja); las seguras y las que ya tienes se cuentan.
    const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
    const blocks = [];
    let anyReview = false;
    let totalNew = 0;
    let totalHave = 0;
    for (const collection of state.collections) {
      if (collection.results.length === 0) continue;
      const total = collection.results.length;
      const have = collection.results.filter((r) => r.inLibrary).length;
      const review = collection.results.filter((r) => !r.inLibrary && r.tier !== 'alta');
      const sure = total - have - review.length;
      const missing = total - have; // lo que falta por transferir = se añaden solas + a revisar
      totalNew += missing;
      totalHave += have;
      // Número EXPLÍCITO (ADR-0046): total del álbum, cuántas ya tienes y cuántas faltan; y, si hay que revisar, el desglose
      // de las que faltan (se añaden solas / a revisar).
      const breakdown = [sure ? `${sure} se añaden solas` : null, review.length ? `${review.length} a revisar` : null]
        .filter(Boolean).join(' · ');
      const counts = missing === 0
        ? `✓ Ya las tienes todas (${total})`
        : `Faltan ${missing} de ${total} · ya tienes ${have}${breakdown ? ` · ${breakdown}` : ''}`;
      blocks.push(el('div', { class: `transferir-colhead${missing === 0 ? ' transferir-colhead-done' : ''}`, 'data-testid': 'transferir-colhead' },
        el('span', { class: 'transferir-sub' }, collection.name),
        el('span', { class: 'transferir-counts' }, counts)));
      if (review.length === 0) continue;
      anyReview = true;
      const list = el('div', { class: 'transferir-list', 'data-testid': 'transferir-list' });
      for (const result of review) list.append(renderRow(collection, result));
      blocks.push(list);
    }

    const recolocNote = () => (state.recolocated > 0
      ? el('p', { class: 'transferir-counts', 'data-testid': 'transferir-recolocadas' },
        `✓ Recolocadas ${plural(state.recolocated, 'canción que ya tenías', 'canciones que ya tenías')} en su álbum.`)
      : el('div'));

    // Ya lo tienes todo: nada nuevo que importar.
    if (totalNew === 0) {
      setSection(
        el('p', { class: 'transferir-intro', 'data-testid': 'transferir-nada-nuevo' },
          `Ya tienes en tu biblioteca todas las canciones de lo que elegiste (${plural(totalHave, 'canción', 'canciones')}). No hay nada nuevo que importar.`),
        recolocNote(),
        ...blocks,
        el('button', { type: 'button', class: 'homeostasia-submit', on: { click: () => paintLibrary() } }, 'Elegir otra cosa'),
      );
      return;
    }

    const go = el('button', {
      type: 'button', class: 'homeostasia-submit', 'data-testid': 'transferir-go',
      on: { click: () => transfer() },
    }, icon('upload', { size: 18 }), el('span', { 'data-testid': 'transferir-go-text' }, `Transferir ${totalSelected()} canciones`));
    node._refreshCount = () => { go.querySelector('[data-testid="transferir-go-text"]').textContent = `Transferir ${totalSelected()} canciones`; };

    const stats = transferStats(state.collections);
    setSection(
      el('p', { class: 'transferir-intro' },
        `Comparado con tu biblioteca: faltan ${plural(stats.uniqueMissing, 'canción', 'canciones')} por transferir${stats.totalHave ? `; ya tienes ${stats.totalHave}` : ''}. `
        + (anyReview ? 'Abajo solo lo que conviene revisar (ya hay una versión elegida; cámbiala solo si hace falta).'
          : 'Todo identificado automáticamente. Dale a «Transferir».')),
      recolocNote(),
      ...blocks,
      el('div', { class: 'transferir-actions' },
        el('button', { type: 'button', class: 'button button-text', on: { click: () => paintLibrary() } }, 'Elegir otra cosa'),
        go),
    );
  }

  function renderRow(collection, result) {
    // Solo se renderizan las de revisar (media/baja). Baja sin candidato elegido queda fuera por defecto; media viene con
    // su mejor versión ya elegida e incluida.
    const chosen = chosenEntry(collection, result);
    if (!chosen) collection.excluded.add(result.index);
    const included = !collection.excluded.has(result.index);
    const check = el('input', {
      type: 'checkbox', 'data-testid': 'transferir-include', 'data-index': String(result.index),
      ...(included ? { checked: '' } : {}),
      on: { change: (e) => { if (e.target.checked) collection.excluded.delete(result.index); else collection.excluded.add(result.index); node._refreshCount?.(); } },
    });

    const tierBadge = el('span', { class: `transferir-tier transferir-tier-${result.tier}` }, TIER_LABEL[result.tier]);
    const match = el('div', { class: 'transferir-match', 'data-testid': 'transferir-match' });
    paintMatch(collection, match, result, chosen);

    return el('div', { class: 'transferir-row', 'data-testid': 'transferir-row', 'data-index': String(result.index) },
      el('label', { class: 'transferir-pick' }, check,
        el('span', { class: 'transferir-track' },
          el('span', { class: 'transferir-title' }, result.track.title),
          el('span', { class: 'transferir-artist' }, `${(result.track.artists || []).join(', ')} · ${fmtDuration((result.track.durationMs || 0) / 1000)}`))),
      tierBadge,
      match);
  }

  // Selector de versión (compacto) + un enlace para buscar otra en YouTube (oculto hasta que se pulsa).
  function paintMatch(collection, container, result, chosen) {
    const options = dedupeCandidates([result.best, ...(result.alternatives || [])].filter(Boolean));
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
      const cb = node.querySelector(`.transferir-row[data-index="${result.index}"] [data-testid="transferir-include"]`);
      if (cb) cb.checked = !collection.excluded.has(result.index);
    });
    const manual = manualSearch(collection, result);
    manual.hidden = true;
    const toggle = el('button', {
      type: 'button', class: 'transferir-manual-toggle', 'data-testid': 'transferir-manual-toggle',
      on: { click: () => { manual.hidden = !manual.hidden; if (!manual.hidden) manual.querySelector('input')?.focus(); } },
    }, 'Buscar otra en YouTube');
    container.replaceChildren(select, toggle, manual);
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

  // --- Transferir (con auto-reanudar) ----------------------------------------------------------------------------------
  // El tope del conversor (yttowav/YouTube) es externo y no se puede eliminar en gratis. En vez de dejarlo a cargo del
  // usuario, la transferencia se reintenta SOLA: cuando una tanda termina con fallos (tope alcanzado), espera unos minutos
  // (para que el tope se recupere) y vuelve a intentar SOLO lo que falta (la caché salta lo ya hecho), en bucle, hasta
  // completar. El usuario solo deja la pestaña abierta; puede pararlo cuando quiera (ADR-0044).
  const AUTO_RESUME_GAP_MS = 10 * 60 * 1000; // espera entre ciclos
  const AUTO_RESUME_MAX_CYCLES = 24; // tope de seguridad (~4 h) por si el bloqueo no se levanta

  // Espera hasta `resumeAt` mostrando una cuenta atrás; se resuelve al llegar, se rechaza si se cancela.
  function countdownWait(node, resumeAt, remaining, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new Error('abort')); return; }
      const tick = () => {
        if (signal.aborted) { clearInterval(iv); reject(new Error('abort')); return; }
        const ms = resumeAt - Date.now();
        if (ms <= 0) { clearInterval(iv); signal.removeEventListener('abort', onAbort); resolve(); return; }
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        node.textContent = `Tope del conversor alcanzado. Reintento automático en ${m}:${String(s).padStart(2, '0')} — quedan ~${remaining} canciones.`;
      };
      const onAbort = () => { clearInterval(iv); reject(new Error('abort')); };
      signal.addEventListener('abort', onAbort, { once: true });
      const iv = setInterval(tick, 1000);
      tick();
    });
  }

  // Recoloca en su álbum las canciones que YA tienes en la biblioteca pero sueltas (o en otro álbum): si existe un álbum
  // con el nombre de la colección, mueve ahí las coincidencias que no estén ya dentro. Así «importar el álbum X» deja todo
  // en X aunque ya lo tuvieras (p. ej. las que quedaron sin carpeta por el bug del id con dos puntos). Devuelve cuántas movió.
  async function recolocateOwned(folders = ctx.libraryFolders?.() ?? []) {
    const byName = new Map(folders.map((f) => [String(f.name ?? '').trim().toLowerCase(), f]));
    let moved = 0;
    for (const collection of state.collections) {
      if (!collection.album?.name) continue;
      const folder = byName.get(String(collection.album.name).trim().toLowerCase());
      if (!folder) continue; // si el álbum aún no existe, lo crea la subida de las nuevas
      const ids = [];
      for (const r of collection.results) {
        const m = r.libraryMatch;
        if (m?.id && m.folderId !== folder.id && !ids.includes(m.id)) ids.push(m.id);
      }
      if (ids.length === 0) continue;
      try { await ctx.saveEdit?.({ op: 'move_songs', song_ids: ids, folder_id: folder.id }); moved += ids.length; }
      catch (error) { console.error('Transferir: no se pudieron recolocar canciones en su álbum.', error); }
    }
    return moved;
  }

  async function transfer() {
    if (state.transferring) return;
    const plan = buildTransferPlan(state.collections); // ya sin repetir una misma canción entre listas
    const totalTracks = plan.reduce((n, c) => n + c.tracks.length, 0);
    if (totalTracks === 0) { toast('Elige al menos una canción.'); return; }
    state.transferring = true;
    abort = new AbortController();
    const progress = el('p', { class: 'transferir-progress', 'data-testid': 'transferir-doing' }, `Preparando ${totalTracks} canciones…`);
    const stop = el('button', { type: 'button', class: 'button button-text', 'data-testid': 'transferir-stop', on: { click: () => abort.abort() } }, 'Parar');
    setSection(progress, el('div', { class: 'transferir-actions' }, stop));
    let addedTotal = 0;
    let lastFailed = 0;
    let hitDailyLimit = false;
    try {
      let cycle = 0;
      while (!abort.signal.aborted) {
        cycle += 1;
        let base = 0;
        let addedCycle = 0;
        let failedCycle = 0;
        for (const collection of plan) {
          if (abort.signal.aborted) break;
          const result = await importYoutubeTracks(ctx, collection.tracks, {
            album: collection.album,
            signal: abort.signal,
            onProgress: ({ processed }) => {
              const prefix = cycle > 1 ? `Reintento ${cycle}` : 'Descargando';
              progress.textContent = `${prefix}: ${base + (processed || 0)} de ${totalTracks}…`;
            },
          });
          addedCycle += result.files.length;
          failedCycle += result.errors.length;
          if (result.dailyLimit) hitDailyLimit = true;
          base += collection.tracks.length;
        }
        addedTotal += addedCycle;
        lastFailed = failedCycle;
        if (abort.signal.aborted) break;
        if (hitDailyLimit) break; // tope DIARIO del conversor: no sirve reintentar hoy
        if (failedCycle === 0) break; // completado: ya no falla nada
        if (cycle >= AUTO_RESUME_MAX_CYCLES) break;
        try { await countdownWait(progress, Date.now() + AUTO_RESUME_GAP_MS, failedCycle, abort.signal); }
        catch { break; } // parado durante la espera
      }
      const done = lastFailed === 0 && !abort.signal.aborted && !hitDailyLimit;
      const stopped = abort.signal.aborted;
      // Actualización EN VIVO (ADR-0046): si se transfirió todo sin fallos, esas canciones ya las tienes (aunque tarden un
      // poco en publicarse). Se guardan sus claves y se vacía la caché de recuentos para que el navegador recompute «faltan».
      if (done) {
        for (const collection of plan) {
          for (const track of collection.tracks) state.transferredKeys.add(transferTrackKey({ title: track.title, artist: track.artist }));
        }
        state.compareCache.clear();
        state.countLibrary = null;
      }
      toast(addedTotal ? `${addedTotal} canciones añadidas. Se publicarán en un momento.` : 'No se pudo añadir ninguna canción.');
      setSection(
        el('p', { class: 'transferir-summary', 'data-testid': 'transferir-done' },
          done
            ? `¡Listo! Añadidas ${addedTotal}. Verás el progreso de publicación en «Tu biblioteca».`
            : `Añadidas ${addedTotal}${lastFailed ? ` · quedan ~${lastFailed}` : ''}. ${hitDailyLimit ? 'Se alcanzó el límite DIARIO del conversor.' : (stopped ? 'Reintento automático detenido.' : 'Se alcanzó el límite de reintentos.')}`),
        done
          ? el('div')
          : el('p', { class: 'transferir-intro' },
            hitDailyLimit
              ? 'El conversor gratuito (yttowav) solo permite 40 canciones al día. Vuelve mañana y dale a «Transferir» con la '
                + 'misma lista: saltará lo que ya tengas y seguirá con lo que falte. (Para no tener este tope haría falta un conversor propio.)'
              : 'El tope es de YouTube, no un fallo. Vuelve a darle a «Transferir» más tarde: saltará lo que ya tienes y seguirá con lo que falta.'),
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
