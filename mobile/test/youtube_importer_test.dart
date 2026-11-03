import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/youtube_importer.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'rechaza antes de hacer red una URL que no es playlist de YouTube',
    () async {
      var calls = 0;
      final importer = YoutubeImporter(
        client: MockClient((_) async {
          calls++;
          return http.Response('{}', 200);
        }),
      );

      await expectLater(
        importer.listPlaylist('https://example.com/playlist?list=PL123'),
        throwsA(isA<AppException>()),
      );
      expect(calls, 0);
    },
  );

  test(
    'lista canciones, elimina duplicados y limita al contrato del proxy',
    () async {
      late Uri requested;
      final importer = YoutubeImporter(
        client: MockClient((request) async {
          requested = request.url;
          return http.Response(
            jsonEncode({
              'items': [
                {
                  'url': 'https://www.youtube.com/watch?v=abcdefghijk',
                  'title': 'Primera',
                },
                {
                  'url': 'https://www.youtube.com/watch?v=abcdefghijk',
                  'title': 'Duplicada',
                },
                {
                  'url': 'https://www.youtube.com/watch?v=ABCDEFGHIJK',
                  'title': 'Segunda',
                },
              ],
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
        base: Uri.parse('https://example.test/'),
      );

      final tracks = await importer.listPlaylist(
        'https://www.youtube.com/playlist?list=PL_demo',
      );

      expect(requested.path, '/api/youtube/playlist');
      expect(
        requested.queryParameters['url'],
        contains('youtube.com/playlist'),
      );
      expect(tracks.map((track) => track.title), ['Primera', 'Segunda']);
    },
  );

  test('traduce el error JSON del proxy', () async {
    final importer = YoutubeImporter(
      client: MockClient(
        (_) async =>
            http.Response(jsonEncode({'error': 'La playlist no existe.'}), 404),
      ),
    );

    await expectLater(
      importer.listPlaylist('https://www.youtube.com/playlist?list=PL_demo'),
      throwsA(
        isA<AppException>().having(
          (error) => error.message,
          'message',
          'La playlist no existe.',
        ),
      ),
    );
  });

  test(
    'convierte, espera, valida el WAV y conserva el orden de la playlist',
    () async {
      final wav = List<int>.filled(64, 0);
      wav.setRange(0, 4, 'RIFF'.codeUnits);
      wav.setRange(8, 12, 'WAVE'.codeUnits);
      final importer = YoutubeImporter(
        client: MockClient((request) async {
          switch (request.url.path) {
            case '/api/youtube/playlist':
              return http.Response(
                jsonEncode({
                  'items': [
                    {
                      'url': 'https://www.youtube.com/watch?v=abcdefghijk',
                      'title': 'Mi tema',
                    },
                  ],
                }),
                200,
              );
            case '/api/youtube/convert':
              return http.Response(jsonEncode({'jobId': 'job-1'}), 200);
            case '/api/youtube/status':
              return http.Response(jsonEncode({'status': 'completed'}), 200);
            case '/api/youtube/download':
              return http.Response.bytes(wav, 200);
            default:
              fail('Ruta inesperada: ${request.url}');
          }
        }),
        base: Uri.parse('https://example.test/'),
        tempDir: () => Directory.systemTemp.createTemp('youtube-import-test'),
      );

      final audios = await importer.importPlaylist(
        'https://www.youtube.com/playlist?list=PL_demo',
      );

      expect(audios, hasLength(1));
      expect(audios.single.name, 'Mi tema.wav');
      expect(await File(audios.single.path).readAsBytes(), wav);
      await importer.cleanup(audios);
      expect(await File(audios.single.path).exists(), isFalse);
    },
  );
}
