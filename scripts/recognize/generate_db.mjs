// Genera la base de huellas de la biblioteca (ADR-0048). Lee el catálogo público, baja cada .opus, lo decodifica a PCM
// mono 16 kHz con ffmpeg, calcula los hashes con la MISMA implementación que el móvil (recognize-fingerprint.js) y
// escribe dos ficheros que el Worker sirve por su binding ASSETS:
//
//   worker/recognize-data/fingerprints.json   → { hash_int_as_string: [{s: songId, o: offset}, ...] }
//   worker/recognize-data/meta.json           → { songId: {title, artist} }
//
// Uso:
//   node scripts/recognize/generate_db.mjs [--limit=N] [--catalog=url] [--out=dir]
//
// Requisitos: ffmpeg en el PATH (brew install ffmpeg).

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fingerprintSamples, pcm16leToFloat32, SAMPLE_RATE } from '../../frontend/web/server/recognize-fingerprint.js';

function parseArgs(argv) {
  const args = { limit: 0, catalog: 'https://reminiscencia.cometia.es/data/songs.json', out: 'worker/recognize-data' };
  for (const a of argv.slice(2)) {
    const m = /^--(\w+)=(.*)$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'limit') args.limit = Number(v) || 0;
    else if (k === 'catalog') args.catalog = v;
    else if (k === 'out') args.out = v;
  }
  return args;
}

async function fetchCatalog(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`catálogo HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('catálogo no es un array');
  return data;
}

function audioUrl(song) {
  // El catálogo trae `audio: "audio/S123.opus"`. Lo subimos al mismo origen que el catálogo (reminiscencia.cometia.es).
  const base = 'https://reminiscencia.cometia.es/';
  if (typeof song.audio !== 'string') return null;
  if (song.audio.startsWith('http')) return song.audio;
  return base + song.audio.replace(/^\//, '');
}

async function downloadToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer;
}

/** Decodifica un buffer de audio comprimido (opus/mp3/etc.) a PCM mono 16-bit LE a SAMPLE_RATE con ffmpeg. */
function decodeToPcm(buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE),
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let errText = '';
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (c) => { errText += c.toString(); });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg exit ${code}: ${errText.trim()}`));
      else resolve(Buffer.concat(chunks));
    });
    ff.stdin.end(buffer);
  });
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[fingerprint-db] catálogo=${args.catalog}`);
  const catalog = await fetchCatalog(args.catalog);
  let songs = catalog.filter((s) => typeof s?.id === 'string' && audioUrl(s));
  if (args.limit > 0) songs = songs.slice(0, args.limit);
  console.log(`[fingerprint-db] a procesar=${songs.length} de ${catalog.length}`);

  /** @type {Record<string, Array<{s: string, o: number}>>} */
  const index = Object.create(null);
  /** @type {Record<string, {title?: string, artist?: string}>} */
  const meta = Object.create(null);

  let ok = 0, fail = 0;
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    const url = audioUrl(song);
    try {
      process.stdout.write(`[${i + 1}/${songs.length}] ${song.id} ${song.title ?? ''} — ${song.artist ?? ''}… `);
      const audio = await downloadToBuffer(url);
      const pcm = await decodeToPcm(audio);
      const samples = pcm16leToFloat32(pcm);
      const hashes = fingerprintSamples(samples);
      for (const { hash, offset } of hashes) {
        const key = String(hash);
        (index[key] ??= []).push({ s: song.id, o: offset });
      }
      meta[song.id] = { title: song.title ?? '', artist: song.artist ?? '' };
      ok++;
      process.stdout.write(`OK (${hashes.length} hashes)\n`);
    } catch (e) {
      fail++;
      process.stdout.write(`FALLO (${e.message ?? e})\n`);
    }
  }

  await mkdir(args.out, { recursive: true });
  const fpPath = path.join(args.out, 'fingerprints.json');
  const metaPath = path.join(args.out, 'meta.json');
  await writeFile(fpPath, JSON.stringify(index));
  await writeFile(metaPath, JSON.stringify(meta));
  const totalHashes = Object.values(index).reduce((n, list) => n + list.length, 0);
  const uniqueHashes = Object.keys(index).length;
  console.log(`[fingerprint-db] canciones OK=${ok} fallidas=${fail}`);
  console.log(`[fingerprint-db] hashes totales=${totalHashes} únicos=${uniqueHashes}`);
  console.log(`[fingerprint-db] escrito ${fpPath} y ${metaPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
