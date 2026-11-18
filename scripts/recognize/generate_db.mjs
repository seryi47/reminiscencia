// Genera la base de huellas de la biblioteca para D1 (ADR-0048). Lee el catálogo público, baja cada .opus, lo
// decodifica a PCM mono 16 kHz con ffmpeg, calcula los hashes con la MISMA implementación que el móvil
// (recognize-fingerprint.js) y escribe un fichero SQL con los INSERTs para `wrangler d1 execute --file=…`.
//
// Poda para no inflar D1: por cada (hash, song_id) conservamos como mucho [maxOffsetsPerHashSong] offsets y, además,
// subsampleamos los hashes de la canción tomando 1 de cada [stride] (los hashes consecutivos son casi redundantes). Así
// bajamos el tamaño de ~150 000 a ~10 000 hashes por canción sin perder discriminación.
//
// Uso:
//   node scripts/recognize/generate_db.mjs [--limit=N] [--stride=K] [--max-per-hash-song=M] [--out=file.sql]

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fingerprintSamples, pcm16leToFloat32, SAMPLE_RATE } from '../../frontend/web/server/recognize-fingerprint.js';

function parseArgs(argv) {
  const args = {
    limit: 0,
    catalog: 'https://reminiscencia.cometia.es/data/songs.json',
    out: 'scripts/recognize/fingerprints.sql',
    stride: 4,
    maxOffsetsPerHashSong: 3,
    chunkRows: 500,
  };
  for (const a of argv.slice(2)) {
    const m = /^--([\w-]+)=(.*)$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'limit') args.limit = Number(v) || 0;
    else if (k === 'catalog') args.catalog = v;
    else if (k === 'out') args.out = v;
    else if (k === 'stride') args.stride = Math.max(1, Number(v) || 1);
    else if (k === 'max-per-hash-song') args.maxOffsetsPerHashSong = Math.max(1, Number(v) || 1);
    else if (k === 'chunk-rows') args.chunkRows = Math.max(50, Number(v) || 500);
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
  const base = 'https://reminiscencia.cometia.es/';
  if (typeof song.audio !== 'string') return null;
  if (song.audio.startsWith('http')) return song.audio;
  return base + song.audio.replace(/^\//, '');
}

async function downloadToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function decodeToPcm(buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1',
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

function sqlQuote(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[fingerprint-db] catálogo=${args.catalog} stride=${args.stride} maxPerHashSong=${args.maxOffsetsPerHashSong}`);
  const catalog = await fetchCatalog(args.catalog);
  let songs = catalog.filter((s) => typeof s?.id === 'string' && audioUrl(s));
  if (args.limit > 0) songs = songs.slice(0, args.limit);
  console.log(`[fingerprint-db] a procesar=${songs.length} de ${catalog.length}`);

  await mkdir(path.dirname(args.out), { recursive: true });
  // Transacción: hace las inserciones mucho más rápidas en SQLite/D1.
  const header = [
    '-- Huellas de la biblioteca (ADR-0048). Generado por scripts/recognize/generate_db.mjs.',
    '-- Aplicar con: npx --yes wrangler@4.151.3 d1 execute reminiscencia-recognize --remote --file=<este fichero>',
    'PRAGMA foreign_keys = OFF;',
    'DELETE FROM hashes;',
    'DELETE FROM songs;',
    '',
  ].join('\n');
  const chunks = [header];
  let totalHashRows = 0;
  let ok = 0, fail = 0;

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    const url = audioUrl(song);
    try {
      process.stdout.write(`[${i + 1}/${songs.length}] ${song.id} ${song.title ?? ''} — ${song.artist ?? ''}… `);
      const audio = await downloadToBuffer(url);
      const pcm = await decodeToPcm(audio);
      const samples = pcm16leToFloat32(pcm);
      const raw = fingerprintSamples(samples);
      // Poda: subsample por stride y cap de offsets por (hash, song).
      const kept = [];
      const seen = new Map(); // hash → count
      for (let j = 0; j < raw.length; j += args.stride) {
        const h = raw[j];
        const c = seen.get(h.hash) ?? 0;
        if (c >= args.maxOffsetsPerHashSong) continue;
        seen.set(h.hash, c + 1);
        kept.push(h);
      }
      // Fila de la canción.
      chunks.push(`INSERT INTO songs(id, title, artist) VALUES(${sqlQuote(song.id)}, ${sqlQuote(song.title ?? '')}, ${sqlQuote(song.artist ?? '')});`);
      // Filas de hashes en lotes de args.chunkRows por INSERT.
      for (let s = 0; s < kept.length; s += args.chunkRows) {
        const slice = kept.slice(s, s + args.chunkRows);
        const values = slice.map((h) => `(${h.hash},${sqlQuote(song.id)},${h.offset})`).join(',');
        chunks.push(`INSERT INTO hashes(hash, song_id, offset) VALUES ${values};`);
      }
      totalHashRows += kept.length;
      ok++;
      process.stdout.write(`OK (bruto=${raw.length}, guardado=${kept.length})\n`);
    } catch (e) {
      fail++;
      process.stdout.write(`FALLO (${e.message ?? e})\n`);
    }
  }

  await writeFile(args.out, chunks.join('\n') + '\n');
  console.log(`[fingerprint-db] canciones OK=${ok} fallidas=${fail}`);
  console.log(`[fingerprint-db] filas de hashes=${totalHashRows}`);
  console.log(`[fingerprint-db] SQL escrito en ${args.out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
