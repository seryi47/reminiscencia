import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/ui/youtube_results.dart';
import 'package:reminiscencia/youtube_importer.dart';
import 'package:reminiscencia/youtube_imports_store.dart';

import 'support/fakes.dart';

const _result = YoutubeSearchResult(
  id: 'abcdefghijk',
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  title: 'Nuestra canción',
  artist: 'La Raíz',
  durationS: 213,
);

Future<void> _tick() => Future<void>.delayed(const Duration(milliseconds: 20));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tmp;
  late YoutubeImportsStore store;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('yt-bg-download');
    store = YoutubeImportsStore(root: () async => tmp);
  });

  tearDown(() async {
    if (await tmp.exists()) await tmp.delete(recursive: true);
  });

  test('mientras descarga, la importación queda guardada en disco (sobreviviría a un cierre)', () async {
    final release = Completer<http.Response>();
    final importer = YoutubeImporter(
      client: MockClient((request) {
        // La playlist se cuelga: simula que el sistema cierra la app a media descarga.
        if (request.url.path == '/api/youtube/playlist') return release.future;
        return Future.value(http.Response('{}', 500));
      }),
    );
    final services = buildTestServices(youtube: importer).services;
    final downloads = YoutubeDownloads(store: store);

    unawaited(downloads.start(services, _result));

    // La escritura es best-effort (unawaited): se espera a que termine sondeando, sin depender de un tiempo fijo.
    List<PendingYoutubeImport> saved = const [];
    for (var i = 0; i < 100 && saved.isEmpty; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
      saved = await store.read();
    }

    expect(downloads.of(_result.id).state, YoutubeDownloadState.running);
    expect(saved.map((e) => e.id), [_result.id], reason: 'la importación en curso debe estar en disco');

    // Se libera para que el test no deje trabajo colgado.
    release.complete(http.Response('{"error":"fin"}', 500));
    await _tick();
  });

  test('al abrir la app, restore reanuda las importaciones que quedaron a medias', () async {
    // Como si un cierre anterior hubiera dejado una importación a medias en disco.
    await store.write([PendingYoutubeImport.fromResult(_result)]);

    // Proceso nuevo: instancia nueva (como tras reiniciar la app), importer no disponible para terminar rápido.
    final downloads = YoutubeDownloads(store: store);
    final services = buildTestServices(youtube: null).services;

    await downloads.restore(services);
    await _tick();

    // restore despachó start para la entrada guardada (prueba de que la lee y la reanuda).
    expect(downloads.of(_result.id).state, YoutubeDownloadState.error);
    expect(await store.read(), isEmpty, reason: 'una importación irreanudable se limpia del índice');
  });

  test('restore solo actúa una vez', () async {
    await store.write([PendingYoutubeImport.fromResult(_result)]);
    final downloads = YoutubeDownloads(store: store);
    final services = buildTestServices(youtube: null).services;
    await downloads.restore(services);
    await _tick();
    // Segunda llamada: no vuelve a hacer nada (ya está marcada como reanudada).
    await downloads.restore(services);
    await _tick();
    expect(downloads.of(_result.id).state, YoutubeDownloadState.error);
  });

  test('cuando el proxy falla, la importación deja de estar pendiente (no se reanimaría en bucle)', () async {
    final importer = YoutubeImporter(
      client: MockClient((request) async => http.Response('{"error":"no disponible"}', 500)),
    );
    final services = buildTestServices(youtube: importer).services;
    final downloads = YoutubeDownloads(store: store);

    await downloads.start(services, _result);
    await _tick();

    expect(downloads.of(_result.id).state, YoutubeDownloadState.error);
    expect(await store.read(), isEmpty);
  });

  Future<void> waitState(YoutubeDownloads d, YoutubeDownloadState want) async {
    // Margen amplio para runners CI lentos: 15 s (antes 3 s). Local pasa en <100 ms, sobra.
    for (var i = 0; i < 1500 && d.of(_result.id).state != want; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
  }

  // La playlist se cuelga en una «compuerta» que el test controla (MockClient ignora el abort HTTP, así que la descarga
  // se queda «en curso» hasta que se libera). Al liberarla DESPUÉS de cancelar/pausar, el flujo llega al siguiente
  // throwIfCancelled y termina de forma determinista. La compuerta se puede renovar para la reanudación.
  test('suspend (segundo plano) pausa la descarga en curso y la conserva para reanudarla', () async {
    var gate = Completer<http.Response>();
    final importer = YoutubeImporter(client: MockClient((request) {
      if (request.url.path == '/api/youtube/playlist') return gate.future;
      return Future.value(http.Response('{}', 500));
    }));
    final services = buildTestServices(youtube: importer).services;
    final downloads = YoutubeDownloads(store: store);

    unawaited(downloads.start(services, _result));
    await waitState(downloads, YoutubeDownloadState.running);
    expect(downloads.of(_result.id).state, YoutubeDownloadState.running);

    downloads.suspend();
    gate.complete(http.Response('{"error":"fin"}', 500)); // libera el GET colgado para que llegue al throwIfCancelled
    await waitState(downloads, YoutubeDownloadState.idle);

    expect(downloads.of(_result.id).state, YoutubeDownloadState.idle,
        reason: 'pausada, no error ni cancelación del usuario');
    expect((await store.read()).map((e) => e.id), [_result.id],
        reason: 'una pausa por segundo plano se conserva en disco para reanudarse');
    await _tick();
  });

  test('resume vuelve a lanzar una descarga pausada por segundo plano', () async {
    var gate = Completer<http.Response>();
    final importer = YoutubeImporter(client: MockClient((request) {
      if (request.url.path == '/api/youtube/playlist') return gate.future;
      return Future.value(http.Response('{}', 500));
    }));
    final services = buildTestServices(youtube: importer).services;
    final downloads = YoutubeDownloads(store: store);

    unawaited(downloads.start(services, _result));
    await waitState(downloads, YoutubeDownloadState.running);
    downloads.suspend();
    gate.complete(http.Response('{"error":"fin"}', 500));
    await waitState(downloads, YoutubeDownloadState.idle);

    gate = Completer<http.Response>(); // compuerta nueva: el segundo intento vuelve a quedarse «en curso»
    downloads.resume(services);
    await waitState(downloads, YoutubeDownloadState.running);
    expect(downloads.of(_result.id).state, YoutubeDownloadState.running,
        reason: 'al volver a primer plano la importación pendiente se reanuda');

    if (!gate.isCompleted) gate.complete(http.Response('{"error":"fin"}', 500));
    await _tick();
  });

  test('cancel detiene la descarga a propósito: idle y fuera de pendientes (no se reanuda)', () async {
    var gate = Completer<http.Response>();
    final importer = YoutubeImporter(client: MockClient((request) {
      if (request.url.path == '/api/youtube/playlist') return gate.future;
      return Future.value(http.Response('{}', 500));
    }));
    final services = buildTestServices(youtube: importer).services;
    final downloads = YoutubeDownloads(store: store);

    unawaited(downloads.start(services, _result));
    await waitState(downloads, YoutubeDownloadState.running);

    downloads.cancel(_result.id);
    gate.complete(http.Response('{"error":"fin"}', 500));
    await waitState(downloads, YoutubeDownloadState.idle);

    expect(downloads.of(_result.id).state, YoutubeDownloadState.idle);
    expect(await store.read(), isEmpty,
        reason: 'cancelada por el usuario: no queda pendiente ni se reanuda');
    await _tick();
  });
}
