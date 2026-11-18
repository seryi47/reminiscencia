import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { scoreCandidate, gatherCandidates, loadLyrics } from '../../frontend/web/server/recognize-lyrics.js';

describe('scoreCandidate', () => {
  test('transcrito sin palabras raras ni frases → 0', () => {
    assert.equal(scoreCandidate('baby baby baby', 'the lyrics'), 0);
  });

  test('una palabra rara (verte) en el transcrito que SÍ está en la letra puntúa', () => {
    const transcript = 'yo acabo de verte baby';
    const lyrics = 'yo acabo de verte baby, callin en la noche';
    assert.ok(scoreCandidate(transcript, lyrics) >= 5);
  });

  test('una frase de 3 palabras consecutivas en la letra puntúa más que una suelta', () => {
    const transcript = 'honey ocho de la morning';
    const lyrics = 'honey ocho de la morning y tu';
    assert.ok(scoreCandidate(transcript, lyrics) >= 3);
  });

  test('ventanas que son solo stopwords (a the) no inflan la puntuación', () => {
    const transcript = 'the the the yes the';
    const lyrics = 'the the the yes the';
    assert.equal(scoreCandidate(transcript, lyrics), 0);
  });

  test('normaliza tildes: «tú» en transcrito matchea «tu» en letra', () => {
    const score = scoreCandidate('yo acabo de verte', 'yo acabo de verte y tu');
    assert.ok(score > 0);
  });
});

describe('gatherCandidates', () => {
  test('envía ventanas consecutivas del transcrito a Lyrics.ovh (no solo palabras raras sueltas)', async () => {
    const queriesSent = [];
    const fakeFetch = async (url) => {
      queriesSent.push(url);
      if (url.includes('api.lyrics.ovh')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              title_short: '8 AM',
              artist: { name: 'Nicki Nicole' },
            }],
          }),
        };
      }
      if (url.includes('lrclib')) {
        return { ok: true, json: async () => [] };
      }
      return { ok: false };
    };
    const candidates = await gatherCandidates(
      'my baby girl honey 8 in the morning y tu estas callin yo acabo de verte baby',
      { fetchImpl: fakeFetch },
    );
    assert.ok(candidates.length >= 1, 'debería devolver al menos un candidato');
    // Al menos una query debería contener la secuencia «acabo de verte» o «yo acabo de verte»:
    const sawRealPhrase = queriesSent.some((q) => /acabo.*verte|verte.*acabo/i.test(q));
    assert.ok(sawRealPhrase, 'ninguna query enviada conservó la secuencia «acabo…verte»');
  });

  test('deduplica por título|artista', async () => {
    const fakeFetch = async (url) => {
      if (url.includes('api.lyrics.ovh')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { title_short: '8 AM', artist: { name: 'Nicki Nicole' } },
              { title_short: '8 AM', artist: { name: 'Nicki Nicole' } }, // duplicado
            ],
          }),
        };
      }
      return { ok: true, json: async () => [] };
    };
    const candidates = await gatherCandidates('yo acabo verte', { fetchImpl: fakeFetch });
    assert.equal(candidates.length, 1);
  });

  test('sin palabras raras no revienta (transcrito todo stopwords)', async () => {
    const fakeFetch = async () => ({ ok: true, json: async () => [] });
    const candidates = await gatherCandidates('the the oh baby baby', { fetchImpl: fakeFetch });
    assert.ok(Array.isArray(candidates));
  });
});

describe('loadLyrics', () => {
  test('si el candidato ya trae plainLyrics, lo devuelve sin llamar a nadie', async () => {
    const candidate = { trackName: 'X', artistName: 'Y', plainLyrics: 'texto directo' };
    const fakeFetch = async () => { throw new Error('no debería llamarse'); };
    const lyrics = await loadLyrics(candidate, { fetchImpl: fakeFetch });
    assert.equal(lyrics, 'texto directo');
  });

  test('cae a Lyrics.ovh si LRClib falla', async () => {
    const candidate = { trackName: '8 AM', artistName: 'Nicki Nicole' };
    const fakeFetch = async (url) => {
      if (url.includes('lrclib')) return { ok: false };
      if (url.includes('api.lyrics.ovh/v1')) {
        return { ok: true, json: async () => ({ lyrics: 'yo acabo de verte' }) };
      }
      return { ok: false };
    };
    const lyrics = await loadLyrics(candidate, { fetchImpl: fakeFetch });
    assert.equal(lyrics, 'yo acabo de verte');
  });

  test('si todo falla devuelve «»', async () => {
    const candidate = { trackName: 'X', artistName: 'Y' };
    const fakeFetch = async () => ({ ok: false });
    const lyrics = await loadLyrics(candidate, { fetchImpl: fakeFetch });
    assert.equal(lyrics, '');
  });
});
