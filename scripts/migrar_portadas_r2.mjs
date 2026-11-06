#!/usr/bin/env node
// Migración de las portadas de Git al índice de portadas de R2 (ADR-0029). Sube por el Worker (POST /api/portada, el
// mismo camino que la web y la APK: misma validación, mismo nombre inmutable portadas/<id>-<hash>.jpg y la misma
// escritura condicional del índice) las portadas que ya publica la web: las de las canciones públicas de
// frontend/web/data/songs.json y las de los álbumes de frontend/web/data/folders.json, con el JPEG de
// audio-library/covers/<id>.jpg (o, si falta, de frontend/web/covers/<id>.jpg). Las de canciones privadas NO se suben:
// el bucket es público. No borra nada de Git ni del bucket, y nunca pisa una portada que ya esté en el índice (si
// alguien la cambió desde la web, la suya es más nueva). Sin credenciales: el Worker ya tiene el bucket.
//
// Uso (desde la raíz del repositorio):
//   node scripts/migrar_portadas_r2.mjs --worker https://reminiscencia-api.<subdominio>.workers.dev            (simulación)
//   node scripts/migrar_portadas_r2.mjs --worker https://reminiscencia-api.<subdominio>.workers.dev --aplicar
// Lo ejecuta también el workflow manual .github/workflows/migrar-portadas.yml. Sale con código 1 si algo falla.
// Pruebas: tests/web-unit/migrar-portadas.test.mjs (con el Worker real y R2 simulado).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const COVER_PATH = /^covers\/([SF][0-9a-f]{16})\.jpg$/;
const MAX_COVER_BYTES = 1024 * 1024;

/** Fichero que el Worker dará a estos bytes: portadas/<id>-<16 hex del SHA-256>.jpg. */
export function expectedKey(id, bytes) {
  return `portadas/${id}-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.jpg`;
}

/** Ids con portada publicada en la web (canciones públicas y álbumes), sin repetir. */
export function publishedCoverIds(songs, folders) {
  const ids = [];
  for (const item of [...(Array.isArray(songs) ? songs : []), ...(Array.isArray(folders) ? folders : [])]) {
    const match = typeof item?.cover === 'string' ? COVER_PATH.exec(item.cover) : null;
    if (match && match[1] === item.id && !ids.includes(item.id)) ids.push(item.id);
  }
  return ids;
}

/**
 * Qué hacer con cada portada: { id, key, bytes, action } con action 'subir', 'ya-esta' (el índice ya apunta a ese
 * fichero), 'otra-mas-nueva' (el índice tiene otra: se respeta), 'falta' (no hay JPEG) o 'no-vale' (no es un JPEG o
 * pasa de 1 MB). readCover(id) → bytes o null.
 */
export function planMigration({ ids, readCover, index }) {
  return ids.map((id) => {
    const bytes = readCover(id);
    if (!bytes) return { id, action: 'falta' };
    const valid = bytes.length > 4 && bytes.length <= MAX_COVER_BYTES && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    if (!valid) return { id, action: 'no-vale' };
    const key = expectedKey(id, bytes);
    if (index[id] === key) return { id, key, bytes, action: 'ya-esta' };
    if (index[id]) return { id, key, bytes, action: 'otra-mas-nueva' };
    return { id, key, bytes, action: 'subir' };
  });
}

async function readIndex(worker, fetchImpl) {
  const response = await fetchImpl(`${worker}/api/portadas`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`No se ha podido leer el índice (${response.status}).`);
  return response.json();
}

/** Ejecuta la migración. Devuelve { plan, uploaded, failed } y escribe el informe con log. */
export async function migrate({ worker, apply = false, root = ROOT, fetchImpl = globalThis.fetch, log = console.log }) {
  const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const songs = readJson('frontend/web/data/songs.json');
  const folders = readJson('frontend/web/data/folders.json');
  const readCover = (id) => {
    for (const path of [`audio-library/covers/${id}.jpg`, `frontend/web/covers/${id}.jpg`]) {
      if (existsSync(join(root, path))) return new Uint8Array(readFileSync(join(root, path)));
    }
    return null;
  };
  const index = await readIndex(worker, fetchImpl);
  const plan = planMigration({ ids: publishedCoverIds(songs, folders), readCover, index });
  for (const item of plan) log(`${item.action.padEnd(15)} ${item.id}${item.key ? ` → ${item.key}` : ''}`);
  const pending = plan.filter((item) => item.action === 'subir');
  log(`${plan.length} portadas publicadas; ${pending.length} por subir.${apply ? '' : ' Simulación: añade --aplicar para subirlas.'}`);
  const uploaded = [];
  const failed = plan.filter((item) => item.action === 'falta' || item.action === 'no-vale').map((item) => item.id);
  if (!apply) return { plan, uploaded, failed };
  for (const item of pending) {
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt += 1) {
      try {
        const response = await fetchImpl(`${worker}/api/portada`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg', 'X-Portada-Id': item.id },
          body: item.bytes,
        });
        const data = await response.json().catch(() => null);
        ok = response.ok && data?.portada === item.key;
        if (!ok && response.status < 500) break;
      } catch {
        ok = false;
      }
    }
    (ok ? uploaded : failed).push(item.id);
  }
  // Comprobación: el índice apunta a cada portada subida.
  const after = await readIndex(worker, fetchImpl);
  for (const item of pending.filter((entry) => uploaded.includes(entry.id))) {
    if (after[item.id] !== item.key) {
      uploaded.splice(uploaded.indexOf(item.id), 1);
      failed.push(item.id);
    }
  }
  log(`Subidas y comprobadas: ${uploaded.length}. Con problemas: ${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''}.`);
  return { plan, uploaded, failed };
}

function parseArgs(argv) {
  const args = { worker: '', apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--aplicar') args.apply = true;
    else if (argv[index] === '--worker') args.worker = argv[++index] ?? '';
    else throw new Error(`Opción desconocida: ${argv[index]}`);
  }
  const worker = args.worker.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(worker) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(worker)) {
    throw new Error('Indica la dirección del Worker con --worker https://reminiscencia-api.<subdominio>.workers.dev');
  }
  return { ...args, worker };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { worker, apply } = parseArgs(process.argv.slice(2));
    const { failed } = await migrate({ worker, apply });
    process.exitCode = failed.length > 0 ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
