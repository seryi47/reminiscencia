// Color dominante de una portada, para los degradados de la cabecera de un álbum o una lista, el minirreproductor y
// la pantalla completa (como hace Spotify). La parte pura (elegir el color de unos píxeles y oscurecerlo hasta que el
// texto blanco contraste) se prueba en Node (tests/web-unit/cover-color.test.mjs). La parte del navegador lee la
// imagen en un canvas de 24 × 24: las portadas son del propio origen o data:, así que el canvas no queda «contaminado».

/** Contraste mínimo del texto blanco sobre el color elegido: el mismo que la paleta de portadas generadas (6:1). */
export const MIN_WHITE_CONTRAST = 6;

const SAMPLE_SIZE = 24;

const clamp = (value) => Math.min(255, Math.max(0, Math.round(value)));

/** '#rrggbb' de tres canales de 0 a 255. */
export function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => clamp(value).toString(16).padStart(2, '0')).join('')}`;
}

/** [r, g, b] de '#rrggbb' (o '#rgb'), o null si no es un color hexadecimal. */
export function hexToRgb(hex) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join('') : match[1];
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));
}

/** Luminancia relativa de WCAG 2.x. */
export function relativeLuminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contraste WCAG entre dos colores hexadecimales. */
export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexToRgb(hexA));
  const b = relativeLuminance(hexToRgb(hexB));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Oscurece el color (hacia el negro, conservando el tono) hasta que el blanco contraste al menos `min`. */
export function ensureWhiteContrast(hex, min = MIN_WHITE_CONTRAST) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  for (let step = 0; step <= 40; step += 1) {
    const factor = 1 - step * 0.025;
    const candidate = rgbToHex(rgb[0] * factor, rgb[1] * factor, rgb[2] * factor);
    if (contrastRatio(candidate, '#ffffff') >= min) return candidate;
  }
  return '#000000';
}

/**
 * Color representativo de unos píxeles RGBA (un Uint8ClampedArray de getImageData, o un array). Agrupa los colores en
 * cubos de 4 bits por canal y pesa más los saturados y los de luminosidad media, como el color «de fondo» que usa
 * Spotify; devuelve la media del cubo ganador. Ignora los píxeles casi transparentes. null si no queda ninguno.
 */
export function pickDominantColor(data) {
  const buckets = new Map();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (data[i + 3] < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const lightness = (max + min) / 510;
    const weight = 1 + saturation * 3 - Math.abs(lightness - 0.5);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0, n: 0 };
    bucket.weight += weight;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    buckets.set(key, bucket);
  }
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
  return best ? rgbToHex(best.r / best.n, best.g / best.n, best.b / best.n) : null;
}

// ---------------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------------

const cache = new Map();

/** Color ya calculado de una portada (o undefined si todavía no se ha calculado). */
export function cachedDominantColor(src) {
  const value = cache.get(src);
  return typeof value === 'string' || value === null ? value : undefined;
}

/** Calcula (una vez por imagen) el color dominante de una portada, ya oscurecido. Resuelve null si no se puede. */
export function loadDominantColor(src) {
  if (!src) return Promise.resolve(null);
  const known = cache.get(src);
  if (known !== undefined) return Promise.resolve(known);
  const promise = new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        resolve(ensureWhiteContrast(pickDominantColor(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data)));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = src;
  }).then((color) => {
    cache.set(src, color);
    return color;
  });
  cache.set(src, promise);
  return promise;
}

/**
 * Pone --cover-color en los nodos: el color dominante de src si ya se conoce; si no, fallback, y cuando se calcule,
 * el dominante (si los nodos siguen en la página).
 */
export function paintCoverColor(nodes, src, fallback) {
  const list = nodes.filter(Boolean);
  const set = (color) => { for (const node of list) node.style.setProperty('--cover-color', color); };
  const known = src ? cachedDominantColor(src) : null;
  set(known || fallback);
  if (src && known === undefined) {
    loadDominantColor(src).then((color) => {
      if (color && list.some((node) => node.isConnected)) set(color);
    });
  }
}
