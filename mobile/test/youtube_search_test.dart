import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/youtube_importer.dart';
import 'package:reminiscencia/youtube_stream.dart';

import 'support/fakes.dart';

class _FakeResolver implements YoutubeStreamResolver {
  final List<String> asked = [];

  @override
  Future<YoutubeStream> resolve(String videoId) async {
    asked.add(videoId);
    return YoutubeStream(uri: Uri.parse('https://example.com/$videoId.webm'));
  }
}

const _searchJson = {
  'items': [
    {
      'id': 'dQw4w9WgXcQ',
      'title': 'Tema de YouTube uno',
      'artist': 'Artista Uno',
      'durationS': 213,
    },
    {'id': 'aaaaaaaaaaa', 'title': 'Tema de YouTube dos', 'durationS': 95},
  ],
};

YoutubeImporter _importer(List<Uri> calls) => YoutubeImporter(
  client: MockClient((request) async {
    calls.add(request.url);
    if (request.url.path == '/api/youtube/search') {
      return http.Response(
        jsonEncode(_searchJson),
        200,
        headers: {'content-type': 'application/json'},
      );
    }
    return http.Response('{"error":"no disponible"}', 500);
  }),
);

void main() {
  group('búsqueda de YouTube (datos)', () {
    test('limpia el texto y exige entre 3 y 100 letras', () {
      expect(youtubeSearchQuery('  bad   bunny '), 'bad bunny');
      expect(youtubeSearchQuery('ab'), isNull);
      expect(youtubeSearchQuery('x' * 101), isNull);
    });

    test('formatea duraciones', () {
      expect(formatYoutubeDuration(225), '3:45');
      expect(formatYoutubeDuration(3723), '1:02:03');
      expect(formatYoutubeDuration(0), '0:00');
    });

    test('descarta resultados mal formados o repetidos', () {
      final found = parseYoutubeSearch({
        'items': [
          {'id': 'dQw4w9WgXcQ', 'title': ' A ', 'artist': 'B', 'durationS': 10},
          {'id': 'dQw4w9WgXcQ', 'title': 'repetido'},
          {'id': 'corto', 'title': 'x'},
          {'id': 'aaaaaaaaaaa', 'title': ''},
        ],
      });
      expect(found, hasLength(1));
      expect(found.single.title, 'A');
      expect(found.single.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(() => parseYoutubeSearch({}), throwsA(isA<AppException>()));
    });

    test('search usa el proxy y explica los errores', () async {
      final calls = <Uri>[];
      final found = await _importer(calls).search('bad bunny');
      expect(found, hasLength(2));
      expect(calls.single.queryParameters['q'], 'bad bunny');
      await expectLater(
        _importer(calls).search('ab'),
        throwsA(isA<AppException>()),
      );
    });
  });

  group('buscador', () {
    testWidgets('sin coincidencias busca solo en YouTube y Escuchar reproduce', (
      tester,
    ) async {
      setWindow(tester, const Size(400, 900));
      final calls = <Uri>[];
      final resolver = _FakeResolver();
      final t = buildTestServices(
        youtube: _importer(calls),
        streamResolver: resolver,
      );
      await pumpApp(tester, t.services);
      await tester.tap(find.text('Buscar'));
      await settle(tester);
      await tester.enterText(
        find.byKey(const Key('search-field')),
        'cancion inexistente zzqx',
      );
      await tester.pump(const Duration(milliseconds: 800));
      await settle(tester);
      await tester.pump(const Duration(seconds: 2));
      expect(find.text('Tema de YouTube uno'), findsOneWidget);
      expect(find.text('Artista Uno · 3:33'), findsOneWidget);

      await tester.ensureVisible(
        find.byKey(const Key('youtube-listen-dQw4w9WgXcQ')),
      );
      await tester.tap(find.byKey(const Key('youtube-listen-dQw4w9WgXcQ')));
      await settle(tester);
      expect(resolver.asked, ['dQw4w9WgXcQ']);
      expect(t.playback.log, contains('stream:dQw4w9WgXcQ'));
      // Escuchar también inicia la descarga; el proxy simulado falla y se puede reintentar.
      await settle(tester);
      expect(
        find.descendant(
          of: find.byKey(const Key('youtube-download-dQw4w9WgXcQ')),
          matching: find.text('Reintentar'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('con coincidencias en la biblioteca solo ofrece el botón', (
      tester,
    ) async {
      setWindow(tester, const Size(400, 900));
      final calls = <Uri>[];
      final t = buildTestServices(
        songs: [fakeSong('S0000000000000001')],
        youtube: _importer(calls),
      );
      await pumpApp(tester, t.services);
      await tester.tap(find.text('Buscar'));
      await settle(tester);
      await tester.enterText(find.byKey(const Key('search-field')), 'Canción');
      await tester.pump(const Duration(milliseconds: 800));
      await settle(tester);
      expect(find.byKey(const Key('youtube-search-button')), findsOneWidget);
      expect(calls.where((u) => u.path == '/api/youtube/search'), isEmpty);
      await tester.ensureVisible(
        find.byKey(const Key('youtube-search-button')),
      );
      await tester.tap(find.byKey(const Key('youtube-search-button')));
      await settle(tester);
      expect(find.text('Tema de YouTube uno'), findsOneWidget);
    });
  });
}
