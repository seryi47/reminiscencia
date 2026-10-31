import 'package:audio_service/audio_service.dart';
import 'package:audio_session/audio_session.dart';
import 'package:just_audio/just_audio.dart';

import 'library_store.dart';
import 'song.dart';

/// Reproductor en segundo plano con controles del sistema.
/// Si la canción está guardada se reproduce desde el fichero local; si no, se transmite
/// y se guarda mientras suena (LockCachingAudioSource), así la siguiente vez funciona sin conexión.
class SonidosAudioHandler extends BaseAudioHandler with QueueHandler, SeekHandler {
  SonidosAudioHandler(this._store) {
    _player.playbackEventStream.listen((_) => _broadcastState());
    _player.currentIndexStream.listen((index) {
      final items = queue.value;
      if (index != null && index >= 0 && index < items.length) mediaItem.add(items[index]);
    });
    _configureSession();
  }

  final LibraryStore _store;
  final AudioPlayer _player = AudioPlayer();

  Future<void> _configureSession() async {
    final session = await AudioSession.instance;
    await session.configure(const AudioSessionConfiguration.music());
  }

  Future<void> loadSongs(List<Song> songs) async {
    final items = songs
        .map((song) => MediaItem(
              id: song.id,
              title: song.title,
              artist: song.artist.isEmpty ? null : song.artist,
              album: 'Reminiscencia',
              duration: Duration(milliseconds: (song.durationS * 1000).round()),
            ))
        .toList();
    queue.add(items);

    final sources = <AudioSource>[];
    for (final song in songs) {
      final file = await _store.audioFile(song);
      if (await file.exists()) {
        sources.add(AudioSource.file(file.path, tag: song.id));
      } else {
        // LockCachingAudioSource (experimental en just_audio 0.10) transmite y guarda a la vez.
        // ignore: experimental_member_use
        sources.add(LockCachingAudioSource(_store.audioUri(song), cacheFile: file, tag: song.id));
      }
    }
    await _player.setAudioSources(sources);
    if (items.isNotEmpty) mediaItem.add(items.first);
  }

  @override
  Future<void> play() => _player.play();

  @override
  Future<void> pause() => _player.pause();

  @override
  Future<void> stop() async {
    await _player.stop();
    await super.stop();
  }

  @override
  Future<void> skipToNext() => _player.seekToNext();

  @override
  Future<void> skipToPrevious() => _player.seekToPrevious();

  @override
  Future<void> skipToQueueItem(int index) async {
    await _player.seek(Duration.zero, index: index);
    await _player.play();
  }

  @override
  Future<void> seek(Duration position) => _player.seek(position);

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
        processingState: AudioProcessingState.values.byName(_player.processingState.name),
        playing: playing,
        updatePosition: _player.position,
        bufferedPosition: _player.bufferedPosition,
        speed: _player.speed,
        queueIndex: _player.currentIndex,
      ),
    );
  }
}
