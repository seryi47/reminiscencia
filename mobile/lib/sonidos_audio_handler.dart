import 'dart:async';

import 'package:audio_service/audio_service.dart';
import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';

import 'app_error.dart';
import 'library_store.dart';
import 'playback.dart';
import 'song.dart';

/// Reproductor en segundo plano con controles del sistema y el contrato [PlaybackPort] para la interfaz.
/// Si la canción está guardada se reproduce desde el fichero local; si no, se transmite
/// y se guarda mientras suena (LockCachingAudioSource), así la siguiente vez funciona sin conexión.
class SonidosAudioHandler extends BaseAudioHandler
    with QueueHandler, SeekHandler
    implements PlaybackPort {
  SonidosAudioHandler(this._store) {
    _player.playbackEventStream.listen(
      (_) => _broadcastState(),
      onError: (Object error, StackTrace stackTrace) => _reportError(error),
    );
    _player.playingStream.listen((_) => _publish());
    _player.currentIndexStream.listen((index) {
      final items = queue.value;
      if (index != null && index >= 0 && index < items.length) {
        mediaItem.add(items[index]);
      }
      _publish();
    });
    unawaited(_configureSession());
  }

  final LibraryStore _store;
  final AudioPlayer _player = AudioPlayer();
  final ValueNotifier<NowPlaying> _now = ValueNotifier<NowPlaying>(
    NowPlaying.none,
  );
  final ValueNotifier<String?> _error = ValueNotifier<String?>(null);
  List<String> _queueIds = const [];
  Future<void> _serial = Future<void>.value();

  @override
  ValueListenable<NowPlaying> get nowPlaying => _now;

  @override
  ValueListenable<String?> get playbackError => _error;

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
          ),
        )
        .toList();
    queue.add(items);
    try {
      final sources = <AudioSource>[];
      for (final song in songs) {
        final file = await _store.audioFile(song);
        if (await file.exists()) {
          sources.add(AudioSource.file(file.path, tag: song.id));
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
    } catch (error) {
      queue.add(const []);
      mediaItem.add(null);
      _queueIds = const [];
      _publish();
      throw AppException(describePlayerError(error));
    }
    _queueIds = [for (final song in songs) song.id];
    mediaItem.add(items.first);
    _publish();
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

  @override
  Future<void> playPrevious() => _guard(_player.seekToPrevious);

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
    );
    if (now != _now.value) _now.value = now;
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
      ),
    );
    _publish();
  }
}

/// Texto para el usuario de un error del reproductor o de la preparación del audio.
String describePlayerError(Object error) {
  if (error is AppException) return error.message;
  if (error is PlayerException) return error.message ?? 'código ${error.code}';
  if (error is PlayerInterruptedException) {
    return 'la orden se interrumpió; vuelve a intentarlo';
  }
  return 'error inesperado ($error)';
}
