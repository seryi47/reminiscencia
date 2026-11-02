import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/library_controller.dart';
import 'package:reminiscencia/library_store.dart';
import 'package:reminiscencia/local_audio.dart';
import 'package:reminiscencia/network.dart';
import 'package:reminiscencia/offline_choice.dart';
import 'package:reminiscencia/playback_plan.dart';
import 'package:reminiscencia/song.dart';

import 'support/fakes.dart';

/// Servidor falso de la web: catálogo cambiante, audio con bytes y un interruptor de red.
class FakeWeb {
  List<String> catalogIds = [];
  bool offline = false;
  bool brokenCatalog = false;
  int requests = 0;

  late final MockClient client = MockClient((request) async {
    requests += 1;
    if (offline) throw const SocketException('Failed host lookup');
    final path = request.url.path;
    if (path.endsWith('songs.json')) {
      if (brokenCatalog) return http.Response('<html>error</html>', 200);
      return http.Response(
        jsonEncode([for (final id in catalogIds) _json(id)]),
        200,
      );
    }
    if (path.endsWith('folders.json')) return http.Response('[]', 200);
    if (path.endsWith('.opus')) return http.Response.bytes([1, 2, 3, 4], 200);
    return http.Response('', 404);
  });

  static Map<String, dynamic> _json(String id) => {
    'id': id,
    'title': 'Tema $id',
    'artist': '',
    'year': null,
    'tags': <String>[],
    'folder_id': null,
    'duration_s': 120,
    'license': 'Dominio público',
    'audio': 'audio/$id.opus',
  };
}

class FakeNetwork implements NetworkInfo {
  FakeNetwork({this.wifi = true});

  bool wifi;

  @override
  Future<bool> onUnmeteredNetwork() async => wifi;
}

class MemoryOffline implements OfflineChoice {
  MemoryOffline([this.value = false]);

  bool value;

  @override
  Future<bool> read() async => value;

  @override
  Future<void> write(bool v) async => value = v;
}

class NoConverter implements AudioConverter {
  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) async {
    throw const AppException('sin conversor en esta prueba');
  }

  @override
  Future<void> cancel() async {}
}

const String kA = 'S0000000000000aaa';
const String kB = 'S0000000000000bbb';
const String kC = 'S0000000000000ccc';
const String kLocal = 'L0000000000000001';

