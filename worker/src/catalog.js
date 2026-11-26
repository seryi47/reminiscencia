// Catálogo + versión del catálogo en R2 (ADR-0052). El Worker es el único escritor.
//
//   catalog/catalog.json  → { version:int, folders:[], songs:[], updated_at:iso }  (fuente de verdad)
//   catalog/VERSION.txt   → texto ASCII con la versión (cache rápido, se escribe tras catalog.json)
//
// Lecturas públicas (GET /api/catalogo/latest) sirven este JSON con Cache-Control: no-store y ETag W/"v<version>".

export const CATALOG_KEY = 'catalog/catalog.json';
export const VERSION_KEY = 'catalog/VERSION.txt';

/** Lee el catálogo actual de R2. Devuelve null si no existe (estado "aún no migrado"). */
export async function readCatalog(bucket) {
  if (!bucket) return null;
  const object = await bucket.get(CATALOG_KEY);
  if (!object) return null;
  const text = await object.text();
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.version !== 'number') return null;
    if (!Array.isArray(parsed.folders)) parsed.folders = [];
    if (!Array.isArray(parsed.songs)) parsed.songs = [];
    return parsed;
  } catch {
    return null;
  }
}

/** Escribe el catálogo (versión incluida ya en el objeto). Actualiza también VERSION.txt. */
export async function writeCatalog(bucket, catalog) {
  const body = JSON.stringify(catalog);
  await bucket.put(CATALOG_KEY, body, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  await bucket.put(VERSION_KEY, String(catalog.version), { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
}

/** Inicializa un catálogo vacío (solo útil en pruebas y en la migración). */
export function emptyCatalog() {
  return { version: 0, folders: [], songs: [], updated_at: new Date(0).toISOString() };
}
