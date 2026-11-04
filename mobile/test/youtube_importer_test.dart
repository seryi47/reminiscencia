import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/youtube_importer.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

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
              'playlist': {'id': 'PL_demo', 'title': 'Nuestra playlist'},
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
      expect(tracks.every((track) => track.playlistId == 'PL_demo'), isTrue);
      expect(
        tracks.every((track) => track.playlistTitle == 'Nuestra playlist'),
        isTrue,
      );
    },
  );

  test('acepta un enlace corto de vídeo de YouTube', () async {
    late Uri requested;
    final importer = YoutubeImporter(
      client: MockClient((request) async {
        requested = request.url;
        return http.Response(
          jsonEncode({
            'playlist': {'id': 'PL_demo', 'title': 'Nuestra playlist'},
            'items': [
              {
                'url': 'https://www.youtube.com/watch?v=abcdefghijk',
                'title': 'Vídeo',
              },
            ],
          }),
          200,
        );
      }),
      base: Uri.parse('https://example.test/'),
    );

    final tracks = await importer.listPlaylist('https://youtu.be/abcdefghijk');

    expect(tracks.single.title, 'Vídeo');
    expect(requested.queryParameters['url'], 'https://youtu.be/abcdefghijk');
  });

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
                  'playlist': {'id': 'PL_demo', 'title': 'Nuestra playlist'},
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

  test(
    'reintenta saturación, mantiene una traza y muestra posición/progreso de cola',
    () async {
      final wav = List<int>.filled(64, 0);
      wav.setRange(0, 4, 'RIFF'.codeUnits);
      wav.setRange(8, 12, 'WAVE'.codeUnits);
      final traceIds = <String?>[];
      final pollNumbers = <String?>[];
      final phases = <String>[];
      final waits = <Duration>[];
      var createAttempts = 0;
      var statusAttempts = 0;
      final importer = YoutubeImporter(
        client: MockClient((request) async {
          if (request.url.path == '/api/youtube/playlist') {
            return http.Response(
              jsonEncode({
                'playlist': {'id': 'PL_demo', 'title': 'Nuestra playlist'},
                'items': [
                  {
                    'url': 'https://www.youtube.com/watch?v=abcdefghijk',
                    'title': 'Mi tema',
                  },
                ],
              }),
              200,
            );
          }
          if (request.url.path == '/api/youtube/convert') {
            createAttempts++;
            traceIds.add(request.headers['x-homeostasia-trace']);
            if (createAttempts == 1) {
              return http.Response(
                jsonEncode({'error': 'Servicio temporalmente saturado'}),
                503,
                headers: {
                  'content-type': 'application/json',
                  'retry-after': '0',
                },
              );
            }
            return http.Response(jsonEncode({'jobId': 'job-1'}), 200);
          }
          if (request.url.path == '/api/youtube/status') {
            statusAttempts++;
            traceIds.add(request.headers['x-homeostasia-trace']);
            pollNumbers.add(request.headers['x-homeostasia-poll']);
            if (statusAttempts == 2) {
              return http.Response(
                jsonEncode({'ok': false, 'error': 'Error temporal del proxy.'}),
                503,
                headers: {'content-type': 'application/json'},
              );
            }
            return http.Response(
              jsonEncode(
                statusAttempts == 1
                    ? {
                        'status': 'queued',
                        'queuePosition': 37,
                        'queueLength': 50,
                        'progress': 0,
                      }
                    : {'status': 'completed'},
              ),
              200,
            );
          }
          if (request.url.path == '/api/youtube/download') {
            return http.Response.bytes(wav, 200);
          }
          fail('Ruta inesperada: ${request.url}');
        }),
        base: Uri.parse('https://example.test/'),
        tempDir: () => Directory.systemTemp.createTemp('youtube-retry-test'),
        wait: (duration) async => waits.add(duration),
      );

      final audios = await importer.importPlaylist(
        'https://www.youtube.com/playlist?list=PL_demo',
        onProgress: (progress) => phases.add(progress.message),
      );

      expect(audios, hasLength(1));
      expect(createAttempts, 2);
      expect(statusAttempts, 3);
      expect(traceIds, hasLength(5));
      expect(traceIds.toSet(), hasLength(1));
      expect(traceIds.first, matches(RegExp(r'^[a-f0-9-]{36}$')));
      expect(pollNumbers, ['1', '2', '3']);
      expect(
        phases.any((message) => message.contains('reintento 2/6')),
        isTrue,
      );
      expect(
        phases.any(
          (message) => message.contains('en cola (posición 37 de 50)'),
        ),
        isTrue,
      );
      expect(
        phases.any((message) => message.contains('reintento 1/5 en 3 s')),
        isTrue,
      );
      expect(phases.last, contains('descargando WAV'));
      expect(
        waits.any(
          (duration) =>
              duration >= const Duration(milliseconds: 1900) &&
              duration <= kYoutubeConvertCreateGap,
        ),
        isTrue,
      );
      await importer.cleanup(audios);
    },
  );

  test(
    'detiene consultas y retoma el mismo trabajo guardado tras crear otro importer',
    () async {
      final wav = List<int>.filled(64, 0);
      wav.setRange(0, 4, 'RIFF'.codeUnits);
      wav.setRange(8, 12, 'WAVE'.codeUnits);
      var createAttempts = 0;
      var statusAttempts = 0;
      final cancellation = YoutubeImportCancellation();
      final statusStarted = Completer<void>();
      final client = MockClient.streaming((request, _) async {
        http.StreamedResponse jsonResponse(Object body, int statusCode) =>
            http.StreamedResponse(
              Stream.value(utf8.encode(jsonEncode(body))),
              statusCode,
              headers: {'content-type': 'application/json'},
            );
        if (request.url.path == '/api/youtube/playlist') {
          return jsonResponse({
            'playlist': {'id': 'PL_demo', 'title': 'Nuestra playlist'},
            'items': [
              {
                'url': 'https://www.youtube.com/watch?v=abcdefghijk',
                'title': 'Mi tema',
              },
            ],
          }, 200);
        }
        if (request.url.path == '/api/youtube/convert') {
          createAttempts++;
          return jsonResponse({'jobId': 'job-persisted'}, 200);
        }
        if (request.url.path == '/api/youtube/status') {
          statusAttempts++;
          if (statusAttempts == 1) {
            final abortable = request as http.AbortableRequest;
            statusStarted.complete();
            await abortable.abortTrigger;
            throw http.RequestAbortedException(request.url);
          }
          return jsonResponse({'status': 'completed'}, 200);
        }
        if (request.url.path == '/api/youtube/download') {
          return http.StreamedResponse(Stream.value(wav), 200);
        }
        fail('Ruta inesperada: ${request.url}');
      });
      final base = Uri.parse('https://example.test/');
      Future<Directory> tempDir() =>
          Directory.systemTemp.createTemp('youtube-resume-test');
      final firstImporter = YoutubeImporter(
        client: client,
        base: base,
        tempDir: tempDir,
        wait: (_) async {},
      );
      final stoppedImport = firstImporter.importPlaylist(
        'https://www.youtube.com/playlist?list=PL_demo',
        cancellation: cancellation,
      );
      await statusStarted.future;
      cancellation.cancel();
      await expectLater(
        stoppedImport,
        throwsA(
          isA<AppException>().having(
            (error) => error.message,
            'message',
            'Se detuvo el seguimiento de la conversión.',
          ),
        ),
      );

      final resumedImporter = YoutubeImporter(
        client: client,
        base: base,
        tempDir: tempDir,
        wait: (_) async {},
      );
      final audios = await resumedImporter.importPlaylist(
        'https://www.youtube.com/playlist?list=PL_demo',
      );

      expect(createAttempts, 1);
      expect(statusAttempts, 2);
      expect(audios, hasLength(1));
      await resumedImporter.cleanup(audios);
    },
  );

  test(
    'un trabajo vencido se olvida y el siguiente intento crea uno nuevo',
    () async {
      SharedPreferences.setMockInitialValues({
        'homeostasia.youtube.job.abcdefghijk': jsonEncode({
          'jobId': 'job-expired',
          'traceId': '01234567-89ab-4cde-8abc-0123456789ab',
        }),
      });
      final wav = List<int>.filled(64, 0);
      wav.setRange(0, 4, 'RIFF'.codeUnits);
      wav.setRange(8, 12, 'WAVE'.codeUnits);
      var statusAttempts = 0;
      var createAttempts = 0;
      final importer = YoutubeImporter(
        client: MockClient((request) async {
          if (request.url.path == '/api/youtube/playlist') {
            return http.Response(
              jsonEncode({
                'playlist': {'id': 'PL_demo', 'title': 'Nuestra playlist'},
                'items': [
                  {
                    'url': 'https://www.youtube.com/watch?v=abcdefghijk',
                    'title': 'Mi tema',
                  },
                ],
              }),
              200,
            );
          }
          if (request.url.path == '/api/youtube/status') {
            statusAttempts++;
            return statusAttempts == 1
                ? http.Response(
                    jsonEncode({
                      'error': 'La conversión ya no está disponible.',
                    }),
                    404,
                  )
                : http.Response(jsonEncode({'status': 'completed'}), 200);
          }
          if (request.url.path == '/api/youtube/convert') {
            createAttempts++;
            return http.Response(jsonEncode({'jobId': 'job-new'}), 200);
          }
          if (request.url.path == '/api/youtube/download') {
            return http.Response.bytes(wav, 200);
          }
          fail('Ruta inesperada: ${request.url}');
        }),
        base: Uri.parse('https://example.test/'),
        tempDir: () => Directory.systemTemp.createTemp('youtube-expired-test'),
        wait: (_) async {},
      );

      await expectLater(
        importer.importPlaylist(
          'https://www.youtube.com/playlist?list=PL_demo',
        ),
        throwsA(
          isA<AppException>().having(
            (error) => error.message,
            'message',
            'La conversión ya no está disponible. Inicia de nuevo para crear otro trabajo.',
          ),
        ),
      );
      final audios = await importer.importPlaylist(
        'https://www.youtube.com/playlist?list=PL_demo',
      );

      expect(createAttempts, 1);
      expect(audios, hasLength(1));
      await importer.cleanup(audios);
    },
  );
}
