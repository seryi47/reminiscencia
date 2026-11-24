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

describe('dos subidas de la misma canción → autoaceptar (sin dar trabajo al usuario)', () => {
  test('dos oficiales casi idénticos: se acepta con confianza alta y el otro queda como alternativa', () => {
    // Son la MISMA canción subida dos veces (vídeo oficial + lyric/VEVO). Escoger cualquiera es correcto, así que no
    // tiene sentido mandarlo a «revisar»: se autoacepta y la otra subida queda disponible por si se quiere cambiar.
    // Con el bonus de señales oficiales (ADR-0044 ampliado 2026-11-23), el que lo diga explícitamente en el título
    // («Official Video») sube por delante — también es correcto, es la misma grabación.
    const clocks = track('Clocks', ['Coldplay'], 307000);
    const result = classifyMatch(clocks, [
      cand('a', 'Clocks - Coldplay', 'Coldplay', 307, 'official'),
      cand('b', 'Clocks (Official Video) - Coldplay', 'ColdplayVEVO', 308, 'official'),
    ]);
    assert.equal(result.tier, 'alta');
    assert.ok(result.best.candidate.id === 'a' || result.best.candidate.id === 'b', `cualquiera vale: ${result.best.candidate.id}`);
    assert.ok(result.alternatives.length >= 1, 'la otra subida sigue disponible como alternativa');
  });
});

describe('tolerancia de duración realista (el patrón «Mala Mujer»)', () => {
  test('una diferencia de 3 s entre Spotify y el vídeo oficial sigue siendo confianza alta', () => {
    // Spotify da 223 s para «Mala Mujer» (C. Tangana); el vídeo oficial dura 220 s. Esos 3 s de diferencia (intro,
    // silencio final) son rutinarios y NO deben degradar la coincidencia: es la misma grabación.
    const mala = track('Mala Mujer', ['C. Tangana'], 223000);
    const result = classifyMatch(mala, [
      cand('oficial', 'C. Tangana - Mala Mujer (Video Oficial)', 'C. Tangana', 220, 'official'),
      cand('remix', 'Mala Mujer (Remix) - C. Tangana', 'C. Tangana', 232, 'search'),
      cand('directo', 'Mala Mujer (En Directo) - C. Tangana', 'C. Tangana', 240, 'search'),
    ]);
    assert.equal(result.tier, 'alta');
    assert.equal(result.best.candidate.id, 'oficial');
    const byId = Object.fromEntries(result.ranked.map((r) => [r.candidate.id, r.score]));
    assert.ok(byId.oficial > byId.remix, 'el remix puntúa menos (otra versión)');
    assert.ok(byId.oficial > byId.directo, 'el directo puntúa menos (otra versión)');
  });

  test('un resultado de búsqueda normal (no oficial) con 5 s de diferencia también se autoacepta', () => {
    // No depende de que la fuente sea oficial: la clave es que título, artista, versión y duración (±8 s) cuadren.
    const song = track('Bohemian Rhapsody', ['Queen'], 355000);
    const result = classifyMatch(song, [
      cand('x', 'Queen - Bohemian Rhapsody', 'Some Music Channel', 350, 'search'),
    ]);
    assert.equal(result.tier, 'alta');
    assert.equal(result.best.candidate.id, 'x');
  });

  test('una diferencia grande (>15 s) sin más candidatos cae a revisión, no a autoaceptar', () => {
    const song = track('Song', ['Artist'], 200000);
    const result = classifyMatch(song, [
      cand('largo', 'Song - Artist', 'Artist', 240, 'search'), // 40 s: casi seguro otra versión
    ]);
    assert.notEqual(result.tier, 'alta');
  });
});

