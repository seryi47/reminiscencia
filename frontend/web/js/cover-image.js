// Portada propia de una lista (solo en este navegador): la imagen elegida del dispositivo se recorta al centro en un
// cuadrado, se reduce a 640 px como mucho y se guarda como JPEG en data: dentro de la lista (IndexedDB,
// js/local-library.js). Va como data: porque la CSP solo admite imágenes de 'self' y data: (no blob:).
// squareCrop es pura y se prueba en Node (tests/web-unit/cover-image.test.mjs).

export const COVER_MAX_PX = 640;
export const COVER_INPUT_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const COVER_INPUT_ACCEPT = COVER_INPUT_TYPES.join(',');
export const COVER_INPUT_MAX_BYTES = 20 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

/** Recorte cuadrado centrado de una imagen de width × height y tamaño de salida (como mucho max). */
export function squareCrop(width, height, max = COVER_MAX_PX) {
  if (!(width > 0) || !(height > 0)) throw new RangeError('La imagen no tiene tamaño.');
  const size = Math.min(width, height);
  return {
    sx: Math.floor((width - size) / 2),
    sy: Math.floor((height - size) / 2),
    size,
    out: Math.min(size, max),
  };
}

/** Motivo en español si el archivo no sirve como portada, o null. */
export function coverFileProblem(file) {
  if (!file) return 'Elige una imagen.';
  if (!COVER_INPUT_TYPES.includes(file.type)) return 'Elige una imagen JPG, PNG o WebP.';
  if (file.size > COVER_INPUT_MAX_BYTES) return 'La imagen no puede pasar de 20 MB.';
  return null;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Algunos navegadores no decodifican todos los formatos con createImageBitmap: se prueba con <img>.
    }
  }
  const image = new Image();
  image.decoding = 'async';
  image.src = await readAsDataUrl(file);
  await image.decode();
  return image;
}

/** Convierte un archivo de imagen en una portada cuadrada JPEG (data:) de 640 px como mucho. */
export async function resizeCoverFile(file) {
  const problem = coverFileProblem(file);
  if (problem) throw new Error(problem);
  let source;
  try {
    source = await decode(file);
  } catch {
    throw new Error('No se ha podido leer la imagen.');
  }
  const crop = squareCrop(source.width, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = crop.out;
  canvas.height = crop.out;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, crop.sx, crop.sy, crop.size, crop.size, 0, 0, crop.out, crop.out);
  source.close?.();
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}
