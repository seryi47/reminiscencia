import 'package:audio_service/audio_service.dart';
import 'package:audio_session/audio_session.dart';
import 'package:just_audio/just_audio.dart';

import 'song.dart';

/// Reproductor en segundo plano con controles multimedia del sistema.
///
/// Usa un ConcatenatingAudioSource para que just_audio gestione el paso a la
/// siguiente pista y el orden de la lista. audio_session gestiona interrupciones
/// (llamadas, otras apps con audio) y la desconexión de auriculares.
class SonidosAudioHandler extends BaseAudioHandler with QueueHandler, SeekHandler {
  SonidosAudioHandler() {
    _player.playbackEventStream.listen((_) => _broadcastState());
    _player.currentIndexStream.listen((index) {
      final items = queue.value;
      if (index != null && index >= 0 && index < items.length) {
        mediaItem.add(items[index]);
      }
    });
    _configureSession();
  }

  final AudioPlayer _player = AudioPlayer();

  Future<void> _configureSession() async {
    final session = await AudioSession.instance;
    await session.configure(const AudioSessionConfiguration.music());
  }

  /// Carga la biblioteca completa. La reproducción empieza en pausa.
  Future<void> loadSongs(List<Song> songs) async {
    final items = songs
        .map(
          (song) => MediaItem(
            id: song.assetPath,
            title: song.title,
            album: 'Canciones para recordar',
            duration: Duration(milliseconds: (song.durationS * 1000).round()),
          ),
        )
        .toList();
    queue.add(items);

    await _player.setAudioSources(
      songs.map((song) => AudioSource.asset(song.assetPath)).toList(),
    );
    if (items.isNotEmpty) {
      mediaItem.add(items.first);
    }
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