describe('puerta de artista (no autoaceptar otro artista, pero preseleccionar para revisar)', () => {
  test('título y duración exactos pero OTRO artista (no oficial) → media con el candidato preseleccionado', () => {
    // Antes mandaba la pista a «baja» sin candidato, obligando al usuario a buscarla a mano por cada desajuste de
    // nombre (p. ej. tildes/apostrofes/localizaciones). Ahora se preseleccionala mejor y queda como «media» para que
    // el usuario confirme con un clic. Seguimos SIN autoaceptar (no es «alta»).
    const song = track('Perfect', ['Ed Sheeran'], 263000);
    const result = classifyMatch(song, [cand('x', 'Perfect', 'Random Covers Channel', 263, 'search')]);
    assert.equal(result.tier, 'media');
    assert.equal(result.best.candidate.id, 'x');
  });
  test('el mismo caso con fuente oficial (Topic) sí se autoacepta', () => {
    const song = track('Perfect', ['Ed Sheeran'], 263000);
    const result = classifyMatch(song, [cand('ok', 'Perfect', 'Ed Sheeran', 263, 'topic')]);
    assert.equal(result.best.candidate.id, 'ok');
    assert.equal(result.tier, 'alta');
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

describe('exclusión dura de versiones no pedidas (ADR-0044 ampliado 2026-11-23)', () => {
  // Si Spotify pide la grabación de estudio, un directo/remix/cover/karaoke/nightcore no puede ganar aunque sea el
  // único candidato: queda muy por debajo del tier «alta»/«media» y la pista entra como «baja» (revisión manual).
  // El candidato excluido SÍ sigue en la lista de alternativas, por si el usuario de verdad quiere esa versión.
  const studio = track('Orgullo Banderillero', ['SFDK'], 268000);

  test('solo hay directos → pista en baja con los directos como alternativas', () => {
    const result = classifyMatch(studio, [
      cand('a', 'SFDK - Orgullo Banderillero (En Directo)', 'SFDK', 272, 'official'),
      cand('b', 'SFDK - Orgullo Banderillero (Live)', 'SFDK', 275, 'search'),
      cand('c', 'SFDK - Orgullo Banderillero (En Concierto 2024)', 'SFDK', 280, 'search'),
    ]);
    assert.equal(result.tier, 'baja');
    assert.equal(result.best, null);
    assert.equal(result.alternatives.length, 3, 'siguen disponibles para elegir a mano');
  });

  test('con un directo y un estudio, gana el estudio aunque el directo venga antes', () => {
    const result = classifyMatch(studio, [
      cand('live', 'SFDK - Orgullo Banderillero (Live at Mad Cool)', 'SFDK', 275, 'official'),
      cand('studio', 'SFDK - Orgullo Banderillero', 'SFDK', 268, 'search'),
    ]);
    assert.equal(result.tier, 'alta');
    assert.equal(result.best.candidate.id, 'studio');
  });

  test('cover, karaoke, nightcore y 8D no ganan al estudio', () => {
    const ranked = rankCandidates(studio, [
      cand('studio', 'Orgullo Banderillero', 'SFDK', 268, 'search'),
      cand('cover', 'Orgullo Banderillero (Piano Cover)', 'OtrosArtistas', 270, 'search'),
      cand('kar', 'Orgullo Banderillero (Karaoke Version)', 'Sing King', 269, 'search'),
      cand('ncore', 'Orgullo Banderillero [Nightcore]', 'Nightcore Channel', 220, 'search'),
      cand('8d', 'Orgullo Banderillero (8D Audio)', '8D Music', 272, 'search'),
    ]);
    assert.equal(ranked[0].candidate.id, 'studio');
    for (const r of ranked.slice(1)) {
      assert.ok(r.score < THRESHOLDS_MEDIUM, `${r.candidate.id} debería estar por debajo de mediumFloor (${r.score})`);
    }
  });

  test('si la pista de Spotify ES un directo, el candidato en directo NO queda excluido', () => {
    const liveTrack = track('Song (Live at Wembley)', ['Band'], 300000);
    const result = classifyMatch(liveTrack, [
      cand('live', 'Band - Song (Live at Wembley)', 'Band', 302, 'official'),
    ]);
    assert.equal(result.tier, 'alta');
  });
});

describe('señales de estudio en el título del candidato', () => {
  test('«Official Audio» gana a «(Live)» aunque la duración sea similar', () => {
    const song = track('Nos Volveremos a Ver', ['La Raíz'], 285000);
    const ranked = rankCandidates(song, [
      cand('live', 'La Raíz - Nos Volveremos a Ver (En Directo desde Zaragoza)', 'La Raíz', 288, 'official'),
      cand('oa', 'La Raíz - Nos Volveremos a Ver (Official Audio)', 'La Raíz', 285, 'search'),
      cand('lyr', 'La Raíz - Nos Volveremos a Ver (Lyric Video)', 'La Raíz', 284, 'search'),
    ]);
    assert.equal(ranked[0].candidate.id, 'oa');
    assert.ok(ranked[1].candidate.id === 'lyr', 'tras «Official Audio», el lyric video queda segundo');
    assert.ok(ranked.find((r) => r.candidate.id === 'live').score < ranked[0].score);
  });
});

describe('señales oficiales NO son promiscuas (findings auditoría 2026-11-24)', () => {
  test('«Lyrics Compilation» NO activa el bonus lyricsVideo (era un falso positivo grave)', () => {
    // Antes: /\blyrics\b/ matcheaba cualquier «Lyrics» suelto → compilación recibía +12 pts → tier=alta.
    const song = track('Rolling in the Deep', ['Adele'], 228000);
    const result = classifyMatch(song, [
      cand('comp', 'Rolling in the Deep - Adele Lyrics Compilation', 'TopLyrics Channel', 230, 'search'),
    ]);
    assert.notEqual(result.tier, 'alta', 'una compilación con «Lyrics» no debe autoaceptarse');
  });

  test('«Music Video» suelto (sin «official») NO activa officialVideo bonus', () => {
    // Antes: /\bmusic video\b/ pasaba cualquier «New Music Video Trailer» como oficial.
    const song = track('Yesterday', ['The Beatles'], 125000);
    const ranked = rankCandidates(song, [
      cand('fan', 'Yesterday - Her New Music Video 2024', 'FanChannel', 130, 'search'),
      cand('real', 'Yesterday - The Beatles (Official Audio)', 'The Beatles', 125, 'topic'),
    ]);
    assert.equal(ranked[0].candidate.id, 'real', 'el real gana al fan video sin bonus trampa');
  });

  test('«Lyric Video» (con la palabra «video») SÍ activa lyricsVideo bonus (comprueba que no rompimos el bueno)', () => {
    const song = track('Nos Volveremos a Ver', ['La Raíz'], 285000);
    const ranked = rankCandidates(song, [
      cand('normal', 'Nos Volveremos a Ver - La Raíz', 'La Raíz', 285, 'search'),
      cand('lyric', 'Nos Volveremos a Ver - La Raíz (Lyric Video)', 'La Raíz', 285, 'search'),
    ]);
    assert.equal(ranked[0].candidate.id, 'lyric', 'el Lyric Video sigue siendo preferido sobre el normal');
  });
});

describe('duración incompatible = no es la canción', () => {
  test('fragmento de 45 s (teaser) de una canción de 3:30 no gana', () => {
    const song = track('Una Canción Larga', ['Artista'], 210000);
    const result = classifyMatch(song, [
      cand('teaser', 'Una Canción Larga - Artista (preview 45s)', 'Artista', 45, 'search'),
      cand('full', 'Una Canción Larga - Artista', 'Artista', 210, 'search'),
    ]);
    assert.equal(result.best.candidate.id, 'full');
  });

  test('compilación de 1 hora de una canción de 3:30 no gana aunque mencione el título', () => {
    const song = track('La Canción', ['El Grupo'], 210000);
    const result = classifyMatch(song, [
      cand('comp', 'El Grupo - Todos Sus Éxitos (Mix 1 Hora, incluye La Canción)', 'El Grupo', 3600, 'search'),
      cand('normal', 'La Canción - El Grupo', 'El Grupo', 210, 'search'),
    ]);
    assert.equal(result.best.candidate.id, 'normal');
  });
});

// Constante auxiliar para asertar que los excluidos quedan por debajo de medium.
const THRESHOLDS_MEDIUM = 45;
