// Set de pruebas «dorado» del motor de identificación de «Transferir música» (ADR-0044). Fija el comportamiento del
// matcher: qué candidato de YouTube gana para una pista de Spotify y con qué nivel de confianza. Es donde se gana o se
// pierde la precisión (covers, directos, remezclas, instrumentales, tributos, colisiones de título, acentos, feat.).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  classifyMatch, scoreCandidate, rankCandidates, detectVersions, coreTitleTokens,
} from '../../frontend/web/server/spotify-match.js';

const track = (title, artists, durationMs, extra = {}) => ({ title, artists, durationMs, ...extra });
const cand = (id, title, artist, durationS, source = 'search', extra = {}) =>
  ({ id, url: `https://youtu.be/${id}`, title, artist, durationS, source, ...extra });

describe('coreTitleTokens / detectVersions', () => {
  test('el núcleo del título quita ruido, versión y la cola de feat', () => {
    assert.deepEqual(coreTitleTokens('The Scientist - Coldplay (Official Video)'), ['the', 'scientist', 'coldplay']);
    assert.deepEqual(coreTitleTokens('Loyal (Official Video) ft. Lil Wayne, Tyga'), ['loyal']);
    assert.deepEqual(coreTitleTokens('Wish You Were Here (Live)'), ['wish', 'you', 'were', 'here']);
  });
  test('detecta la categoría de versión', () => {
    assert.ok(detectVersions('Song (Live at Wembley)').has('live'));
    assert.ok(detectVersions('Song - Acoustic').has('acoustic'));
    assert.ok(detectVersions('Song (XYZ Remix)').has('remix'));
    assert.ok(detectVersions('Song - Karaoke Version').has('instrumental'));
    assert.ok(detectVersions('Song (Piano Cover)').has('cover'));
    assert.ok(detectVersions('Song [8D Audio]').has('altered'));
    // «Remastered» NO es una versión distinta (misma grabación).
    assert.equal(detectVersions('Song (2011 Remastered)').size, 0);
  });
});

describe('The Scientist (el ejemplo del encargo)', () => {
  const scientist = track('The Scientist', ['Coldplay'], 309000, { album: 'A Rush of Blood to the Head' });
  const candidates = [
    cand('v1', 'The Scientist - Coldplay (Official Video)', 'Coldplay', 309, 'official'),
    cand('v2', 'The Scientist (Live at Glastonbury)', 'Coldplay', 345),
    cand('v3', 'The Scientist - Piano Cover', 'Piano Tribute Players', 300),
    cand('v4', 'The Scientist - Coldplay (Remastered)', 'Coldplay', 309),
    cand('v5', 'The Scientist - Various Artists Tribute', 'Various Artists', 310),
  ];

  test('elige el oficial de estudio con confianza alta', () => {
    const result = classifyMatch(scientist, candidates);
    assert.equal(result.tier, 'alta');
    assert.equal(result.best.candidate.id, 'v1');
  });

  test('descarta directo, cover de otro artista y tributo', () => {
    const ranked = rankCandidates(scientist, candidates);
    const top = ranked[0].candidate.id;
    assert.equal(top, 'v1');
    const byId = Object.fromEntries(ranked.map((r) => [r.candidate.id, r.score]));
    assert.ok(byId.v2 < byId.v1, 'el directo puntúa menos');
    assert.ok(byId.v3 < byId.v1, 'el cover puntúa menos');
    assert.ok(byId.v5 < byId.v1, 'el tributo puntúa menos');
    // El remaster es la misma grabación: válido, pero el oficial gana por fuente.
    assert.ok(byId.v4 < byId.v1 && byId.v4 > byId.v2);
  });
});

describe('no inventar cuando no hay buena coincidencia', () => {
  test('si solo hay tributo y karaoke de otros, confianza baja y nada seleccionado', () => {
    const yesterday = track('Yesterday', ['The Beatles'], 125000);
    const result = classifyMatch(yesterday, [
      cand('a', 'Yesterday (Tribute to The Beatles)', 'Vitamin String Quartet', 125),
      cand('b', 'Yesterday - Karaoke Version', 'Sing King Karaoke', 126),
    ]);
    assert.equal(result.tier, 'baja');
    assert.equal(result.best, null);
  });

  test('sin candidatos, confianza baja', () => {
    const result = classifyMatch(track('X', ['Y'], 200000), []);
    assert.equal(result.tier, 'baja');
    assert.equal(result.best, null);
  });
});

