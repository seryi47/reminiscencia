// Contrato común de las peticiones de la biblioteca (ADR-0028): la web (js/cuidador/incidencias.js y api/editar.js) da
// exactamente los resultados de tests/contrato/peticiones.json, que ejecutan también el backend (la referencia) y la APK.
// Ejecución: node --test tests/web-unit/contrato-peticiones.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  buildIssueBody,
  isCoverFolderId,
  isFolderId,
  isSongId,
  operationIssue,
  REQUEST_LIMITS,
  stripLikeBackend,
} from '../../frontend/web/js/cuidador/incidencias.js';
import { ALLOWED_OPS, organizeProblem } from '../../frontend/web/api/editar.js';

const CONTRATO = JSON.parse(readFileSync(new URL('../contrato/peticiones.json', import.meta.url), 'utf8'));
const WEB = CONTRATO.operaciones.filter((caso) => caso.web === 'aplica');

describe('contrato común de peticiones: límites, espacios e ids', () => {
  test('los límites son los del contrato', () => {
    const limites = CONTRATO.limites;
    assert.deepEqual(
      {
        peticion: REQUEST_LIMITS.request,
        payload: REQUEST_LIMITS.payload,
        url: REQUEST_LIMITS.url,
        licencia: REQUEST_LIMITS.license,
        nombre_album: REQUEST_LIMITS.folderName,
        artista_album: REQUEST_LIMITS.folderArtist,
        titulo_cancion: REQUEST_LIMITS.title,
        artista_cancion: REQUEST_LIMITS.artist,
        etiquetas: REQUEST_LIMITS.tags,
        etiqueta: REQUEST_LIMITS.tag,
        anio_min: REQUEST_LIMITS.yearMin,
        anio_max: REQUEST_LIMITS.yearMax,
        move_songs: REQUEST_LIMITS.moveSongs,
        order_album: REQUEST_LIMITS.orderSongs,
        clean_titles: REQUEST_LIMITS.cleanTitles,
        titulo_incidencia: REQUEST_LIMITS.issueTitle,
      },
      // La web no genera organize_youtube_playlist.
      Object.fromEntries(Object.entries(limites).filter(([key]) => key !== 'canciones_playlist_youtube')),
    );
  });

  test('se quitan a los lados los mismos espacios que en el backend, y solo esos', () => {
    const spaces = new Set(CONTRATO.espacios.map((code) => String.fromCodePoint(Number.parseInt(code.slice(2), 16))));
    for (let code = 0; code <= 0x3000; code += 1) {
      const char = String.fromCodePoint(code);
      const expected = spaces.has(char) ? 'x' : `${char}x${char}`;
      assert.equal(stripLikeBackend(`${char}x${char}`), expected, `U+${code.toString(16)}`);
    }
    assert.equal(stripLikeBackend('﻿x'), '﻿x');
  });

  test('ids de canción, de álbum y de portada', () => {
    for (const [value, valid] of CONTRATO.ids.cancion) assert.equal(isSongId(value), valid, value);
    for (const [value, valid] of CONTRATO.ids.album) assert.equal(isFolderId(value), valid, value);
    for (const [value, valid] of CONTRATO.ids.portada) assert.equal(isSongId(value) || isCoverFolderId(value), valid, value);
  });

  test('/api/editar admite las operaciones del contrato', () => {
    assert.deepEqual([...ALLOWED_OPS].sort(), CONTRATO.operaciones_api_editar);
  });
});

describe('contrato común de peticiones: operaciones', () => {
  test('los casos que no aplican a la web son solo los de organize_youtube_playlist', () => {
    const fuera = CONTRATO.operaciones.filter((caso) => caso.web !== 'aplica');
    assert.ok(fuera.length > 0);
    for (const caso of fuera) {
      assert.equal(caso.web, 'no_aplica', caso.caso);
      assert.equal(caso.payload.op, 'organize_youtube_playlist', caso.caso);
    }
  });

  for (const caso of WEB) {
    test(caso.caso, () => {
      const problem = operationIssue(caso.payload);
      const request = { action: 'organize', payload: caso.payload };
      if (caso.valido) {
        assert.equal(problem, null);
        // El cuerpo de la incidencia, carácter a carácter (el backend lo acepta: test_contrato_peticiones.py).
        assert.equal(buildIssueBody(request), caso.cuerpo);
        assert.equal(organizeProblem(request) === null, caso.api_editar, 'api/editar');
      } else {
        assert.deepEqual(problem && { code: problem.code, field: problem.field }, { code: caso.motivo, field: caso.campo ?? null });
        assert.equal(typeof problem.message, 'string');
        assert.throws(() => buildIssueBody(request));
        assert.notEqual(organizeProblem(request), null, 'api/editar');
      }
    });
  }
});
