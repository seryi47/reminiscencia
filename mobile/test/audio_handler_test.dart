import 'dart:io';

import 'package:audio_service/audio_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart';
import 'package:reminiscencia/library_store.dart';
import 'package:reminiscencia/playback.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/sonidos_audio_handler.dart';

import 'support/fake_audio_player.dart';
import 'support/fakes.dart';

/// El reproductor real (SonidosAudioHandler) con just_audio simulado: arranque, cola, errores, parones y cierre.
void main() {
  late Directory root;
  late LibraryStore store;
  late FakeAudioPlayer player;
  late SonidosAudioHandler handler;
  final songs = [for (var i = 0; i < 4; i++) fakeSong('s$i')];

  Future<void> download(Song song) async =>
      (await store.audioFile(song)).writeAsBytes([1, 2, 3]);

  /// Deja que terminen las operaciones encadenadas del handler (cola de órdenes y temporizadores cortos).
  Future<void> drain([Duration wait = const Duration(milliseconds: 20)]) =>
      Future<void>.delayed(wait);

  SonidosAudioHandler build({
    Duration idleStopAfter = kIdleStopAfter,
    Duration stallTimeout = kStallTimeout,
  }) => SonidosAudioHandler(
    store,
    player: player,
    configureSession: false,
    idleStopAfter: idleStopAfter,
    stallTimeout: stallTimeout,
  );

  setUp(() async {
    root = await Directory.systemTemp.createTemp('reproductor');
    store = LibraryStore(root: () async => root);
    player = FakeAudioPlayer();
    handler = build();
  });

  tearDown(() async {
    await handler.stop();
    await root.delete(recursive: true);
  });

  group('servicio en primer plano (causa del cierre en segundo plano)', () {
    test(
      'el servicio sigue en primer plano en pausa y la notificación no es «ongoing»',
      () {
        // Con androidStopForegroundOnPause: true, reanudar tras una llamada exigía arrancar el servicio en primer
        // plano desde segundo plano, prohibido en Android 12+.
        expect(kAudioServiceConfig.androidStopForegroundOnPause, isFalse);
        expect(kAudioServiceConfig.androidNotificationOngoing, isFalse);
        expect(
          kAudioServiceConfig.androidNotificationChannelId,
          'es.orbitalabs.reminiscencia.audio',
        );
        expect(kIdleStopAfter, const Duration(minutes: 15));
        expect(kStallTimeout, const Duration(seconds: 15));
      },
    );

    test('con cola activa nunca se publica idle al servicio', () {
      expect(
        serviceProcessingState(
          ProcessingState.idle,
          active: true,
          playing: true,
        ),
        AudioProcessingState.buffering,
      );
      expect(
        serviceProcessingState(
          ProcessingState.idle,
          active: true,
          playing: false,
        ),
        AudioProcessingState.ready,
      );
      expect(
        serviceProcessingState(
          ProcessingState.idle,
          active: false,
          playing: false,
        ),
        AudioProcessingState.idle,
      );
      expect(
        serviceProcessingState(
          ProcessingState.ready,
          active: true,
          playing: true,
        ),
        AudioProcessingState.ready,
      );
    });

    test(
      'un error que se reintenta o se salta no publica idle (no para el servicio)',
      () async {
        final states = <AudioProcessingState>[];
        handler.playbackState.listen(
          (state) => states.add(state.processingState),
        );
        await download(songs[2]);
        await handler.playAt(songs, 0);
        states.clear();

        player.fail(0);
        await drain();

        expect(states, isNotEmpty);
        expect(states, isNot(contains(AudioProcessingState.idle)));
        expect(handler.nowPlaying.value.songId, isNotNull);
      },
    );
  });

  group('arranque en frío', () {
    test('al crear el reproductor no hay canción, cola ni carga', () {
      expect(handler.nowPlaying.value, NowPlaying.none);
      expect(handler.nowPlaying.value.songId, isNull);
      expect(handler.queueSongIds, isEmpty);
      expect(handler.mediaItem.value, isNull);
      expect(player.loads, isEmpty);
    });

    test('tocar una canción la carga y suena desde el primer toque', () async {
      await handler.playAt(songs, 1);
      expect(player.loads, hasLength(1));
      expect(handler.nowPlaying.value.songId, 's1');
      expect(player.playing, isTrue);
      await handler.togglePlayPause();
      expect(player.playing, isFalse);
      await handler.togglePlayPause();
      expect(player.playing, isTrue);
    });

    test(
      'stop() deja el reproductor vacío: sin canción, sin cola y estado idle',
      () async {
        await handler.playAt(songs, 1);
        await handler.stop();
        expect(handler.nowPlaying.value.songId, isNull);
        expect(handler.queueSongIds, isEmpty);
        expect(handler.mediaItem.value, isNull);
        expect(handler.queue.value, isEmpty);
        expect(handler.progress.value, PlaybackProgress.zero);
        expect(
          handler.playbackState.value.processingState,
          AudioProcessingState.idle,
        );
        // Volver a tocar una canción funciona como la primera vez.
        await handler.playAt(songs, 2);
        expect(handler.nowPlaying.value.songId, 's2');
      },
    );

    test('al quitar la app de recientes también queda vacío', () async {
      await handler.playAt(songs, 0);
      await handler.onTaskRemoved();
      expect(handler.nowPlaying.value.songId, isNull);
    });
  });

  group('cola sin red', () {
    test(
      'la canción tocada se prepara primero (initialIndex), no la primera de la lista',
      () async {
        await download(songs[2]);
        await handler.playAt(songs, 2);
        final load = player.loads.single;
        expect(load.initialIndex, 2);
        expect(load.initialPosition, Duration.zero);
        expect(load.streamedAt(2), isFalse);
        expect(load.uriAt(2).scheme, 'file');
        expect(load.streamedAt(0), isTrue, reason: 's0 no está guardada');
        expect(handler.nowPlaying.value.songId, 's2');
      },
    );

    test(
      'sin red, una canción no guardada se salta a la siguiente guardada sin romper la cola',
      () async {
        await download(songs[3]);
        await handler.playAt(songs, 1);

        // s1 se transmitía: falla, y fallan también sus otras direcciones (r2.dev y la web).
        player.fail(1);
        await drain();
        expect(player.loads.last.initialIndex, 1);
        expect(
          player.loads.last.uriAt(1).host,
          isNot(player.loads.first.uriAt(1).host),
        );
        player.fail(1);
        await drain();

        // Agotadas, salta a s3 (la siguiente guardada; s2 tampoco está) y suena desde el fichero.
        final last = player.loads.last;
        expect(last.initialIndex, 3);
        expect(last.uriAt(3).scheme, 'file');
        expect(handler.nowPlaying.value.songId, 's3');
        expect(player.playing, isTrue);
        expect(handler.playbackError.value, contains('Paso a la siguiente'));
      },
    );

    test(
      'si la tocada falla al prepararse, playAt no lanza y el camino de error decide',
      () async {
        await download(songs[2]);
        player.failingIndexes.add(0);
        await handler.playAt(songs, 0);
        // Fallan también sus otras direcciones: se salta a la siguiente guardada.
        await drain();
        expect(player.loads.last.initialIndex, 2);
        expect(handler.nowPlaying.value.songId, 's2');
      },
    );

    test('si no queda nada que pueda sonar, pausa y lo dice', () async {
      await handler.playAt(songs, 3);
      player.fail(3);
      await drain();
      player.fail(3);
      await drain();
      expect(player.playing, isFalse);
      expect(handler.playbackError.value, contains('No quedan canciones'));
      // La canción sigue a la vista (en pausa) y el servicio no recibe idle.
      expect(handler.nowPlaying.value.songId, 's3');
      expect(
        handler.playbackState.value.processingState,
        isNot(AudioProcessingState.idle),
      );
    });
  });

  group('lo descargado suena siempre desde el fichero', () {
    test(
      'una canción que termina de descargarse con la cola ya cargada sigue desde el fichero en el mismo punto',
      () async {
        await handler.playAt(songs, 0);
        expect(player.loads.single.streamedAt(0), isTrue);
        await download(songs[0]);
        player.setState(
          ProcessingState.ready,
          position: const Duration(seconds: 42),
        );

        player.fail(0, 'la red se cortó');
        await drain();

        final last = player.loads.last;
        expect(last.initialIndex, 0);
        expect(last.initialPosition, const Duration(seconds: 42));
        expect(last.uriAt(0).scheme, 'file');
        expect(player.playing, isTrue);
      },
    );

    test(
      'cada carga vuelve a mirar lo guardado: las demás de la cola también pasan a fichero',
      () async {
        await handler.playAt(songs, 0);
        await download(songs[1]);
        await download(songs[2]);
        player.fail(0);
        await drain();
        expect(player.loads.last.uriAt(1).scheme, 'file');
        expect(player.loads.last.uriAt(2).scheme, 'file');
      },
    );
  });

  group('vigilante de parones (solo lo que llega por la red)', () {
    setUp(() {
      handler = build(stallTimeout: const Duration(milliseconds: 40));
    });

    test(
      'parada esperando datos: reintenta una vez en el mismo punto y después va al camino de error',
      () async {
        await handler.playAt(songs, 0);
        final loads = player.loads.length;
        player.setState(
          ProcessingState.buffering,
          position: const Duration(seconds: 30),
        );
        await drain(const Duration(milliseconds: 80));

        expect(player.loads.length, loads + 1, reason: 'un reintento');
        expect(player.loads.last.initialPosition, const Duration(seconds: 30));
        expect(
          player.loads.last.uriAt(0),
          player.loads.first.uriAt(0),
          reason: 'misma dirección',
        );

        // Sigue parada: ahora es un error (siguiente dirección del audio), no otro reintento igual.
        player.setState(
          ProcessingState.buffering,
          position: const Duration(seconds: 30),
        );
        await drain(const Duration(milliseconds: 80));
        expect(player.loads.length, loads + 2);
        expect(
          player.loads.last.uriAt(0).host,
          isNot(player.loads.first.uriAt(0).host),
        );
      },
    );

    test('no actúa con las canciones guardadas ni en pausa', () async {
      await download(songs[0]);
      await handler.playAt(songs, 0);
      player.setState(ProcessingState.buffering);
      await drain(const Duration(milliseconds: 80));
      expect(player.loads, hasLength(1));

      await handler.playAt(songs, 1); // s1 se transmite
      await handler.pause();
      final loads = player.loads.length;
      player.setState(ProcessingState.buffering);
      await drain(const Duration(milliseconds: 80));
      expect(player.loads.length, loads);
    });
  });

  group('cierre por inactividad', () {
    setUp(() {
      handler = build(idleStopAfter: const Duration(milliseconds: 40));
    });

    test(
      'en pausa más de lo indicado se para y libera todo; sonando, no',
      () async {
        await download(songs[0]);
        await handler.playAt(songs, 0);
        await drain(const Duration(milliseconds: 80));
        expect(
          handler.nowPlaying.value.songId,
          's0',
          reason: 'sonando no se cierra',
        );

        await handler.pause();
        await drain(const Duration(milliseconds: 20));
        expect(handler.nowPlaying.value.songId, 's0', reason: 'aún no');
        await drain(const Duration(milliseconds: 60));
        expect(handler.nowPlaying.value.songId, isNull);
        expect(
          handler.playbackState.value.processingState,
          AudioProcessingState.idle,
        );
        expect(player.log, contains('stop'));
      },
    );

    test('volver a sonar antes de tiempo cancela el cierre', () async {
      await download(songs[0]);
      await handler.playAt(songs, 0);
      await handler.pause();
      await drain(const Duration(milliseconds: 20));
      await handler.togglePlayPause();
      await drain(const Duration(milliseconds: 60));
      expect(handler.nowPlaying.value.songId, 's0');
      expect(player.log, isNot(contains('stop')));
    });
  });
}