describe('respeta el tipo de versión que pide Spotify', () => {
  test('si la pista de Spotify es en directo, elige el directo, no el estudio', () => {
    const live = track('Wish You Were Here - Live', ['Pink Floyd'], 300000);
    const result = classifyMatch(live, [
      cand('live', 'Wish You Were Here (Live) - Pink Floyd', 'Pink Floyd', 300, 'official'),
      cand('studio', 'Wish You Were Here - Pink Floyd', 'Pink Floyd', 334, 'search'),
    ]);
    assert.equal(result.best.candidate.id, 'live');
    assert.equal(result.tier, 'alta');
  });

  test('si la pista es instrumental, elige el instrumental, no el vocal', () => {
    const instrumental = track('Comfortably Numb - Instrumental', ['Pink Floyd'], 200000);
    const result = classifyMatch(instrumental, [
      cand('inst', 'Comfortably Numb (Instrumental)', 'Pink Floyd', 200),
      cand('voc', 'Comfortably Numb - Pink Floyd', 'Pink Floyd', 201, 'official'),
    ]);
    assert.equal(result.best.candidate.id, 'inst');
  });

  test('si la pista es un remix, elige el remix, no el original', () => {
    const remix = track('One More Time (Remix)', ['Daft Punk'], 200000);
    const result = classifyMatch(remix, [
      cand('rmx', 'One More Time (Remix) - Daft Punk', 'Daft Punk', 200),
      cand('orig', 'One More Time - Daft Punk', 'Daft Punk', 320, 'official'),
    ]);
    assert.equal(result.best.candidate.id, 'rmx');
  });
});

describe('duración y colisiones de título', () => {
  test('la duración desempata un título que es subcadena / demo', () => {
    const scientist = track('The Scientist', ['Coldplay'], 309000);
    const result = classifyMatch(scientist, [
      cand('demo', 'The Scientist (Demo)', 'Coldplay', 180),
      cand('ok', 'The Scientist', 'Coldplay', 309, 'official'),
    ]);
    assert.equal(result.best.candidate.id, 'ok');
    assert.equal(result.tier, 'alta');
  });
});

describe('acentos y feat', () => {
  test('pliega acentos al comparar (Corazón Partío)', () => {
    const song = track('Corazón Partío', ['Alejandro Sanz'], 280000);
    const result = classifyMatch(song, [
      cand('ok', 'Corazón Partío - Alejandro Sanz', 'Alejandro Sanz', 280, 'official'),
      cand('kar', 'Corazon Partio (Karaoke)', 'Sing King', 281),
    ]);
    assert.equal(result.best.candidate.id, 'ok');
    assert.equal(result.tier, 'alta');
  });

  test('las colaboraciones (feat.) no estorban al núcleo del título', () => {
    const loyal = track('Loyal', ['Chris Brown', 'Lil Wayne', 'Tyga'], 270000);
    const result = classifyMatch(loyal, [
      cand('ok', 'Chris Brown - Loyal (Official Video) ft. Lil Wayne, Tyga', 'ChrisBrownVEVO', 270, 'official'),
    ]);
    assert.equal(result.best.candidate.id, 'ok');
    assert.equal(result.tier, 'alta');
  });
});

describe('ambigüedad → el usuario elige', () => {
  test('dos oficiales casi idénticos dan confianza media con alternativas', () => {
    const clocks = track('Clocks', ['Coldplay'], 307000);
    const result = classifyMatch(clocks, [
      cand('a', 'Clocks - Coldplay', 'Coldplay', 307, 'official'),
      cand('b', 'Clocks (Official Video) - Coldplay', 'ColdplayVEVO', 308, 'official'),
    ]);
    assert.equal(result.tier, 'media');
    assert.ok(result.alternatives.length >= 2);
  });
});

describe('puerta de artista (no autoaceptar otro artista)', () => {
  test('título y duración exactos pero OTRO artista (no oficial) → baja, nada autoseleccionado', () => {
    const song = track('Perfect', ['Ed Sheeran'], 263000);
    const result = classifyMatch(song, [cand('x', 'Perfect', 'Random Covers Channel', 263, 'search')]);
    assert.equal(result.tier, 'baja');
    assert.equal(result.best, null);
  });
  test('el mismo caso con fuente oficial (Topic) sí se acepta', () => {
    const song = track('Perfect', ['Ed Sheeran'], 263000);
    const result = classifyMatch(song, [cand('ok', 'Perfect', 'Ed Sheeran', 263, 'topic')]);
    assert.equal(result.best.candidate.id, 'ok');
    assert.notEqual(result.tier, 'baja');
  });
});

describe('ISRC decisivo', () => {
  test('un ISRC igual gana aunque el título difiera y la duración no cuadre', () => {
    const song = track('Título Oficial', ['Artista'], 200000, { isrc: 'USABC1234567' });
    const result = classifyMatch(song, [
      cand('isrc', 'Otro título distinto del catálogo', 'Topic', 260, 'search', { isrc: 'usabc1234567' }),
      cand('otro', 'Título Oficial - Artista', 'Artista', 200, 'official'),
    ]);
    assert.equal(result.best.candidate.id, 'isrc');
    assert.equal(result.tier, 'alta');
  });
});

describe('fuente oficial como desempate', () => {
  test('a igualdad de metadatos, «Topic» gana a un resultado de búsqueda', () => {
    const song = track('Song Name', ['Artist Name'], 200000);
    const result = rankCandidates(song, [
      cand('search', 'Song Name - Artist Name', 'Artist Name', 200, 'search'),
      cand('topic', 'Song Name - Artist Name', 'Artist Name - Topic', 200, 'topic'),
    ]);
    assert.equal(result[0].candidate.id, 'topic');
  });
});
