import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/api_config.dart';
import 'package:reminiscencia/edit_remote.dart';
import 'package:reminiscencia/library_requests.dart';
import 'package:reminiscencia/local_audio.dart';
import 'package:reminiscencia/shared_upload.dart';

// Dirección del API con respaldo en Vercel (lib/api_config.dart; ADR-0029), igual que la web (js/api-config.js).

const String base = 'https://reminiscencia-api.prueba.workers.dev';

http.Response fromWorker(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {kWorkerHeader: '1'});

void main() {
  test(
    'una sola constante, vacía hasta desplegar; trozos iguales que la web',
    () {
      expect(kWorkerApiBase, isA<String>());
      final web = File('../frontend/web/js/api-config.js').readAsStringSync();
      final sizes = {
        for (final m in RegExp(
          r'export const (\w+_CHUNK_BYTES) = (\d+) \* 1024 \* 1024;',
        ).allMatches(web))
          m.group(1)!: int.parse(m.group(2)!) * 1024 * 1024,
      };
      expect(sizes, {
        'VERCEL_CHUNK_BYTES': kVercelChunkBytes,
        'WORKER_CHUNK_BYTES': kWorkerChunkBytes,
      });
      expect(kVercelChunkBytes, 4 * 1024 * 1024);
      expect(kWorkerChunkBytes, 32 * 1024 * 1024);
      expect(kUploadChunkBytes, kVercelChunkBytes);
      // La constante de la web y la de la APK apuntan al mismo sitio.
      final webBase = RegExp(
        r"^export const WORKER_API_BASE = '([^']*)';$",
        multiLine: true,
      ).firstMatch(web)!.group(1);
      expect(normalizeApiBase(webBase!), normalizeApiBase(kWorkerApiBase));
    },
  );

  test(
    'audio por el Worker (ADR-0031): la base sale de kWorkerApiBase, y las pruebas no la usan',
    () {
      // Por defecto (la app): el mismo origen que el API, sin otra copia de la dirección.
      final production = normalizeApiBase(kWorkerApiBase);
      expect(
        ApiRoutes().audioBase,
        production.isEmpty ? isEmpty : '$production/',
      );
      // test/flutter_test_config.dart: las rutas comunes de las pruebas no tienen Worker, tampoco para el audio.
      expect(apiRoutes.audioBase, isEmpty);
      // Caído: sin audio por el Worker hasta kRetryWorkerAfter; reportWorkerFailure sin Worker no hace nada.
      var now = DateTime(2026, 11, 6, 12);
      final routes = ApiRoutes(base: base, clock: () => now);
      expect(routes.audioBase, '$base/');
      routes.reportWorkerFailure();
      expect(routes.audioBase, isEmpty);
      now = now.add(kRetryWorkerAfter);
      expect(routes.audioBase, '$base/');
      final none = ApiRoutes(base: '')..reportWorkerFailure();
      expect(none.audioBase, isEmpty);
      // La web y la redirección de vercel.json usan la misma dirección para el audio.
      final vercel =
          jsonDecode(File('../frontend/web/vercel.json').readAsStringSync())
              as Map<String, dynamic>;
      final redirect = (vercel['redirects'] as List).cast<Map>().firstWhere(
        (rule) => rule['source'] == '/audio/:file',
      );
      expect(
        redirect['destination'],
        production.isEmpty
            ? startsWith('https://pub-')
            : '$production/audio/:file',
      );
    },
  );

  test('normalizeApiBase: solo un origen https (o http local)', () {
    expect(normalizeApiBase(' $base/ '), base);
    expect(normalizeApiBase('http://localhost:8787'), 'http://localhost:8787');
    expect(normalizeApiBase('http://ejemplo.workers.dev'), '');
    expect(normalizeApiBase('$base/api'), '');
    expect(normalizeApiBase('no es una url'), '');
    expect(normalizeApiBase(''), '');
  });

  test('sin Worker todo va a Vercel y la subida usa trozos de 4 MB', () async {
    final seen = <Uri>[];
    final client = MockClient((request) async {
      seen.add(request.url);
      return http.Response('{"ok":true}', 200);
    });
    final routes = ApiRoutes(base: '');
    expect(routes.usesWorker, isFalse);
    await routes.send(client, 'POST', '/api/editar', body: '{}');
    expect(
      seen.single,
      Uri.parse('https://reminiscencia.vercel.app/api/editar'),
    );
    final route = await routes.uploadRoute(client);
    expect(route.worker, isFalse);
    expect(route.chunkBytes, kVercelChunkBytes);
    expect(route.endpoint, kUploadEndpoint);
    expect(
      seen,
      hasLength(1),
      reason: 'sin Worker no se pregunta a /api/salud',
    );
  });

  test('con el Worker vivo, las peticiones van a él', () async {
    final seen = <Uri>[];
    final client = MockClient((request) async {
      seen.add(request.url);
      return fromWorker({'ok': true});
    });
    final routes = ApiRoutes(base: base);
    await routes.send(client, 'GET', '/api/editar?incidencia=3');
    expect(seen.single.toString(), '$base/api/editar?incidencia=3');
  });

  test(
    'si el Worker no responde (red o respuesta ajena), se repite en Vercel y se sigue en Vercel un rato',
    () async {
      var now = DateTime(2026, 11, 6);
      final seen = <String>[];
      var workerFails = true;
      final client = MockClient((request) async {
        seen.add(request.url.toString());
        if (request.url.toString().startsWith(base)) {
          if (workerFails) throw const SocketException('sin red');
          return fromWorker({'ok': true});
        }
        return http.Response('{"ok":true,"de":"vercel"}', 200);
      });
      final routes = ApiRoutes(base: base, clock: () => now);
      final response = await routes.send(
        client,
        'POST',
        '/api/editar',
        body: '{}',
      );
      expect(jsonDecode(response.body)['de'], 'vercel');
      expect(seen, [
        '$base/api/editar',
        'https://reminiscencia.vercel.app/api/editar',
      ]);
      expect(routes.usesWorker, isFalse);
      await routes.send(client, 'GET', '/api/editar?incidencia=1');
      expect(
        seen.last,
        'https://reminiscencia.vercel.app/api/editar?incidencia=1',
      );
      now = now.add(kRetryWorkerAfter);
      workerFails = false;
      expect(routes.usesWorker, isTrue);
      await routes.send(client, 'GET', '/api/salud');
      expect(seen.last, '$base/api/salud');

      // Una página de error de Cloudflare (sin la cabecera del Worker) también pasa a Vercel.
      final cloudflare = MockClient(
        (request) async => request.url.toString().startsWith(base)
            ? http.Response('<html>1101</html>', 500)
            : http.Response('{"ok":true}', 200),
      );
      final other = ApiRoutes(base: base);
      expect(
        (await other.send(cloudflare, 'POST', '/api/subir')).statusCode,
        200,
      );
      expect(other.usesWorker, isFalse);
    },
  );

  test(
    'un error del propio Worker se respeta: no se repite en Vercel',
    () async {
      var calls = 0;
      final client = MockClient((request) async {
        calls++;
        return fromWorker({'ok': false, 'error': 'No.'}, 400);
      });
      final routes = ApiRoutes(base: base);
      expect(
        (await routes.send(client, 'POST', '/api/editar')).statusCode,
        400,
      );
      expect(calls, 1);
    },
  );

  test(
    'uploadRoute: con /api/salud vivo, el Worker y trozos de 32 MB; caído o lento, Vercel',
    () async {
      final alive = MockClient((request) async => fromWorker({'ok': true}));
      final route = await ApiRoutes(base: base).uploadRoute(alive);
      expect(route.worker, isTrue);
      expect(route.endpoint.toString(), '$base/api/subir');
      expect(route.chunkBytes, kWorkerChunkBytes);

      final down = MockClient(
        (request) async => throw const SocketException('no'),
      );
      expect((await ApiRoutes(base: base).uploadRoute(down)).worker, isFalse);

      final slow = MockClient(
        (request) => Future<http.Response>.delayed(
          const Duration(seconds: 2),
          () => fromWorker({'ok': true}),
        ),
      );
      final slowRoutes = ApiRoutes(
        base: base,
        probeTimeout: const Duration(milliseconds: 20),
      );
      expect(
        (await slowRoutes.uploadRoute(slow)).chunkBytes,
        kVercelChunkBytes,
      );
    },
  );

  test(
    'las ediciones usan las rutas: la portada por el Worker trae su fichero',
    () async {
      const id = 'F0000000000000001';
      const key = 'portadas/$id-0123456789abcdef.jpg';
      final client = MockClient((request) async {
        expect(request.url.toString(), '$base/api/editar');
        return fromWorker({
          'ok': true,
          'mensaje': 'Portada guardada.',
          'portada': key,
        });
      });
      final receipt = await submitCatalogCover(
        id,
        Uint8List.fromList([0xff, 0xd8, 0xff, 0xd9]),
        client: client,
        routes: ApiRoutes(base: base),
      );
      expect(receipt.cover, key);
      expect(receipt.message, 'Portada guardada.');
      // Un fichero de otro id no se acepta.
      final other = await submitCatalogCover(
        'F0000000000000002',
        Uint8List.fromList([0xff, 0xd8, 0xff, 0xd9]),
        client: client,
        routes: ApiRoutes(base: base),
      );
      expect(other.cover, isNull);
      // Organizar por el Worker caído vuelve a Vercel.
      final fallback = MockClient(
        (request) async => request.url.host == 'reminiscencia.vercel.app'
            ? http.Response('{"ok":true,"incidencia":5}', 200)
            : throw const SocketException('no'),
      );
      final organized = await submitLibraryEdit(
        LibraryRequest.createAlbum(name: 'Boleros', artist: ''),
        client: fallback,
        routes: ApiRoutes(base: base),
      );
      expect(organized.issue, 5);
      expect(
        await fetchEditStatus(
          5,
          client: MockClient(
            (request) async => fromWorker({'ok': true, 'estado': 'cerrada'}),
          ),
          routes: ApiRoutes(base: base),
        ),
        'cerrada',
      );
    },
  );
  test(
    'SharedUploader envía cada archivo por la ruta fijada: dirección y tamaño de trozo',
    () async {
      final dir = await Directory.systemTemp.createTemp('ruta-subida');
      addTearDown(() => dir.delete(recursive: true));
      final opus = File('${dir.path}/x.opus')
        ..writeAsBytesSync(List<int>.filled(25, 7));
      final seen = <http.Request>[];
      final uploader = SharedUploader(
        client: MockClient((request) async {
          seen.add(request);
          return fromWorker({'ok': true});
        }),
        converter: const _NoConverter(),
        hasConnection: () async => true,
        retryDelay: Duration.zero,
      );
      expect(uploader.route.worker, isFalse);
      expect(uploader.chunkBytes, kVercelChunkBytes);
      expect(uploader.endpoint, kUploadEndpoint);
      uploader.route = UploadRoute(
        endpoint: Uri.parse('$base/api/subir'),
        chunkBytes: 10,
        worker: true,
      );
      final result = await uploader.resend(opus, 'x.mp3');
      expect(result.outcome, UploadOutcome.uploaded);
      expect(seen.map((r) => r.url.toString()).toSet(), {'$base/api/subir'});
      expect(seen.map((r) => r.bodyBytes.length), [10, 10, 5]);
      expect(seen.map((r) => r.headers['X-Partes']).toSet(), {'3'});
    },
  );
}

class _NoConverter implements AudioConverter {
  const _NoConverter();

  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) => throw UnimplementedError();

  @override
  Future<void> cancel() async {}
}
