import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/youtube_imports_store.dart';
import 'package:reminiscencia/youtube_importer.dart';

void main() {
  late Directory tmp;
  late YoutubeImportsStore store;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('yt-imports-test');
    store = YoutubeImportsStore(root: () async => tmp);
  });

  tearDown(() async {
    if (await tmp.exists()) await tmp.delete(recursive: true);
  });

  const entry = PendingYoutubeImport(
    id: 'abcdefghijk',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    title: 'Nuestra canción',
    artist: 'La Raíz',
    durationS: 213,
  );

  test('sin índice todavía, la lectura es una lista vacía', () async {
    expect(await store.read(), isEmpty);
  });

  test('guarda y vuelve a leer las importaciones pendientes tal cual', () async {
    await store.write([entry]);
    final read = await store.read();
    expect(read.length, 1);
    expect(read.single.id, entry.id);
    expect(read.single.url, entry.url);
    expect(read.single.title, entry.title);
    expect(read.single.artist, entry.artist);
    expect(read.single.durationS, entry.durationS);
  });

  test('cada escritura reemplaza el índice entero', () async {
    await store.write([entry]);
    await store.write(const []);
    expect(await store.read(), isEmpty);
  });

  test('ida y vuelta por YoutubeSearchResult conserva los campos', () {
    const result = YoutubeSearchResult(
      id: 'abcdefghijk',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      title: 'Nuestra canción',
      artist: 'La Raíz',
      durationS: 213,
    );
    final pending = PendingYoutubeImport.fromResult(result);
    final back = pending.toResult();
    expect(back.id, result.id);
    expect(back.url, result.url);
    expect(back.title, result.title);
    expect(back.artist, result.artist);
    expect(back.durationS, result.durationS);
  });

  test('la lectura tolera entradas dañadas o mal formadas y mantiene las buenas', () async {
    final index = File('${tmp.path}/importaciones.json');
    await index.writeAsString(
      jsonEncode({
        'version': 1,
        'importaciones': [
          {'id': 'abcdefghijk', 'url': 'https://youtu.be/abcdefghijk', 'title': 'Buena'},
          {'id': '', 'url': 'https://youtu.be/x', 'title': 'Sin id'},
          {'url': 'https://youtu.be/y', 'title': 'Sin id tampoco'},
          'no es un objeto',
          {'id': 'lmnopqrstuv', 'url': '', 'title': 'Sin url'},
        ],
      }),
    );
    final read = await store.read();
    expect(read.map((e) => e.id), ['abcdefghijk']);
  });

  test('un índice que no es JSON válido se trata como corrupto sin romper (lo detecta quien llama)', () async {
    final index = File('${tmp.path}/importaciones.json');
    await index.writeAsString('{ esto no es json');
    expect(() => store.read(), throwsA(isA<FormatException>()));
  });
}
