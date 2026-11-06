// Pruebas de la migración de portadas al índice de R2 (scripts/migrar_portadas_r2.mjs; ADR-0029): solo las portadas que
// ya publica la web (nunca las de canciones privadas), por el Worker real (worker/src/index.js) con R2 simulado, sin
// pisar una portada más nueva del índice, simulación por defecto e idempotente.
// Ejecución: node --test tests/web-unit/migrar-portadas.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { expectedKey, migrate, planMigration, publishedCoverIds } from '../../scripts/migrar_portadas_r2.mjs';
import { handleRequest } from '../../worker/src/index.js';
import { COVER_INDEX_KEY, parseCoverIndex } from '../../frontend/web/js/cover-index.js';
import { fakeR2 } from './r2-falso.mjs';

const S1 = 'S0000000000000001';
const S2 = 'S0000000000000002';
const F1 = 'F0000000000000001';
const jpeg = (fill) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, fill, fill, 0xff, 0xd9]);

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'migrar-portadas-'));
  mkdirSync(join(root, 'frontend/web/data'), { recursive: true });
  mkdirSync(join(root, 'frontend/web/covers'), { recursive: true });
  mkdirSync(join(root, 'audio-library/covers'), { recursive: true });
  // S2 es privada: está en audio-library/covers pero no en data/songs.json.
  writeFileSync(join(root, 'frontend/web/data/songs.json'), JSON.stringify([
    { id: S1, title: 'Uno', audio: 'audio/x.opus', cover: `covers/${S1}.jpg` },
    { id: 'S0000000000000003', title: 'Tres', audio: 'audio/y.opus' },
  ]));
  writeFileSync(join(root, 'frontend/web/data/folders.json'), JSON.stringify([{ id: F1, name: 'A', cover: `covers/${F1}.jpg` }]));
  writeFileSync(join(root, `audio-library/covers/${S1}.jpg`), jpeg(1));
  writeFileSync(join(root, `audio-library/covers/${S2}.jpg`), jpeg(2));
  writeFileSync(join(root, `frontend/web/covers/${F1}.jpg`), jpeg(3));
  return root;
}

function workerFetch(publicBucket) {
  const env = { GITHUB_TOKEN: '', PRIVATE_BUCKET: fakeR2(), PUBLIC_BUCKET: publicBucket };
  return (url, init = {}) => handleRequest(new Request(url, init), env, { fetchImpl: () => { throw new Error('sin GitHub'); } });
}

describe('migración de portadas', () => {
  test('solo las portadas publicadas en la web, sin repetir', () => {
    assert.deepEqual(publishedCoverIds(
      [{ id: S1, cover: `covers/${S1}.jpg` }, { id: S2 }, { id: S1, cover: `covers/${S1}.jpg` }, { id: 'S0000000000000004', cover: `covers/${S1}.jpg` }],
      [{ id: F1, cover: `covers/${F1}.jpg` }],
    ), [S1, F1]);
  });

  test('el plan respeta lo que ya hay en el índice y descarta lo que no es un JPEG', () => {
    const covers = { [S1]: jpeg(1), [F1]: jpeg(3), S0000000000000005: new Uint8Array([1, 2, 3, 4, 5]) };
    const plan = planMigration({
      ids: [S1, F1, S2, 'S0000000000000005'],
      readCover: (id) => covers[id] ?? null,
      index: { [S1]: expectedKey(S1, jpeg(1)), [F1]: `portadas/${F1}-0123456789abcdef.jpg` },
    });
    assert.deepEqual(plan.map(({ id, action }) => [id, action]), [[S1, 'ya-esta'], [F1, 'otra-mas-nueva'], [S2, 'falta'], ['S0000000000000005', 'no-vale']]);
  });

  test('simulación por defecto: no sube nada', async () => {
    const bucket = fakeR2();
    const logs = [];
    const result = await migrate({ worker: 'https://w.example', root: repo(), fetchImpl: workerFetch(bucket), log: (line) => logs.push(line) });
    assert.deepEqual(result.plan.map(({ id, action }) => [id, action]), [[S1, 'subir'], [F1, 'subir']]);
    assert.equal(bucket.objects.size, 0);
    assert.match(logs.at(-1), /Simulación/);
  });

  test('--aplicar sube por el Worker, comprueba el índice, nunca la privada, y es idempotente', async () => {
    const bucket = fakeR2();
    const root = repo();
    const fetchImpl = workerFetch(bucket);
    const result = await migrate({ worker: 'https://w.example', apply: true, root, fetchImpl, log: () => {} });
    assert.deepEqual([result.uploaded, result.failed], [[S1, F1], []]);
    const index = parseCoverIndex(bucket.text(COVER_INDEX_KEY));
    assert.deepEqual(Object.fromEntries(index), { [S1]: expectedKey(S1, jpeg(1)), [F1]: expectedKey(F1, jpeg(3)) });
    assert.ok(![...bucket.objects.keys()].some((key) => key.includes(S2)), 'La portada de la canción privada no se sube.');
    const again = await migrate({ worker: 'https://w.example', apply: true, root, fetchImpl, log: () => {} });
    assert.deepEqual(again.plan.map(({ action }) => action), ['ya-esta', 'ya-esta']);
    assert.deepEqual(again.uploaded, []);
  });

  test('no pisa una portada más nueva puesta desde la web', async () => {
    const bucket = fakeR2();
    const newer = `portadas/${S1}-0123456789abcdef.jpg`;
    bucket.seed(COVER_INDEX_KEY, JSON.stringify({ [S1]: newer }));
    await migrate({ worker: 'https://w.example', apply: true, root: repo(), fetchImpl: workerFetch(bucket), log: () => {} });
    assert.equal(parseCoverIndex(bucket.text(COVER_INDEX_KEY)).get(S1), newer);
  });
});
