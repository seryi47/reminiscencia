import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/youtube_cache_client.dart';

void main() {
  group('youtubeCacheCheck', () {
    final workerBase = Uri.parse('https://reminiscencia.cometia.es/');

    test('resultado vacío si no hay URLs', () async {
      final result = await youtubeCacheCheck([], workerBase: workerBase);
      expect(result.hits, isEmpty);
      expect(result.misses, isEmpty);
    });

    test('POST con la lista y parsea hits/misses/invalid', () async {
      Uri? seen;
      Map<String, dynamic>? body;
      final client = MockClient((req) async {
        seen = req.url;
        body = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({
            'hits': [
              {'url': 'https://y/1', 'videoId': 'a' * 11, 'size_bytes': 10, 'duration_s': 213, 'title': 'ok'},
            ],
            'misses': [
              {'url': 'https://y/2', 'videoId': 'b' * 11},
            ],
            'invalid': [
              {'url': 'bad-url'},
            ],
          }),
          200,
          headers: const {'content-type': 'application/json'},
        );
      });

      final result = await youtubeCacheCheck(
        ['https://y/1', 'https://y/2', 'bad-url'],
        workerBase: workerBase,
        client: client,
      );
      expect(seen.toString(), 'https://reminiscencia.cometia.es/api/youtube/cache/check');
      expect(body!['urls'], ['https://y/1', 'https://y/2', 'bad-url']);
      expect(result.hits.length, 1);
      expect(result.hits.first.jobId, 'cached:${'a' * 11}');
      expect(result.misses.length, 1);
      expect(result.invalid, ['bad-url']);
      expect(result.hitRate, 0.5);
    });

    test('si el servidor falla, todo va a miss (no bloquea)', () async {
      final client = MockClient((_) async => http.Response('err', 503));
      final result = await youtubeCacheCheck(['u1'], workerBase: workerBase, client: client);
      expect(result.hits, isEmpty);
      expect(result.misses.length, 1);
      expect(result.hitRate, 0);
    });

    test('si tira error de red, tampoco rompe', () async {
      final client = MockClient((_) async => throw Exception('no net'));
      final result = await youtubeCacheCheck(['u1'], workerBase: workerBase, client: client);
      expect(result.hits, isEmpty);
      expect(result.misses.length, 1);
    });

    test('concurrencyFor: 8 cache / 2 miss', () {
      expect(concurrencyFor(cached: true), 8);
      expect(concurrencyFor(cached: false), 2);
    });

    test('allCached y noneCached', () {
      final allHit = YoutubeCacheCheckResult(
        hits: [const YoutubeCacheHit(url: 'u', videoId: 'xxxxxxxxxxx')],
        misses: const [],
        invalid: const [],
      );
      expect(allHit.allCached, isTrue);
      expect(allHit.noneCached, isFalse);
      const allMiss = YoutubeCacheCheckResult(
        hits: [],
        misses: [YoutubeCacheMiss(url: 'u', videoId: 'xxxxxxxxxxx')],
        invalid: [],
      );
      expect(allMiss.noneCached, isTrue);
      expect(allMiss.allCached, isFalse);
    });
  });
}
