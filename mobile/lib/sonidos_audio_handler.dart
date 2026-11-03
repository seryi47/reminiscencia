import 'dart:async';
import 'dart:io';

import 'package:audio_service/audio_service.dart';
import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';

import 'app_error.dart';
import 'covers.dart';
import 'library_store.dart';
import 'playback.dart';
import 'playback_plan.dart';
import 'song.dart';

/// Reproductor en segundo plano con controles del sistema y el contrato [PlaybackPort] para la interfaz.
/// Si la canción está guardada se reproduce desde el fichero local; si no, se transmite
/// y se guarda mientras suena (LockCachingAudioSource), así la siguiente vez funciona sin conexión.
class SonidosAudioHandler extends BaseAudioHandler
    with QueueHandler, SeekHandler
    implements PlaybackPort {
  SonidosAudioHandler(this._store, [this._covers]) {
    _player.playbackEventStream.listen(
      (_) => _broadcastState(),
      onError: (Object error, StackTrace stackTrace) => _onPlaybackError(error),
    );
    _player.playingStream.listen((_) => _publish());
    // Aleatorio, repetir y saltos de posición (por ejemplo, al repetir una canción) cambian lo que se ve.
    _player.shuffleModeEnabledStream.listen((_) => _broadcastState());
    _player.loopModeStream.listen((_) => _broadcastState());
    _player.positionDiscontinuityStream.listen((_) => _broadcastState());
    _player.currentIndexStream.listen((index) {
      final items = queue.value;
      if (index != null && index >= 0 && index < items.length) {
        mediaItem.add(items[index]);
        _fillArtwork(index);
      }
      _publish();
    });
    unawaited(_configureSession());
  }

  final LibraryStore _store;

  /// Portadas guardadas: la notificación usa el fichero local (file://), nunca descarga por su cuenta.
  final CoverCache? _covers;
  final AudioPlayer _player = AudioPlayer();
  final ValueNotifier<NowPlaying> _now = ValueNotifier<NowPlaying>(
    NowPlaying.none,
  );
  final ValueNotifier<PlaybackProgress> _progress =
      ValueNotifier<PlaybackProgress>(PlaybackProgress.zero);
  final ValueNotifier<String?> _error = ValueNotifier<String?>(null);
  List<String> _queueIds = const [];
  // Canciones de la cola cargada y si cada una puede sonar sin red (local o ya guardada).
  List<Song> _queueSongs = const [];
  List<bool> _playableOffline = const [];
  Future<void> _serial = Future<void>.value();

  @override
  ValueListenable<NowPlaying> get nowPlaying => _now;

  @override
  ValueListenable<PlaybackProgress> get progress => _progress;

  @override
  ValueListenable<String?> get playbackError => _error;

  @override
  Set<String> get queueSongIds => _queueIds.toSet();

  /// Error de un elemento de la cola. Si es la canción que suena y no se puede reproducir sin red,
  /// se pasa a la siguiente sin cerrar la reproducción. Un error de un elemento que no suena (precarga) se ignora.
  void _onPlaybackError(Object error) {
    final failed =
        (error is PlayerException ? error.index : null) ?? _player.currentIndex;
    if (failed == null || failed != _player.currentIndex) {
      debugPrint('reproductor: error de un elemento que no suena: $error');
      return;
    }
    if (failed < 0 ||
        failed >= _playableOffline.length ||
        _playableOffline[failed]) {
      _reportError(error);
      return;
    }
    unawaited(_skipUnavailable(failed));
  }

  Future<void> _skipUnavailable(int index) async {
    final title = _queueSongs[index].title;
    final next = nextAvailableIndex(_playableOffline, index);
    try {
      if (next != null) {
        await _player.seek(Duration.zero, index: next);
        _startPlayback();
      }
    } catch (error) {
      _reportError(error);
    }
    // Se muestra después de arrancar, porque _startPlayback limpia el error anterior.
    _error.value = next == null
        ? '«$title» no está guardada y no hay conexión. No quedan canciones que sonar sin conexión.'
        : '«$title» no está guardada y no hay conexión. Paso a la siguiente.';
  }

  Future<void> _configureSession() async {
    try {
      final session = await AudioSession.instance;
      await session.configure(const AudioSessionConfiguration.music());
    } catch (error) {
      _reportError(error);
    }
  }

  /// Las operaciones de cola se ejecutan una detrás de otra, para que dos toques seguidos no se pisen.
  Future<T> _exclusive<T>(Future<T> Function() operation) {
    final run = _serial.then((_) => operation());
    _serial = run.then<void>((_) {}, onError: (Object error) {});
    return run;
  }

  @override
  Future<void> loadQueue(List<Song> songs) =>
      _exclusive(() => _loadQueue(songs));

  Future<void> _loadQueue(List<Song> songs) async {
    if (songs.isEmpty) {
      throw const AppException('La biblioteca no tiene canciones.');
    }
    final items = songs
        .map(
          (song) => MediaItem(
            id: song.id,
            title: song.title,
            artist: song.artist.isEmpty ? null : song.artist,
            album: 'Reminiscencia',
            duration: Duration(milliseconds: (song.durationS * 1000).round()),
            artUri: _artUriOf(song),
          ),
        )
        .toList();
    queue.add(items);
    try {
      final sources = <AudioSource>[];
      final playable = <bool>[];
      for (final song in songs) {
        // Las canciones locales (ADR-0013) tienen su fichero en `audio` y nunca se transmiten.
        final file = song.local
            ? File(song.audio)
            : await _store.audioFile(song);
        final cached = await file.exists();
        playable.add(playableOffline(song: song, cached: cached));
        if (cached) {
          sources.add(AudioSource.file(file.path, tag: song.id));
        } else if (song.local) {
          throw AppException(
            'Falta el archivo de «${song.title}». Bórrala de la lista y vuelve a añadirla.',
          );
        } else {
          // LockCachingAudioSource (experimental en just_audio 0.10) transmite y guarda a la vez.
          sources.add(
            // ignore: experimental_member_use
            LockCachingAudioSource(
              _store.audioUri(song),
              cacheFile: file,
              tag: song.id,
            ),
          );
        }
      }
      await _player.setAudioSources(sources);
      _playableOffline = playable;
    } catch (error) {
      queue.add(const []);
      mediaItem.add(null);
      _queueIds = const [];
      _queueSongs = const [];
      _playableOffline = const [];
      _publish();
      throw AppException(describePlayerError(error));
    }
    _queueSongs = songs;
    _queueIds = [for (final song in songs) song.id];
    mediaItem.add(items.first);
    _fillArtwork(0);
    _publish();
  }

  Uri? _artUriOf(Song song) {
    final file = _covers?.fileFor(song.cover);
    return file == null ? null : Uri.file(file.path);
  }

  /// Si la canción que suena tiene portada pero aún no está guardada, la descarga una vez y la pone
  /// en la notificación. Si mientras tanto cambió de canción, no toca nada.
  void _fillArtwork(int index) {
    final covers = _covers;
    if (covers == null ||
        index >= _queueSongs.length ||
        index >= queue.value.length) {
      return;
    }
    final song = _queueSongs[index];
    final cover = song.cover;
    final item = queue.value[index];
    if (cover == null || item.id != song.id || item.artUri != null) return;
    unawaited(
      covers.ensure(cover).then((ok) {
        final art = ok ? _artUriOf(song) : null;
        if (art == null) return;
        final items = [...queue.value];
        final at = items.indexWhere((item) => item.id == song.id);
        if (at < 0) return;
        items[at] = items[at].copyWith(artUri: art);
        queue.add(items);
        if (mediaItem.value?.id == song.id) mediaItem.add(items[at]);
      }),
    );
  }

  @override
  Future<void> playAt(List<Song> songs, int index) => _exclusive(() async {
    if (index < 0 || index >= songs.length) {
      throw const AppException('Esa canción ya no está disponible.');
    }
    if (!_sameQueue(songs)) await _loadQueue(songs);
    try {
      await _player.seek(Duration.zero, index: index);
    } catch (error) {
      throw AppException(describePlayerError(error));
    }
    _startPlayback();
  });

  /// Arranca la reproducción sin esperar a que termine la canción (el Future de just_audio dura hasta el final).
  void _startPlayback() {
    _error.value = null;
    unawaited(_player.play().catchError((Object error) => _reportError(error)));
  }

  @override
  Future<void> togglePlayPause() async {
    if (_player.playing) {
      await _guard(_player.pause);
      return;
    }
    if (_queueIds.isEmpty) {
      throw const AppException('Elige una canción primero.');
    }
    _startPlayback();
  }

  @override
  Future<void> playNext() => _guard(_player.seekToNext);

  /// Como en cualquier reproductor: pasados unos segundos, «Anterior» vuelve al principio de la canción.
  @override
  Future<void> playPrevious() => _guard(() {
    if (_player.position > kRestartThreshold || !_player.hasPrevious) {
      return _player.seek(Duration.zero);
    }
    return _player.seekToPrevious();
  });

  @override
  Future<void> play() async {
    if (_queueIds.isEmpty) return;
    _startPlayback();
  }

  @override
  Future<void> pause() => _guard(_player.pause);

  @override
  Future<void> stop() async {
    await _player.stop();
    await super.stop();
  }

  @override
  Future<void> skipToNext() => playNext();

  @override
  Future<void> skipToPrevious() => playPrevious();

  @override
  Future<void> skipToQueueItem(int index) async {
    await _guard(() => _player.seek(Duration.zero, index: index));
    _startPlayback();
  }

  @override
  Future<void> seek(Duration position) => _guard(() => _player.seek(position));

  @override
  Future<void> setShuffle(bool enabled) => _guard(() async {
    // Al activarlo se baraja de nuevo, como en cualquier reproductor.
    if (enabled) await _player.shuffle();
    await _player.setShuffleModeEnabled(enabled);
  });

  @override
  Future<void> setRepeat(LoopSetting mode) => _guard(
    () => _player.setLoopMode(switch (mode) {
      LoopSetting.off => LoopMode.off,
      LoopSetting.all => LoopMode.all,
      LoopSetting.one => LoopMode.one,
    }),
  );

  // Controles del sistema (notificación, auriculares, Android Auto) para aleatorio y repetir.
  @override
  Future<void> setShuffleMode(AudioServiceShuffleMode shuffleMode) =>
      setShuffle(shuffleMode != AudioServiceShuffleMode.none);

  @override
  Future<void> setRepeatMode(AudioServiceRepeatMode repeatMode) =>
      setRepeat(switch (repeatMode) {
        AudioServiceRepeatMode.none => LoopSetting.off,
        AudioServiceRepeatMode.one => LoopSetting.one,
        AudioServiceRepeatMode.all ||
        AudioServiceRepeatMode.group => LoopSetting.all,
      });

  bool _sameQueue(List<Song> songs) {
    if (songs.length != _queueIds.length) return false;
    for (var i = 0; i < songs.length; i++) {
      if (songs[i].id != _queueIds[i]) return false;
    }
    return true;
  }

  /// Ejecuta una orden del reproductor y convierte cualquier fallo en un AppException con motivo.
  Future<void> _guard(Future<void> Function() action) async {
    try {
      await action();
    } catch (error) {
      throw AppException(describePlayerError(error));
    }
  }

  void _reportError(Object error) {
    debugPrint('reproductor: $error');
    // Cambiar de canción deprisa interrumpe la anterior: no es un fallo que deba ver el usuario.
    if (error is PlayerInterruptedException) return;
    _error.value = describePlayerError(error);
  }

  /// Recalcula lo que ve la interfaz a partir de la canción actual y del estado del reproductor.
  void _publish() {
    final item = mediaItem.value;
    final state = _player.processingState;
    final now = NowPlaying(
      songId: item?.id,
      title: item?.title ?? '',
      artist: item?.artist ?? '',
      playing: _player.playing,
      buffering:
          state == ProcessingState.loading ||
          state == ProcessingState.buffering,
      shuffle: _player.shuffleModeEnabled,
      repeat: _repeatOf(_player.loopMode),
    );
    if (now != _now.value) _now.value = now;
  }

  static LoopSetting _repeatOf(LoopMode mode) => switch (mode) {
    LoopMode.off => LoopSetting.off,
    LoopMode.all => LoopSetting.all,
    LoopMode.one => LoopSetting.one,
  };

  /// Publica la posición solo cuando el reproductor informa de un cambio (sin sondeos):
  /// la interfaz la extrapola mientras está a la vista.
  void _publishProgress() {
    final duration = _player.duration ?? mediaItem.value?.duration;
    _progress.value = PlaybackProgress(
      position: _player.position,
      duration: duration ?? Duration.zero,
      playing: _player.playing,
      speed: _player.speed,
      updatedAt: DateTime.now(),
    );
  }

  void _broadcastState() {
    final playing = _player.playing;
    playbackState.add(
      playbackState.value.copyWith(
        controls: [
          MediaControl.skipToPrevious,
          if (playing) MediaControl.pause else MediaControl.play,
          MediaControl.skipToNext,
        ],
        systemActions: const {
          MediaAction.seek,
          MediaAction.skipToNext,
          MediaAction.skipToPrevious,
          MediaAction.skipToQueueItem,
          MediaAction.setShuffleMode,
          MediaAction.setRepeatMode,
        },
        androidCompactActionIndices: const [0, 1, 2],
        processingState: AudioProcessingState.values.byName(
          _player.processingState.name,
        ),
        playing: playing,
        updatePosition: _player.position,
        bufferedPosition: _player.bufferedPosition,
        speed: _player.speed,
        queueIndex: _player.currentIndex,
        shuffleMode: _player.shuffleModeEnabled
            ? AudioServiceShuffleMode.all
            : AudioServiceShuffleMode.none,
        repeatMode: switch (_player.loopMode) {
          LoopMode.off => AudioServiceRepeatMode.none,
          LoopMode.all => AudioServiceRepeatMode.all,
          LoopMode.one => AudioServiceRepeatMode.one,
        },
      ),
    );
    _publish();
    _publishProgress();
  }
}

/// A partir de esta posición, «Anterior» reinicia la canción en lugar de ir a la anterior.
const Duration kRestartThreshold = Duration(seconds: 3);

/// Texto para el usuario de un error del reproductor o de la preparación del audio.
String describePlayerError(Object error) {
  if (error is AppException) return error.message;
  if (error is PlayerException) return error.message ?? 'código ${error.code}';
  if (error is PlayerInterruptedException) {
    return 'la orden se interrumpió; vuelve a intentarlo';
  }
  return 'error inesperado ($error)';
}
