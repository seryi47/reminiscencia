// Pruebas del resolver (ADR-0044): colección de Spotify → coincidencias de YouTube con nivel de confianza, en orden y
// con concurrencia. `searchYoutube` simulado.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveCollection, reresolveTrack, albumOf } from '../../frontend/web/server/spotify-resolve.js';

const track = (title, artist, durationMs) => ({ title, artists: [artist], album: 'Álbum', durationMs });
const cand = (id, title, artist, durationS, source = 'search') =>
  ({ id, url: `https://youtu.be/${id}`, title, artist, durationS, source });

const collection = {
  type: 'playlist', id: 'PL1', name: 'Mi lista', cover: 'p.jpg', artist: null,
  tracks: [
    track('The Scientist', 'Coldplay', 309000),
    track('Clocks', 'Coldplay', 307000),
    track('Nada Encaja', 'Desconocido', 200000),
  ],
};

// Simula la búsqueda de YouTube según la consulta.
const searchYoutube = async (query) => {
  if (query.includes('The Scientist')) {
    return [cand('ok', 'The Scientist - Coldplay (Official Video)', 'Coldplay', 309, 'official'),
      cand('live', 'The Scientist (Live)', 'Coldplay', 345)];
  }
  if (query.includes('Clocks')) {
    return [cand('a', 'Clocks - Coldplay', 'Coldplay', 307, 'official'),
      cand('b', 'Clocks (Official Video) - Coldplay', 'ColdplayVEVO', 308, 'official')];
  }
  return [cand('x', 'Otra cosa totalmente distinta', 'Otro', 123)]; // nada encaja
};

