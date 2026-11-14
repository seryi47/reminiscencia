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
                  'artist': 'Desakato',
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
      expect(tracks.first.artist, 'Desakato');
      expect(tracks.last.artist, '');
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
            case '/api/convert':
              return http.Response(jsonEncode({'jobId': 'job-1'}), 200);
            case '/api/status':
              return http.Response(jsonEncode({'status': 'completed'}), 200);
            case '/api/download/':
              return http.Response.bytes(wav, 200);
            default:
              fail('Ruta inesperada: ${request.url}');
          }
        }),
        base: Uri.parse('https://example.test/'),
        converterBase: Uri.parse('https://example.test/'),
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
          if (request.url.path == '/api/convert') {
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
          if (request.url.path == '/api/status') {
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
          if (request.url.path == '/api/download/') {
            return http.Response.bytes(wav, 200);
          }
          fail('Ruta inesperada: ${request.url}');
        }),
        base: Uri.parse('https://example.test/'),
        converterBase: Uri.parse('https://example.test/'),
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
        if (request.url.path == '/api/convert') {
          createAttempts++;
          return jsonResponse({'jobId': 'job-persisted'}, 200);
        }
        if (request.url.path == '/api/status') {
          statusAttempts++;
          if (statusAttempts == 1) {
            final abortable = request as http.AbortableRequest;
            statusStarted.complete();
            await abortable.abortTrigger;
            throw http.RequestAbortedException(request.url);
          }
          return jsonResponse({'status': 'completed'}, 200);
        }
        if (request.url.path == '/api/download/') {
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
        converterBase: base,
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
        converterBase: base,
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
          if (request.url.path == '/api/status') {
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
          if (request.url.path == '/api/convert') {
            createAttempts++;
            return http.Response(jsonEncode({'jobId': 'job-new'}), 200);
          }
          if (request.url.path == '/api/download/') {
            return http.Response.bytes(wav, 200);
          }
          fail('Ruta inesperada: ${request.url}');
        }),
        base: Uri.parse('https://example.test/'),
        converterBase: Uri.parse('https://example.test/'),
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

  test(
    'en un lote, una pista que el conversor rechaza no tira las demás',
    () async {
      final wav = List<int>.filled(64, 0);
      wav.setRange(0, 4, 'RIFF'.codeUnits);
      wav.setRange(8, 12, 'WAVE'.codeUnits);
      final importer = YoutubeImporter(
        client: MockClient((request) async {
          if (request.url.path == '/api/convert') {
            // La segunda pista la rechaza siempre el conversor (503, reintentable).
            if (request.body.contains('bbbbbbbbbbb')) {
              return http.Response(jsonEncode({'error': 'saturado'}), 503);
            }
            return http.Response(jsonEncode({'jobId': 'job-ok'}), 200);
          }
          if (request.url.path == '/api/status') {
            return http.Response(jsonEncode({'status': 'completed'}), 200);
          }
          if (request.url.path == '/api/download/') {
            return http.Response.bytes(wav, 200);
          }
          fail('Ruta inesperada: ${request.url}');
        }),
        base: Uri.parse('https://example.test/'),
        converterBase: Uri.parse('https://example.test/'),
        tempDir: () => Directory.systemTemp.createTemp('youtube-batch-test'),
        wait: (_) async {},
      );

      final audios = await importer.importTracks(const [
        YoutubeTrack(url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'Buena'),
        YoutubeTrack(url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', title: 'Rechazada'),
      ]);

      expect(audios, hasLength(1), reason: 'la buena se descarga; la rechazada se omite sin tirar el lote');
      expect(audios.first.track.title, 'Buena');
      await importer.cleanup(audios);
    },
  );

  test(
    'una descarga truncada (menos bytes de los anunciados) se reintenta y acaba bien',
    () async {
      List<int> wav(int n) {
        final b = List<int>.filled(n, 0);
        b.setRange(0, 4, 'RIFF'.codeUnits);
        b.setRange(8, 12, 'WAVE'.codeUnits);
        return b;
      }

      var dl = 0;
      final client = MockClient.streaming((request, _) async {
        http.StreamedResponse js(Object body, int code) =>
            http.StreamedResponse(
              Stream.value(utf8.encode(jsonEncode(body))),
              code,
              headers: {'content-type': 'application/json'},
            );
        final p = request.url.path;
        if (p == '/api/convert') return js({'jobId': 'job-1'}, 200);
        if (p == '/api/status') return js({'status': 'completed'}, 200);
        if (p == '/api/download/') {
          dl++;
          // La 1ª vez llega menos de lo anunciado (truncado); la 2ª, completo.
          final body = dl == 1 ? wav(64) : wav(200);
          return http.StreamedResponse(
            Stream.value(body),
            200,
            contentLength: 200,
            headers: {'content-type': 'audio/wav'},
          );
        }
        fail('Ruta inesperada: ${request.url}');
      });
      final importer = YoutubeImporter(
        client: client,
        base: Uri.parse('https://example.test/'),
        converterBase: Uri.parse('https://example.test/'),
        tempDir: () => Directory.systemTemp.createTemp('yt-trunc-test'),
        wait: (_) async {},
      );

      final audios = await importer.importTracks(const [
        YoutubeTrack(
          url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
          title: 'Una',
        ),
      ]);

      expect(dl, 2, reason: 'la primera descarga truncada se reintenta');
      expect(audios, hasLength(1));
      await importer.cleanup(audios);
    },
  );

  test(
    'el tope diario del conversor (429) corta la tanda y avisa',
    () async {
      var dailyLimitAvisos = 0;
      final importer = YoutubeImporter(
        client: MockClient((request) async {
          if (request.url.path == '/api/convert') {
            return http.Response(
              jsonEncode({'error': "You've reached the daily conversion limit (40 per day). Please come back tomorrow!"}),
              429,
            );
          }
          fail('No debería llamar a ${request.url} tras el tope diario');
        }),
        base: Uri.parse('https://example.test/'),
        converterBase: Uri.parse('https://example.test/'),
        tempDir: () => Directory.systemTemp.createTemp('youtube-daily-test'),
        wait: (_) async {},
      );

      final audios = await importer.importTracks(
        const [
          YoutubeTrack(url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'Una'),
          YoutubeTrack(url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', title: 'Dos'),
        ],
        onDailyLimit: () => dailyLimitAvisos++,
      );

      expect(audios, isEmpty, reason: 'con el tope diario no se convierte nada');
      expect(dailyLimitAvisos, greaterThanOrEqualTo(1), reason: 'se avisa del tope diario');
    },
  );

  // WAV válido con un `fmt ` real (byteRate configurable) y un `data` del tamaño pedido, para que _wavDurationS calcule la
  // duración = dataBytes / byteRate. Con byteRate = 100, la duración en segundos = dataBytes / 100.
  List<int> wavOf({required int byteRate, required int dataBytes}) {
    final total = 44 + dataBytes;
    final b = List<int>.filled(total, 0);
    void str(int off, String s) => b.setRange(off, off + s.length, s.codeUnits);
    void le32(int off, int v) {
      b[off] = v & 0xff;
      b[off + 1] = (v >> 8) & 0xff;
      b[off + 2] = (v >> 16) & 0xff;
      b[off + 3] = (v >> 24) & 0xff;
    }
    void le16(int off, int v) {
      b[off] = v & 0xff;
      b[off + 1] = (v >> 8) & 0xff;
    }
    str(0, 'RIFF');
    le32(4, total - 8);
    str(8, 'WAVE');
    str(12, 'fmt ');
    le32(16, 16);
    le16(20, 1); // PCM
    le16(22, 2); // canales
    le32(24, 48000); // sampleRate
    le32(28, byteRate);
    le16(32, 4);
    le16(34, 16);
    str(36, 'data');
    le32(40, dataBytes);
    return b;
  }

  test(
    'una descarga truncada salta al siguiente candidato y entrega la versión íntegra',
    () async {
      final truncated = wavOf(byteRate: 100, dataBytes: 1000); // 10 s
      final full = wavOf(byteRate: 100, dataBytes: 18000); // 180 s
      final downloaded = <String?>[];
      final importer = YoutubeImporter(
        client: MockClient((request) async {
          final p = request.url.path;
          if (p == '/api/convert') {
            final job = request.body.contains('bbbbbbbbbbb') ? 'job-B' : 'job-A';
            return http.Response(jsonEncode({'jobId': job}), 200);
          }
          if (p == '/api/status') {
            return http.Response(jsonEncode({'status': 'completed'}), 200);
          }
          if (p == '/api/download/') {
            final job = request.url.queryParameters['jobId'];
            downloaded.add(job);
            return http.Response.bytes(job == 'job-B' ? full : truncated, 200);
          }
          fail('Ruta inesperada: ${request.url}');
        }),
        base: Uri.parse('https://example.test/'),
        converterBase: Uri.parse('https://example.test/'),
        tempDir: () => Directory.systemTemp.createTemp('yt-fallback-test'),
        wait: (_) async {},
      );

      final audios = await importer.importTracks(const [
        YoutubeTrack(
          url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
          title: 'Una',
          expectedDurationS: 180,
          alternatives: ['https://www.youtube.com/watch?v=bbbbbbbbbbb'],
        ),
      ]);

      expect(downloaded, ['job-A', 'job-B'],
          reason: 'el truncado (A) se descarta y se prueba el alternativo (B)');
      expect(audios, hasLength(1));
      expect(await File(audios.single.path).length(), full.length,
          reason: 'se entrega la versión íntegra, no la truncada');
      await importer.cleanup(audios);
    },
  );

  test(
    'una descarga truncada sin alternativas falla (no entrega un audio inservible)',
    () async {
      final truncated = wavOf(byteRate: 100, dataBytes: 1000); // 10 s de 180 esperados
      final importer = YoutubeImporter(
        client: MockClient((request) async {
          final p = request.url.path;
          if (p == '/api/convert') return http.Response(jsonEncode({'jobId': 'job-A'}), 200);
          if (p == '/api/status') return http.Response(jsonEncode({'status': 'completed'}), 200);
          if (p == '/api/download/') return http.Response.bytes(truncated, 200);
          fail('Ruta inesperada: ${request.url}');
        }),
        base: Uri.parse('https://example.test/'),
        converterBase: Uri.parse('https://example.test/'),
        tempDir: () => Directory.systemTemp.createTemp('yt-trunc-fail-test'),
        wait: (_) async {},
      );

      await expectLater(
        importer.importTracks(const [
          YoutubeTrack(
            url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
            title: 'Una',
            expectedDurationS: 180,
          ),
        ]),
        throwsA(isA<YoutubeTruncatedException>().having(
          (e) => e.message,
          'message',
          allOf(contains('incompleta'), contains('180 s')),
        )),
      );
    },
  );

  test(
    'sin duración esperada, una descarga por debajo de 90 s se rechaza (suelo absoluto)',
    () async {
      final short = wavOf(byteRate: 100, dataBytes: 8000); // 80 s, sin referencia de Spotify
      final importer = YoutubeImporter(
        client: MockClient((request) async {
          final p = request.url.path;
          if (p == '/api/convert') return http.Response(jsonEncode({'jobId': 'job-A'}), 200);
          if (p == '/api/status') return http.Response(jsonEncode({'status': 'completed'}), 200);
          if (p == '/api/download/') return http.Response.bytes(short, 200);
          fail('Ruta inesperada: ${request.url}');
        }),
        base: Uri.parse('https://example.test/'),
        converterBase: Uri.parse('https://example.test/'),
        tempDir: () => Directory.systemTemp.createTemp('yt-floor-test'),
        wait: (_) async {},
      );

      await expectLater(
        importer.importTracks(const [
          YoutubeTrack(url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'Una'),
        ]),
        throwsA(isA<YoutubeTruncatedException>().having((e) => e.message, 'message', contains('demasiado corta'))),
      );
    },
  );

  test(
    'una canción genuinamente corta (<90 s según Spotify) sí se acepta',
    () async {
      final short = wavOf(byteRate: 100, dataBytes: 4000); // 40 s, y Spotify dice 40 s
      final importer = YoutubeImporter(
        client: MockClient((request) async {
          final p = request.url.path;
          if (p == '/api/convert') return http.Response(jsonEncode({'jobId': 'job-A'}), 200);
          if (p == '/api/status') return http.Response(jsonEncode({'status': 'completed'}), 200);
          if (p == '/api/download/') return http.Response.bytes(short, 200);
          fail('Ruta inesperada: ${request.url}');
        }),
        base: Uri.parse('https://example.test/'),
        converterBase: Uri.parse('https://example.test/'),
        tempDir: () => Directory.systemTemp.createTemp('yt-shortok-test'),
        wait: (_) async {},
      );

      final audios = await importer.importTracks(const [
        YoutubeTrack(
          url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
          title: 'Interludio',
          expectedDurationS: 40,
        ),
      ]);
      expect(audios, hasLength(1), reason: 'un tema de 40 s confirmado por Spotify no es un truncado');
      await importer.cleanup(audios);
    },
  );

  test(
    'no rechaza una canción íntegra aunque difiera unos segundos de la esperada',
    () async {
      final almost = wavOf(byteRate: 100, dataBytes: 17500); // 175 s de 180 esperados
      final importer = YoutubeImporter(
        client: MockClient((request) async {
          final p = request.url.path;
          if (p == '/api/convert') return http.Response(jsonEncode({'jobId': 'job-A'}), 200);
          if (p == '/api/status') return http.Response(jsonEncode({'status': 'completed'}), 200);
          if (p == '/api/download/') return http.Response.bytes(almost, 200);
          fail('Ruta inesperada: ${request.url}');
        }),
        base: Uri.parse('https://example.test/'),
        converterBase: Uri.parse('https://example.test/'),
        tempDir: () => Directory.systemTemp.createTemp('yt-ok-test'),
        wait: (_) async {},
      );

      final audios = await importer.importTracks(const [
        YoutubeTrack(
          url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
          title: 'Una',
          expectedDurationS: 180,
        ),
      ]);

      expect(audios, hasLength(1), reason: '175 s de 180 está dentro del margen, no es truncado');
      await importer.cleanup(audios);
    },
  );
}
