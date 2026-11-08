import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/api_config.dart';
import 'package:reminiscencia/cover_index.dart';
import 'package:reminiscencia/covers.dart';
import 'package:reminiscencia/library_store.dart';
import 'package:reminiscencia/song.dart';

// Índice de portadas de R2 (lib/cover_index.dart; ADR-0029), igual que la web (js/cover-index.js).

const String s1 = 'S0000000000000001';
const String f1 = 'F0000000000000001';
const String ks = 'portadas/$s1-0123456789abcdef.jpg';
const String kf = 'portadas/$f1-fedcba9876543210.jpg';

void main() {
  test('ficheros de portada y rutas que acepta la app', () {
    expect(isCoverKey(ks), isTrue);
    expect(isCoverKey(ks, s1), isTrue);
    expect(isCoverKey(ks, f1), isFalse);
    for (final bad in [
      'portadas/../x.jpg',
      'covers/$s1.jpg',
      'portadas/$s1.jpg',
      'portadas/$s1-0123456789ABCDEF.jpg',
      '/$ks',
      null,
      7,
    ]) {
      expect(isCoverKey(bad), isFalse, reason: '$bad');
    }
    expect(cleanCoverPath(ks), ks);
    expect(cleanCoverPath('$kCoverBucketBase$ks'), ks);
    expect(cleanCoverPath('https://malo.example/$ks'), isNull);
    expect(cleanCoverPath('covers/$s1.jpg'), 'covers/$s1.jpg');
    expect(coverPathIsFor(ks, s1), isTrue);
    expect(coverPathIsFor('covers/$s1.jpg', s1), isTrue);
    expect(coverPathIsFor(kf, s1), isFalse);
    expect(kCoverBucketBase, kR2AudioBase);
  });

  test('parseCoverIndex descarta lo que no vale y nunca lanza', () {
    final index = parseCoverIndex(
      jsonEncode({
        s1: ks,
        f1: kf,
        'S0000000000000002': ks,
        'S1': ks,
        'F0000000000000003': 'https://malo.example/x.jpg',
        'F0000000000000004': 12,
      }),
    );
    expect(index, {s1: ks, f1: kf});
    expect(parseCoverIndex('{roto'), isEmpty);
    expect(parseCoverIndex('[1,2]'), isEmpty);
    expect(parseCoverIndex(null), isEmpty);
  });

  test('applyCoverIndexJson: el índice manda sobre «cover»', () {
    final songs = [
      {
        'id': s1,
        'title': 'Uno',
        'duration_s': 1.0,
        'cover': 'covers/$s1.jpg',
        'audio': 'audio/x.opus',
      },
      {'id': 'S0000000000000002', 'audio': 'audio/y.opus'},
    ];
    final out = applyCoverIndexJson(songs, {s1: ks});
    expect((out[0] as Map)['cover'], ks);
    expect(out[1], same(songs[1]));
    expect(songs[0]['cover'], 'covers/$s1.jpg', reason: 'no cambia la lista');
    expect(applyCoverIndexJson(songs, const {}), same(songs));
    final song = Song.fromJson((out[0] as Map).cast<String, dynamic>());
    expect(song.cover, ks);
  });

  test('isCoverReflected: el fichero solo o con la dirección delante', () {
    expect(isCoverReflected('$kCoverBucketBase$ks', ks), isTrue);
    expect(isCoverReflected(ks, ks), isTrue);
    expect(isCoverReflected('covers/$s1.jpg', ks), isFalse);
    expect(isCoverReflected(null, ks), isFalse);
    expect(isCoverReflected(ks, ''), isFalse);
  });

  test(
    'CoverCache pide las portadas del índice al bucket y las de covers/ a la web',
    () {
      final cache = CoverCache(
        root: () async => Directory.systemTemp,
        client: MockClient((_) async => http.Response('', 404)),
      );
      expect(cache.uriFor(ks).toString(), '$kCoverBucketBase$ks');
      expect(
        cache.uriFor('covers/$s1.jpg').toString(),
        'https://reminiscencia.cometia.es/covers/$s1.jpg',
      );
      cache.dispose();
    },
  );

  test(
    'fetchCoverIndexBody: por el Worker y, si falla, del bucket sin caché; 404 = aún no hay',
    () async {
      final seen = <String>[];
      final client = MockClient((request) async {
        seen.add(
          '${request.url} ${request.headers['Cache-Control'] ?? ''}'.trim(),
        );
        if (request.url.host.endsWith('workers.dev')) {
          throw const SocketException('caído');
        }
        return http.Response(jsonEncode({s1: ks}), 200);
      });
      final routes = ApiRoutes(base: 'https://api.prueba.workers.dev');
      final body = await fetchCoverIndexBody(
        client,
        bucketBase: kCoverBucketBase,
        routes: routes,
      );
      expect(parseCoverIndex(body), {s1: ks});
      expect(seen, [
        'https://api.prueba.workers.dev/api/portadas',
        '${kCoverBucketBase}portadas/indice.json no-cache',
      ]);
      final worker = MockClient(
        (request) async => http.Response(
          jsonEncode({f1: kf}),
          200,
          headers: {kWorkerHeader: '1'},
        ),
      );
      expect(
        parseCoverIndex(
          await fetchCoverIndexBody(
            worker,
            bucketBase: kCoverBucketBase,
            routes: ApiRoutes(base: 'https://api.prueba.workers.dev'),
          ),
        ),
        {f1: kf},
      );
      final missing = MockClient((_) async => http.Response('', 404));
      expect(
        await fetchCoverIndexBody(
          missing,
          bucketBase: kCoverBucketBase,
          routes: ApiRoutes(base: ''),
        ),
        isNull,
      );
      final broken = MockClient((_) async => http.Response('', 500));
      await expectLater(
        fetchCoverIndexBody(
          broken,
          bucketBase: kCoverBucketBase,
          routes: ApiRoutes(base: ''),
        ),
        throwsA(isA<http.ClientException>()),
      );
    },
  );

  test(
    'LibraryStore superpone el índice y lo guarda para usarlo sin conexión',
    () async {
      final dir = await Directory.systemTemp.createTemp('portadas-indice');
      addTearDown(() => dir.delete(recursive: true));
      var online = true;
      final client = MockClient((request) async {
        if (!online) throw const SocketException('sin red');
        final url = request.url.toString();
        if (url.endsWith('data/songs.json')) {
          return http.Response(
            jsonEncode([
              {
                'id': s1,
                'title': 'Uno',
                'duration_s': 1.0,
                'audio': 'audio/$s1.opus',
                'cover': 'covers/$s1.jpg',
              },
            ]),
            200,
          );
        }
        if (url.endsWith('data/folders.json')) {
          return http.Response(
            jsonEncode([
              {'id': f1, 'name': 'A'},
            ]),
            200,
          );
        }
        if (url.endsWith('portadas/indice.json')) {
          return http.Response(jsonEncode({s1: ks, f1: kf}), 200);
        }
        return http.Response('', 404);
      });
      final store = LibraryStore(
        root: () async => dir,
        client: client,
        routes: ApiRoutes(base: ''),
      );
      final data = await store.load();
      expect(data.songs.single.cover, ks);
      expect(data.folders.single.cover, kf);
      online = false;
      final offline = await store.load();
      expect(offline.fromNetwork, isFalse);
      expect(offline.songs.single.cover, ks);
      expect(offline.folders.single.cover, kf);
    },
  );
}