void main() {
  group('decisiones puras de reproducción', () {
    test(
      'la siguiente canción que puede sonar sin red se elige saltando las que no',
      () {
        expect(nextAvailableIndex([true, false, true], 0), 2);
        expect(nextAvailableIndex([true, false, true], 2), isNull);
        expect(nextAvailableIndex([false, false], -1), isNull);
      },
    );

    test(
      'una cola mezclada de locales y descargadas salta solo las no descargadas',
      () {
        final playable = [
          playableOffline(song: _song(kLocal, local: true), cached: false),
          playableOffline(song: _song(kA), cached: true),
          playableOffline(song: _song(kB), cached: false),
          playableOffline(song: _song(kLocal, local: true), cached: false),
        ];
        expect(playable, [true, true, false, true]);
        expect(nextAvailableIndex(playable, 1), 3);
      },
    );

    test('solo se borra lo cacheado que no está en el catálogo ni en uso', () {
      expect(
        prunableAudioIds(cached: {kA, kB, kC}, catalog: {kA}, inUse: {kB}),
        {kC},
      );
    });

    test(
      'sincroniza al volver a primer plano solo si ha pasado el tiempo mínimo',
      () {
        final last = DateTime(2026, 11, 2, 10);
        expect(shouldSyncOnResume(last: null, now: last), isTrue);
        expect(
          shouldSyncOnResume(
            last: last,
            now: last.add(const Duration(minutes: 5)),
          ),
          isFalse,
        );
        expect(
          shouldSyncOnResume(
            last: last,
            now: last.add(const Duration(minutes: 10)),
          ),
          isTrue,
        );
      },
    );
  });

  group('copia de la web en el dispositivo', () {
    late Directory tmp;
    late FakeWeb web;
    late LibraryStore store;
    late LocalAudioStore localStore;

    setUp(() async {
      tmp = await Directory.systemTemp.createTemp('reminiscencia_sync_');
      web = FakeWeb();
      store = LibraryStore(
        root: () async => Directory('${tmp.path}/biblioteca'),
        client: web.client,
      );
      localStore = LocalAudioStore(
        root: () async => Directory('${tmp.path}/biblioteca-local'),
      );
    });

    tearDown(() async {
      if (await tmp.exists()) await tmp.delete(recursive: true);
    });

    Future<void> writeCachedAudio(String id) async {
      final dir = Directory('${tmp.path}/biblioteca/audio');
      await dir.create(recursive: true);
      await File('${dir.path}/$id.opus').writeAsBytes([9, 9]);
    }

    Future<bool> hasCachedAudio(String id) =>
        File('${tmp.path}/biblioteca/audio/$id.opus').exists();

    LibraryController controllerWith({
      FakePlaybackPort? playback,
      MemoryOffline? offline,
      FakeNetwork? network,
      bool withLocal = true,
      DateTime Function()? clock,
    }) {
      return LibraryController(
        source: store,
        playback: playback ?? FakePlaybackPort(),
        local: withLocal
            ? LocalAudioLibrary(
                store: localStore,
                converter: NoConverter(),
                random: Random(3),
              )
            : null,
        offline: offline,
        network: network,
        clock: clock,
      );
    }

    test('un catálogo que cambia actualiza la biblioteca', () async {
      web.catalogIds = [kA, kB];
      final controller = controllerWith();
      await controller.load();
      expect(controller.songs.map((s) => s.id), [kA, kB]);

      web.catalogIds = [kB, kC];
      await controller.load();
      expect(controller.songs.map((s) => s.id), [kB, kC]);
      expect(controller.loadError, isNull);
      expect(controller.online, isTrue);
    });

    test('una canción retirada pierde su audio en caché cuando deja de estar en uso', () async {
      web.catalogIds = [kA, kB];
      final playback = FakePlaybackPort();
      final controller = controllerWith(playback: playback);
      await controller.load();
      await writeCachedAudio(kA);
      await writeCachedAudio(kB);

      // B se retira de la web, pero sigue en la cola cargada: no se borra todavía.
      web.catalogIds = [kA];
      await controller.load();
      expect(await hasCachedAudio(kB), isTrue, reason: 'sigue en la cola');
      expect(await hasCachedAudio(kA), isTrue);

      // Al tocar A la cola pasa a ser solo A: B ya no está en uso y se borra.
      await controller.playSong(controller.songs.single);
      await _waitUntilGone(() => hasCachedAudio(kB));
      expect(await hasCachedAudio(kB), isFalse);
      expect(await hasCachedAudio(kA), isTrue);
    });

    test('una canción local queda intacta cuando la web cambia', () async {
      web.catalogIds = [kA];
      await (await localStore.audioFile(kLocal)).writeAsBytes([1, 2, 3, 4]);
      await localStore.commit(
        const LocalSongRecord(
          id: kLocal,
          title: 'Mía',
          durationS: 60,
          channels: 1,
          bitrate: 32000,
          bytes: 4,
          createdAt: 1,
        ),
      );
      final controller = controllerWith();

      await controller.load();
      web.catalogIds = [];
      await controller.load();

      expect(controller.songs.map((s) => s.id), [kLocal]);
      expect(controller.songs.single.local, isTrue);
      expect(await (await localStore.audioFile(kLocal)).exists(), isTrue);
    });

    test(
      'sin red se usa la copia guardada, sin error bloqueante ni borrados',
      () async {
        web.catalogIds = [kA];
        final controller = controllerWith();
        await controller.load();
        await writeCachedAudio(kA);

        web.offline = true;
        await controller.load();

        expect(controller.songs.map((s) => s.id), [kA]);
        expect(controller.loadError, isNull);
        expect(controller.online, isFalse);
        expect(controller.status, contains('sin conexión'));
        expect(await hasCachedAudio(kA), isTrue);
      },
    );

    test(
      'sin red y sin copia, la app muestra el motivo y no se rompe',
      () async {
        web.offline = true;
        final controller = controllerWith(withLocal: false);
        await controller.load();
        expect(controller.songs, isEmpty);
        expect(controller.loadError, isNotNull);
      },
    );

    test('un catálogo ilegible no sustituye la copia buena', () async {
      web.catalogIds = [kA];
      final controller = controllerWith();
      await controller.load();

      web.brokenCatalog = true;
      await controller.load();

      expect(controller.songs.map((s) => s.id), [kA]);
      expect(controller.online, isFalse);
    });

    test('reproducir desde la copia no hace peticiones de red', () async {
      web.catalogIds = [kA];
      final playback = FakePlaybackPort();
      final controller = controllerWith(playback: playback);
      await controller.load();
      await controller.playSong(controller.songs.single);
      web.offline = true;
      final before = web.requests;

      await controller.playSong(controller.songs.single);

      expect(web.requests, before);
      expect(playback.log.last, 'play:0');
    });

    test(
      'al volver a primer plano no se sincroniza si la última vez fue hace poco',
      () async {
        web.catalogIds = [kA];
        var now = DateTime(2026, 11, 2, 10);
        final controller = controllerWith(clock: () => now);
        await controller.load();
        final afterFirst = web.requests;

        now = now.add(const Duration(minutes: 3));
        await controller.syncIfStale();
        expect(web.requests, afterFirst);

        now = now.add(const Duration(minutes: 10));
        await controller.syncIfStale();
        expect(web.requests, greaterThan(afterFirst));
      },
    );

    test(
      'con la opción de escuchar sin conexión, la sincronización descarga solo en Wi-Fi',
      () async {
        web.catalogIds = [kA];
        final offline = MemoryOffline(true);

        final noWifi = controllerWith(
          offline: offline,
          network: FakeNetwork(wifi: false),
        );
        await noWifi.load();
        expect(await hasCachedAudio(kA), isFalse);

        final wifi = controllerWith(
          offline: offline,
          network: FakeNetwork(wifi: true),
        );
        await wifi.load();
        expect(await hasCachedAudio(kA), isTrue);
      },
    );

    test(
      'una canción en la cola no se borra mientras suena; al dejar de sonar, sí',
      () async {
        web.catalogIds = [kA, kB];
        final playback = FakePlaybackPort();
        final controller = controllerWith(playback: playback);
        await controller.load();
        await writeCachedAudio(kA);
        await writeCachedAudio(kB);

        await controller.playSong(controller.songs.first);
        web.catalogIds = [kB];
        await controller.load();
        expect(await hasCachedAudio(kA), isTrue, reason: 'está sonando');

        await controller.playSong(controller.songs.last);
        // La poda corre en segundo plano tras el cambio de canción: se espera a que termine (E/S real de ficheros).
        for (var i = 0; i < 100 && await hasCachedAudio(kA); i += 1) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
        expect(await hasCachedAudio(kA), isFalse, reason: 'ya no está en uso');
        expect(await hasCachedAudio(kB), isTrue);
      },
    );

    test(
      'sin la opción de escuchar sin conexión, la sincronización no descarga nada',
      () async {
        web.catalogIds = [kA];
        final network = FakeNetwork(wifi: true);
        final controller = controllerWith(
          offline: MemoryOffline(false),
          network: network,
        );
        await controller.load();
        expect(await hasCachedAudio(kA), isFalse);
      },
    );

    test(
      'pausar la conversión deja los archivos pendientes para volver a añadirlos',
      () async {
        final converter = _CancellingConverter();
        final library = LocalAudioLibrary(
          store: localStore,
          converter: converter,
          random: Random(5),
        );
        converter.library = library;
        final result = await library.addFiles(const [
          PickedAudioFile(name: 'uno.wav', path: '/m/uno.wav'),
          PickedAudioFile(name: 'dos.wav', path: '/m/dos.wav'),
        ]);
        expect(result.added.map((s) => s.title), ['uno']);
        expect(result.failed.single.name, 'dos.wav');
        expect(result.failed.single.message, contains('pendiente'));
      },
    );
  });
}

/// La poda corre en segundo plano (E/S real de ficheros): se espera a que el fichero desaparezca.
Future<void> _waitUntilGone(Future<bool> Function() exists) async {
  for (var i = 0; i < 200 && await exists(); i += 1) {
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

Song _song(String id, {bool local = false}) => Song(
  id: id,
  title: id,
  artist: '',
  year: null,
  tags: const [],
  folderId: null,
  durationS: 1,
  license: 'x',
  audio: 'audio/$id.opus',
  local: local,
);

/// Convierte el primero y pide parar: el segundo queda pendiente.
class _CancellingConverter implements AudioConverter {
  LocalAudioLibrary? library;

  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) async {
    await File(outputPath).writeAsBytes([1, 2, 3]);
    await library?.cancelImport();
    return const ConvertedAudio(
      durationS: 1,
      channels: 1,
      bitrate: 32000,
      bytes: 3,
    );
  }

  @override
  Future<void> cancel() async {}
}
