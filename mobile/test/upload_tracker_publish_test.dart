import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/api_config.dart';
import 'package:reminiscencia/auth_store.dart';
import 'package:reminiscencia/local_audio.dart';
import 'package:reminiscencia/shared_upload.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/upload_tracker.dart';
import 'package:reminiscencia/worker_catalog_client.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/fakes.dart';

/// UploadTracker contra el Worker (ADR-0052): una canción recién subida se publica al instante vía
/// `/api/buzon/publish`. 200 → `published`; 409 → duplicada → `failed` con mensaje claro; 412 → el cliente
/// reintenta y acaba `published`; sin `workerCatalog` → cae al polling del catálogo antiguo.

class _Converter implements AudioConverter {
  _Converter({this.bytes = 20, this.durationS = 7});
  final int bytes;
  final double durationS;
  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) async {
    await File(outputPath).writeAsBytes(List<int>.generate(bytes, (i) => i % 251));
    return ConvertedAudio(durationS: durationS, channels: 2, bitrate: 48000, bytes: bytes);
  }

  @override
  Future<void> cancel() async {}
}

final ApiRoutes _fakeRoutes = ApiRoutes(base: 'https://worker.test');

Future<void> _pump() async {
  await Future<void>.delayed(Duration.zero);
  await Future<void>.delayed(Duration.zero);
  await Future<void>.delayed(Duration.zero);
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      kAuthPreferenceKey: 'contraseña-worker',
    });
  });

  late Directory work;
  late List<http.Request> uploadRequests;
  late List<http.Request> workerRequests;
  late int workerVersion;

  setUp(() async {
    work = await Directory.systemTemp.createTemp('tracker_pub_test');
    uploadRequests = [];
    workerRequests = [];
    workerVersion = 5;
  });

  tearDown(() async {
    if (await work.exists()) await work.delete(recursive: true);
  });

  http.Client buildUploadClient() {
    return MockClient((request) async {
      uploadRequests.add(request);
      return http.Response(
        jsonEncode({'ok': true, 'ruta': 'audio-library/buzon/x.opus', 'nombre': 'x'}),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
  }

  WorkerCatalogClient workerClient(http.Response Function(http.Request req, int n) reply) {
    final c = MockClient((request) async {
      workerRequests.add(request);
      return reply(request, workerRequests.length);
    });
    return WorkerCatalogClient(
      auth: SharedPreferencesAuthStore(),
      client: c,
      routes: _fakeRoutes,
    );
  }

  SharedUploader buildUploader() {
    return SharedUploader(
      client: buildUploadClient(),
      converter: _Converter(),
      hasConnection: () async => true,
      workDir: () async => work,
      retryDelay: Duration.zero,
      random: Random(1),
    );
  }

  test('publicación síncrona: tras subir, POST a /api/buzon/publish y entry queda publicada', () async {
    final catalog = workerClient((req, n) {
      if (req.url.path == '/api/catalogo/latest') {
        return http.Response(
          jsonEncode({'version': workerVersion, 'folders': [], 'songs': [], 'updated_at': ''}),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (req.url.path == '/api/buzon/publish') {
        final body = jsonDecode(req.body);
        expect(body['if_match'], workerVersion);
        final song = (body['songs'] as List).first as Map;
        expect(song['codec'], 'opus');
        expect(song['sha256'], isNotNull);
        expect(song['duration_s'], 7);
        expect(song['size_bytes'], 20);
        workerVersion += 1;
        return http.Response(
          jsonEncode({'ok': true, 'version': workerVersion, 'event': {'kind': 'buzon_publish'}}),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      return http.Response('nope', 500);
    });

    final tracker = UploadTracker(
      uploader: buildUploader(),
      published: FakePublishedSongs(const [PublishedSong('S0', 'Dummy')]),
      store: UploadsStore(root: () async => work),
      clock: () => DateTime(2026, 11, 26),
      random: Random(2),
      workerCatalog: catalog,
    );
    await tracker.start([PickedAudioFile(name: 'Nueva.mp3', path: '/x/Nueva.mp3')]);
    // Esperamos a que el _inBackground termine.
    for (var i = 0; i < 40; i++) {
      await _pump();
      if (tracker.entries.any((e) => e.stage == UploadStage.published)) break;
    }
    final entry = tracker.entries.single;
    expect(entry.stage, UploadStage.published, reason: 'estado tras publish 200');
    expect(workerRequests.any((r) => r.url.path == '/api/buzon/publish'), isTrue);
  });

  test('409 duplicado: entry marcada como failed con mensaje claro', () async {
    final catalog = workerClient((req, n) {
      if (req.url.path == '/api/catalogo/latest') {
        return http.Response(
          jsonEncode({'version': workerVersion, 'folders': [], 'songs': [], 'updated_at': ''}),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (req.url.path == '/api/buzon/publish') {
        return http.Response(
          jsonEncode({'ok': false, 'error': 'buzon: la canción Nueva ya existía (sha256 duplicado).'}),
          409,
          headers: {'content-type': 'application/json'},
        );
      }
      return http.Response('nope', 500);
    });

    final tracker = UploadTracker(
      uploader: buildUploader(),
      published: FakePublishedSongs(),
      store: UploadsStore(root: () async => work),
      clock: () => DateTime(2026, 11, 26),
      random: Random(3),
      workerCatalog: catalog,
    );
    await tracker.start([PickedAudioFile(name: 'Dup.mp3', path: '/x/Dup.mp3')]);
    for (var i = 0; i < 40; i++) {
      await _pump();
      if (tracker.entries.any((e) => e.stage == UploadStage.failed)) break;
    }
    final entry = tracker.entries.single;
    expect(entry.stage, UploadStage.failed);
    expect(entry.error, contains('ya existía'));
  });

  test('412 → refetch → 200: publicación acaba OK', () async {
    var publishCount = 0;
    final catalog = workerClient((req, n) {
      if (req.url.path == '/api/catalogo/latest') {
        return http.Response(
          jsonEncode({'version': workerVersion, 'folders': [], 'songs': [], 'updated_at': ''}),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (req.url.path == '/api/buzon/publish') {
        publishCount++;
        if (publishCount == 1) {
          workerVersion = 9;
          return http.Response(
            jsonEncode({'ok': false, 'error': 'if_match desactualizado', 'current_version': 9}),
            412,
            headers: {'content-type': 'application/json'},
          );
        }
        final body = jsonDecode(req.body);
        expect(body['if_match'], 9);
        return http.Response(
          jsonEncode({'ok': true, 'version': 10, 'event': {}}),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      return http.Response('nope', 500);
    });

    final tracker = UploadTracker(
      uploader: buildUploader(),
      published: FakePublishedSongs(),
      store: UploadsStore(root: () async => work),
      clock: () => DateTime(2026, 11, 26),
      random: Random(4),
      workerCatalog: catalog,
    );
    await tracker.start([PickedAudioFile(name: 'Retry.mp3', path: '/x/Retry.mp3')]);
    for (var i = 0; i < 50; i++) {
      await _pump();
      if (tracker.entries.any((e) => e.stage == UploadStage.published)) break;
    }
    expect(tracker.entries.single.stage, UploadStage.published);
    expect(publishCount, 2);
  });

  test('sin workerCatalog: se usa el polling clásico (no se llama al Worker)', () async {
    final tracker = UploadTracker(
      uploader: buildUploader(),
      published: FakePublishedSongs(const [PublishedSong('S0', 'Dummy')]),
      store: UploadsStore(root: () async => work),
      clock: () => DateTime(2026, 11, 26),
      random: Random(5),
      // workerCatalog: null (ausente a propósito)
    );
    await tracker.start([PickedAudioFile(name: 'Legacy.mp3', path: '/x/Legacy.mp3')]);
    await _pump();
    await _pump();
    final entry = tracker.entries.single;
    // Sin Worker nunca saltamos a published por este camino; nos quedamos en saved esperando al polling.
    expect([UploadStage.saved, UploadStage.publishing], contains(entry.stage));
    expect(workerRequests, isEmpty);
  });
}
