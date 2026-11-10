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
    await _tick();

    expect(downloads.of(_result.id).state, YoutubeDownloadState.running);
    final saved = await store.read();
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
}
