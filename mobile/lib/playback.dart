import 'package:flutter/foundation.dart';

import 'song.dart';

/// Lo que la interfaz muestra del reproductor. No depende de audio_service,
/// así las pruebas de interfaz pueden usar un reproductor falso.
@immutable
class NowPlaying {
  const NowPlaying({
    this.songId,
    this.title = '',
    this.artist = '',
    this.playing = false,
    this.buffering = false,
  });

  static const NowPlaying none = NowPlaying();

  /// Id de la canción cargada, o null si no hay ninguna.
  final String? songId;
  final String title;
  final String artist;
  final bool playing;
  final bool buffering;

  @override
  bool operator ==(Object other) =>
      other is NowPlaying &&
      other.songId == songId &&
      other.title == title &&
      other.artist == artist &&
      other.playing == playing &&
      other.buffering == buffering;

  @override
  int get hashCode => Object.hash(songId, title, artist, playing, buffering);
}

/// Contrato entre la interfaz y el reproductor. La implementación real es SonidosAudioHandler.
abstract interface class PlaybackPort {
  /// Canción actual y si está sonando.
  ValueListenable<NowPlaying> get nowPlaying;

  /// Último error de reproducción, o null. Se limpia al volver a reproducir.
  ValueListenable<String?> get playbackError;

  /// Prepara la cola con estas canciones sin empezar a sonar.
  /// Lanza AppException con el motivo si no se puede.
  Future<void> loadQueue(List<Song> songs);

  /// Reproduce la canción [index] de [songs]; si la cola no es esa, la recarga.
  /// Lanza AppException si no se puede reproducir.
  Future<void> playAt(List<Song> songs, int index);

  Future<void> togglePlayPause();

  Future<void> playNext();

  Future<void> playPrevious();
}
