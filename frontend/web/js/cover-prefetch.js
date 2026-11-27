// Prefetch de portadas en scroll (ADR-0052 ampliación). IntersectionObserver con rootMargin generoso que precarga
// las siguientes miniaturas antes de que entren al viewport, para que no haya «flash» al scrollear rápido.
//
// Uso:
//   const pf = createCoverPrefetcher({ rootMargin: '300px', max: 20 });
//   pf.observe(listContainer, (visibleIndex, items) => items.slice(visibleIndex, visibleIndex + 20).map(i => i.thumbUrl));
//   pf.stop();

const DEFAULT_ROOT_MARGIN = '300px';
const DEFAULT_MAX = 20;

/** Precarga una URL de imagen sin bloquear el hilo principal. No lanza. */
export function prefetchImage(url) {
  if (typeof url !== 'string' || url.length === 0) return;
  try {
    const img = new Image();
    // Decoding async no bloquea el render del hilo principal.
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.src = url;
  } catch { /* nada */ }
}

/** Precarga un lote de URLs, sin duplicados en una misma sesión (per-cache set). */
export function prefetchBatch(urls, seen = new Set()) {
  if (!Array.isArray(urls)) return 0;
  let n = 0;
  for (const url of urls) {
    if (typeof url !== 'string' || seen.has(url)) continue;
    seen.add(url);
    prefetchImage(url);
    n += 1;
  }
  return n;
}

/** Crea un prefetcher que observa un contenedor de scroll y pide portadas delante del viewport. */
export function createCoverPrefetcher({
  rootMargin = DEFAULT_ROOT_MARGIN,
  max = DEFAULT_MAX,
  IOClass = (typeof globalThis.IntersectionObserver !== 'undefined' ? globalThis.IntersectionObserver : null),
} = {}) {
  const seen = new Set();
  let observer = null;
  let stopped = false;
  function stop() {
    stopped = true;
    if (observer) { try { observer.disconnect(); } catch { /* nada */ } }
    observer = null;
  }
  function observe(anchorElement, nextUrlsForAnchor) {
    if (stopped || !anchorElement || typeof nextUrlsForAnchor !== 'function') return;
    if (!IOClass) {
      // Sin IntersectionObserver, prefetch inicial y ya.
      try { prefetchBatch(nextUrlsForAnchor(anchorElement) || [], seen); } catch { /* nada */ }
      return;
    }
    observer = new IOClass((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        let urls;
        try { urls = nextUrlsForAnchor(entry.target); } catch { urls = null; }
        if (urls && urls.length) prefetchBatch(urls.slice(0, max), seen);
      }
    }, { root: null, rootMargin, threshold: 0 });
    observer.observe(anchorElement);
  }
  return { observe, stop, _seenSize: () => seen.size };
}