describe('resolveCollection', () => {
  test('resuelve en orden, con tier por pista y resumen', async () => {
    const result = await resolveCollection(collection, { searchYoutube });
    assert.equal(result.type, 'playlist');
    assert.deepEqual(result.album, { id: 'spotify_playlist_PL1', name: 'Mi lista', cover: 'p.jpg', artist: null });
    assert.deepEqual(result.results.map((r) => r.index), [0, 1, 2]); // orden conservado
    assert.equal(result.results[0].tier, 'alta');
    assert.equal(result.results[0].best.candidate.id, 'ok');
    assert.equal(result.results[1].tier, 'alta'); // dos subidas de la misma canción: se autoacepta
    assert.ok(['a', 'b'].includes(result.results[1].best.candidate.id)); // cualquiera vale, es la misma grabación
    assert.equal(result.results[2].tier, 'baja'); // nada encaja
    assert.equal(result.results[2].best, null);
    assert.deepEqual(result.summary, { total: 3, alta: 2, media: 0, baja: 1, error: 0 });
  });

  test('un fallo de búsqueda de una pista no tumba el resto', async () => {
    const flaky = async (query) => {
      if (query.includes('Clocks')) throw new Error('red caída');
      return searchYoutube(query);
    };
    const result = await resolveCollection(collection, { searchYoutube: flaky });
    assert.equal(result.results[1].tier, 'baja');
    assert.match(result.results[1].error, /red caída/);
    assert.equal(result.results[0].tier, 'alta'); // las demás siguen
    assert.equal(result.summary.error, 1);
  });

  test('exige colección y searchYoutube', async () => {
    await assert.rejects(() => resolveCollection(null, { searchYoutube }), /colección/);
    await assert.rejects(() => resolveCollection(collection, {}), /searchYoutube/);
  });

  test('una primera consulta floja se recupera con una segunda variante (ADR-0046)', async () => {
    // Artista localizado distinto en YouTube: la consulta «artista título» no encuentra nada bueno, pero la variante amplia
    // «solo título» sí. El resolver no debe dejar la pista en «baja».
    const col = { type: 'album', id: 'A', name: 'X', tracks: [track('Despacito', 'Luis Fonsi', 229000)] };
    const calls = [];
    const search = async (query) => {
      calls.push(query);
      if (query === 'Despacito') { // la variante amplia (solo título)
        return [cand('good', 'Despacito', 'Luis Fonsi', 229, 'official')];
      }
      return [cand('bad', 'Reacción a Despacito', 'Otro Canal', 500)]; // la primaria trae ruido
    };
    const result = await resolveCollection(col, { searchYoutube: search });
    assert.notEqual(result.results[0].tier, 'baja');
    assert.equal(result.results[0].best.candidate.id, 'good');
    // Las primeras variantes meten ruido → sigue probando. La variante solo-título es el último recurso.
    assert.ok(calls[0].endsWith('official audio'), `primera variante sesga a estudio: ${calls[0]}`);
    assert.ok(calls.includes('Despacito'), 'llega al título solo cuando las de arriba no bastan');
  });

  test('para en cuanto hay una coincidencia ALTA (no gasta consultas de más)', async () => {
    const col = { type: 'album', id: 'A', name: 'X', tracks: [track('The Scientist', 'Coldplay', 309000)] };
    const calls = [];
    const search = async (query) => {
      calls.push(query);
      return [cand('ok', 'The Scientist - Coldplay (Official Audio)', 'Coldplay', 309, 'official')];
    };
    const result = await resolveCollection(col, { searchYoutube: search });
    assert.equal(result.results[0].tier, 'alta');
    assert.equal(calls.length, 1, `con una coincidencia alta en la primera variante no se prueban más (calls=${calls.length})`);
  });

  test('si YouTube devuelve 0 en todas las variantes SIN error, reintenta con backoff (rate-limit silencioso)', async () => {
    // Replica el caso real del 2026-11-19: YouTube Music devolvía temporalmente 0 candidatos. El reintento
    // prueba TODAS las variantes cada vez. Con el cambio en el Worker (upstream primero, YT Music solo
    // fallback) 3 reintentos cortos (500/1500/4000 ms) bastan.
    const col = { type: 'album', id: 'A', name: 'X', tracks: [track('Rolling in the Deep', 'Adele', 228000)] };
    let n = 0;
    const search = async () => {
      n += 1;
      // Devuelve vacío durante los 2 primeros intentos; en el tercer intento rescata.
      return n <= 4 ? [] : [cand('ok', 'Rolling in the Deep', 'Adele', 229, 'topic')];
    };
    const result = await resolveCollection(col, { searchYoutube: search }, { maxQueries: 2 });
    assert.equal(result.results[0].tier, 'alta', 'el reintento lo rescata');
    assert.equal(result.results[0].best.candidate.id, 'ok');
    assert.ok(n >= 5, 'variantes + reintentos con backoff hasta encontrar');
  });

  test('tras los reintentos sin candidatos queda baja (no se queda colgado)', async () => {
    const col = { type: 'album', id: 'A', name: 'X', tracks: [track('X', 'Y', 200000)] };
    let n = 0;
    const search = async () => { n += 1; return []; };
    const result = await resolveCollection(col, { searchYoutube: search }, { maxQueries: 2 });
    assert.equal(result.results[0].tier, 'baja');
    // 2 variantes iniciales + 3 reintentos × 2 variantes = 8 llamadas máximas
    assert.ok(n >= 5 && n <= 10, `entre 5 y 10 intentos, se hicieron ${n}`);
  });

  test('cache de queries: una query repetida entre pistas solo llama al upstream una vez', async () => {
    // Dos pistas con la misma primera consulta (p.ej. mismo artista + título, mismo anchor): el upstream solo debería
    // recibirla una vez. Reduce la presión sobre YouTube Music y evita rate-limits en playlists donde el mismo artista
    // aparece varias veces.
    const col = { type: 'album', id: 'A', name: 'X', tracks: [
      track('Mismo', 'Artista', 200000),
      track('Mismo', 'Artista', 200000),
    ]};
    const calls = [];
    const search = async (query) => {
      calls.push(query);
      return [cand('a', 'Mismo', 'Artista', 200, 'topic')];
    };
    const result = await resolveCollection(col, { searchYoutube: search });
    assert.equal(result.results[0].tier, 'alta');
    assert.equal(result.results[1].tier, 'alta');
    // Solo 1 llamada al upstream porque la 2ª pista reusa la cache
    assert.equal(calls.length, 1, `cache debe reducir llamadas: hubo ${calls.length}`);
  });

  test('cache NO guarda resultados vacíos (un vacío transitorio no tapa el reintento)', async () => {
    const col = { type: 'album', id: 'A', name: 'X', tracks: [
      track('Mismo', 'Artista', 200000),
      track('Mismo', 'Artista', 200000),
    ]};
    let n = 0;
    const search = async () => {
      n += 1;
      // La primera llamada devuelve vacío (simula rate-limit); las siguientes sí encuentran
      return n === 1 ? [] : [cand('a', 'Mismo', 'Artista', 200, 'topic')];
    };
    const result = await resolveCollection(col, { searchYoutube: search });
    // Primera pista se rescata por reintento; segunda pista NO debería leer el vacío de la cache
    assert.equal(result.results[0].tier, 'alta', 'primera pista rescatada');
    assert.equal(result.results[1].tier, 'alta', 'segunda pista también alta (cache vacía no se guarda)');
  });

  test('si YouTube devuelve 0 Y error, NO se reintenta en bucle (queda baja con el error)', async () => {
    const col = { type: 'album', id: 'A', name: 'X', tracks: [track('X', 'Y', 200000)] };
    let n = 0;
    const search = async () => { n += 1; throw new Error('red caída'); };
    const result = await resolveCollection(col, { searchYoutube: search }, { maxQueries: 2 });
    assert.equal(result.results[0].tier, 'baja');
    assert.match(result.results[0].error, /red caída/);
    assert.equal(n, 2, 'solo las variantes, sin reintento extra cuando hubo error');
  });

  test('presupuesto agotado antes de empezar: queda tiempo-agotado, no se cuelga (ADR-0046 ampliado 2026-11-24)', async () => {
    // Replica el 503 del Worker del 2026-11-24: 25 pistas serializadas × backoffs + 8 s de último recurso
    // se pasaban de los 30 s de CPU y Cloudflare devolvía 503. El presupuesto corta a tiempo.
    const col = { type: 'album', id: 'A', name: 'X', tracks: [
      track('Primera', 'A', 200000),
      track('Segunda', 'B', 200000),
    ]};
    let n = 0;
    const search = async () => { n += 1; return []; }; // siempre vacío, dispara reintentos
    const result = await resolveCollection(col, { searchYoutube: search }, { budgetMs: 1500 });
    // Primera pista consume el presupuesto en backoffs; la segunda ya no puede reintentar.
    assert.equal(result.results[0].tier, 'baja');
    assert.equal(result.results[1].tier, 'baja');
    assert.match(result.results[1].error ?? '', /tiempo agotado/, 'la 2ª pista lleva error de presupuesto');
    assert.ok(n < 50, `sin presupuesto se recortan intentos: hubo ${n}`); // sin presupuesto subiría a cientos
  });

  test('presupuesto generoso NO recorta: el camino nominal sigue intacto', async () => {
    // Regresión defensiva: si el budget alcanza, el resolver se comporta como siempre (no se nota el cambio).
    const col = { type: 'album', id: 'A', name: 'X', tracks: [track('The Scientist', 'Coldplay', 309000)] };
    const result = await resolveCollection(col, { searchYoutube }, { budgetMs: 25000 });
    assert.equal(result.results[0].tier, 'alta');
  });

  test('acumula candidatos de varias variantes para ofrecer alternativas', async () => {
    // Ninguna variante da «alta», pero juntando ambas hay alternativas para el salto anti-truncado de la APK.
    const col = { type: 'album', id: 'A', name: 'X', tracks: [track('Tema', 'Grupo', 200000)] };
    // Dos variantes aportan candidatos distintos (official audio y la exacta) que se acumulan como alternativas.
    const search = async (query) => (/official audio/.test(query)
      ? [cand('v1', 'Tema', 'Grupo', 231)]
      : [cand('v2', 'Tema (Audio)', 'Grupo', 232)]);
    const result = await resolveCollection(col, { searchYoutube: search }, { maxQueries: 3 });
    const ids = [result.results[0].best?.candidate.id, ...result.results[0].alternatives.map((a) => a.candidate.id)];
    assert.ok(ids.includes('v1') && ids.includes('v2'), 'las dos variantes aportan candidatos');
  });
});

describe('albumOf', () => {
  test('playlist y álbum dan una carpeta; una canción suelta, no', () => {
    assert.equal(albumOf({ type: 'album', id: 'A1', name: 'X' }).id, 'spotify_album_A1');
    assert.equal(albumOf({ type: 'playlist', id: 'P1', name: 'Y' }).id, 'spotify_playlist_P1');
    assert.equal(albumOf({ type: 'track', id: 'T1' }), null);
  });
});

describe('reresolveTrack', () => {
  test('puntúa una lista nueva de candidatos (búsqueda manual)', () => {
    const match = reresolveTrack(track('The Scientist', 'Coldplay', 309000), [
      cand('ok', 'The Scientist - Coldplay', 'Coldplay', 309, 'official'),
    ]);
    assert.equal(match.best.candidate.id, 'ok');
  });
});
