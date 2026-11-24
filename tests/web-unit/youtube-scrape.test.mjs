// Pruebas de youtube-scrape (ADR-0038 ampliado 2026-11-24): segundo fallback del Worker cuando Vercel+Netlify caen.
// Comprobamos el parse de ytInitialData y la función searchYoutubeScrape con fetch simulado.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  parseClock, parseInitialData, extractVideos, searchYoutubeScrape, SCRAPE_MAX_RESULTS,
} from '../../frontend/web/server/youtube-scrape.js';

describe('parseClock', () => {
  test('acepta mm:ss y hh:mm:ss, rechaza lo demás', () => {
    assert.equal(parseClock('3:45'), 225);
    assert.equal(parseClock('1:02:03'), 3723);
    assert.equal(parseClock(''), null);
    assert.equal(parseClock('EN DIRECTO'), null);
    assert.equal(parseClock('3:4a'), null);
  });
});

describe('parseInitialData', () => {
  test('extrae el objeto {} de `var ytInitialData = {...};`', () => {
    const html = 'basura<script>var ytInitialData = {"a":1,"b":[1,2,3]};</script>mas';
    assert.deepEqual(parseInitialData(html), { a: 1, b: [1, 2, 3] });
  });
  test('acepta también `window["ytInitialData"] = {...};`', () => {
    const html = '<script>window["ytInitialData"] = {"c":"hola"};</script>';
    assert.deepEqual(parseInitialData(html), { c: 'hola' });
  });
  test('cuentas de llaves respetan strings y escapes', () => {
    const html = '<script>var ytInitialData = {"x":"}}","y":1};</script>';
    assert.deepEqual(parseInitialData(html), { x: '}}', y: 1 });
  });
  test('si no está, devuelve null', () => {
    assert.equal(parseInitialData('<html></html>'), null);
  });
});

describe('extractVideos', () => {
  const mkVideo = (id, title, channel, len) => ({
    videoRenderer: {
      videoId: id,
      title: { runs: [{ text: title }] },
      ownerText: { runs: [{ text: channel }] },
      lengthText: { simpleText: len },
    },
  });

  test('extrae videoRenderer válidos con título, canal y duración', () => {
    const data = { contents: [mkVideo('abcdefghijk', 'Canción X', 'SFDK', '4:28')] };
    const out = extractVideos(data);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'abcdefghijk');
    assert.equal(out[0].title, 'Canción X');
    assert.equal(out[0].artist, 'SFDK');
    assert.equal(out[0].durationS, 268);
    assert.equal(out[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
    assert.equal(out[0].source, 'search');
  });

  test('canal «- Topic» marca source=topic y limpia el artista', () => {
    const data = { contents: [mkVideo('abcdefghijk', 'Wonderland', 'Caravan Palace - Topic', '3:11')] };
    const [v] = extractVideos(data);
    assert.equal(v.source, 'topic');
    assert.equal(v.artist, 'Caravan Palace');
  });

  test('canal VEVO u Official marca source=official', () => {
    const data = { contents: [
      mkVideo('aaaaaaaaaaa', 'X', 'AdeleVEVO', '3:00'),
      mkVideo('bbbbbbbbbbb', 'Y', 'Coldplay Official', '3:00'),
    ]};
    const out = extractVideos(data);
    assert.equal(out[0].source, 'official');
    assert.equal(out[1].source, 'official');
  });

  test('descarta duración sin formato (directo) o más larga que 20 min (compilaciones)', () => {
    const data = { contents: [
      mkVideo('aaaaaaaaaaa', 'En directo', 'Artista', 'EN DIRECTO'),
      mkVideo('bbbbbbbbbbb', 'Mix 1 hora', 'Mix Channel', '1:02:00'),
      mkVideo('ccccccccccc', 'OK', 'Artista', '3:30'),
    ]};
    const out = extractVideos(data);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'ccccccccccc');
  });

  test('dedup por id y tope SCRAPE_MAX_RESULTS', () => {
    const data = { contents: Array.from({ length: SCRAPE_MAX_RESULTS + 5 }, (_, i) => mkVideo(
      String.fromCharCode(97 + i).repeat(11), `Título ${i}`, 'Canal', '3:00',
    ))};
    // Añadimos uno repetido
    data.contents.push(mkVideo('aaaaaaaaaaa', 'duplicado', 'Canal', '3:00'));
    const out = extractVideos(data);
    assert.equal(out.length, SCRAPE_MAX_RESULTS);
    assert.equal(new Set(out.map((o) => o.id)).size, SCRAPE_MAX_RESULTS);
  });
});

describe('searchYoutubeScrape', () => {
  const HTML = (title, channel, len) => `<html><script>var ytInitialData = ${JSON.stringify({
    contents: [{ videoRenderer: {
      videoId: 'abcdefghijk',
      title: { runs: [{ text: title }] },
      ownerText: { runs: [{ text: channel }] },
      lengthText: { simpleText: len },
    }}]
  })};</script></html>`;

  test('fetchea /results con el filtro de vídeo y devuelve items', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url.toString());
      return new Response(HTML('Nos Volveremos a Ver', 'La Raíz', '4:45'), {
        status: 200, headers: { 'Content-Type': 'text/html' },
      });
    };
    const out = await searchYoutubeScrape('La Raíz Nos Volveremos a Ver', { fetchImpl });
    assert.ok(calls[0].includes('youtube.com/results'));
    assert.ok(calls[0].includes('sp=EgIQAQ'), 'añade el filtro de vídeo');
    assert.ok(calls[0].includes('search_query=La'));
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'Nos Volveremos a Ver');
    assert.equal(out[0].artist, 'La Raíz');
    assert.equal(out[0].durationS, 285);
  });

  test('un fetch no-ok devuelve []', async () => {
    const fetchImpl = async () => new Response('', { status: 503 });
    assert.deepEqual(await searchYoutubeScrape('x', { fetchImpl }), []);
  });

  test('un fetch que lanza devuelve [] (no propaga)', async () => {
    const fetchImpl = async () => { throw new TypeError('fetch failed'); };
    assert.deepEqual(await searchYoutubeScrape('x', { fetchImpl }), []);
  });

  test('HTML sin ytInitialData devuelve []', async () => {
    const fetchImpl = async () => new Response('<html>vacío</html>', {
      status: 200, headers: { 'Content-Type': 'text/html' },
    });
    assert.deepEqual(await searchYoutubeScrape('x', { fetchImpl }), []);
  });
});
