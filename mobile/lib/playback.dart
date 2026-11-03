import 'package:flutter/foundation.dart';

import 'song.dart';

/// Repetición: nada, toda la cola o solo la canción actual.
/// (No se llama RepeatMode para no chocar con el de Flutter.)
enum LoopSetting { off, all, one }

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
    this.shuffle = false,
    this.repeat = LoopSetting.off,
  });

  static const NowPlaying none = NowPlaying();

  /// Id de la canción cargada, o null si no hay ninguna.
  final String? songId;
  final String title;
  final String artist;
  final bool playing;
  final bool buffering;
  final bool shuffle;
  final LoopSetting repeat;

  NowPlaying copyWith({
    bool? playing,
    bool? buffering,
    bool? shuffle,
    LoopSetting? repeat,
  }) {
    return NowPlaying(
      songId: songId,
      title: title,
      artist: artist,
      playing: playing ?? this.playing,
      buffering: buffering ?? this.buffering,
      shuffle: shuffle ?? this.shuffle,
      repeat: repeat ?? this.repeat,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is NowPlaying &&
      other.songId == songId &&
      other.title == title &&
      other.artist == artist &&
      other.playing == playing &&
      other.buffering == buffering &&
      other.shuffle == shuffle &&
      other.repeat == repeat;

  @override
  int get hashCode =>
      Object.hash(songId, title, artist, playing, buffering, shuffle, repeat);
}

/// Posición de la canción en un instante. No se actualiza en bucle: el reproductor la publica
/// cuando cambia algo (empezar, pausar, saltar, buscar) y la interfaz calcula el resto con [positionAt].
@immutable
class PlaybackProgress {
  const PlaybackProgress({
    this.position = Duration.zero,
    this.duration = Duration.zero,
    this.playing = false,
    this.speed = 1.0,
    this.updatedAt,
  });

  static const PlaybackProgress zero = PlaybackProgress();

  /// Posición en el momento [updatedAt].
  final Duration position;

  /// Duración de la canción. Cero si aún no se conoce.
  final Duration duration;
  final bool playing;
  final double speed;

  /// Momento en que se midió [position]. Null si aún no hay medida.
  final DateTime? updatedAt;

  /// Posición estimada en [now], acotada a la duración.
  Duration positionAt(DateTime now) {
    var result = position;
    final since = updatedAt;
    if (playing && since != null) {
      final elapsed = now.difference(since).inMicroseconds * speed;
      if (elapsed > 0) result += Duration(microseconds: elapsed.round());
    }
    if (duration > Duration.zero && result > duration) return duration;
    if (result < Duration.zero) return Duration.zero;
    return result;
  }

  /// Fracción reproducida (0 a 1) en [now]. Cero si no se conoce la duración.
  double fractionAt(DateTime now) {
    if (duration <= Duration.zero) return 0;
    return (positionAt(now).inMicroseconds / duration.inMicroseconds)
        .clamp(0.0, 1.0)
        .toDouble();
  }

  @override
  bool operator ==(Object other) =>
      other is PlaybackProgress &&
      other.position == position &&
      other.duration == duration &&
      other.playing == playing &&
      other.speed == speed &&
      other.updatedAt == updatedAt;

  @override
  int get hashCode =>
      Object.hash(position, duration, playing, speed, updatedAt);
}

/// Contrato entre la interfaz y el reproductor. La implementación real es SonidosAudioHandler.
abstract interface class PlaybackPort {
  /// Canción actual, si está sonando y los modos aleatorio y repetir.
  ValueListenable<NowPlaying> get nowPlaying;

  /// Posición y duración de la canción actual (ver [PlaybackProgress]).
  ValueListenable<PlaybackProgress> get progress;

  /// Último error de reproducción, o null. Se limpia al volver a reproducir.
  ValueListenable<String?> get playbackError;

  /// Ids de las canciones que están en la cola cargada. Sus ficheros no se borran aunque la web los retire.
  Set<String> get queueSongIds;

  /// Prepara la cola con estas canciones sin empezar a sonar.
  /// Lanza AppException con el motivo si no se puede.
  Future<void> loadQueue(List<Song> songs);

  /// Reproduce la canción [index] de [songs]; si la cola no es esa, la recarga.
  /// Lanza AppException si no se puede reproducir.
  Future<void> playAt(List<Song> songs, int index);

  Future<void> togglePlayPause();

  Future<void> playNext();

  Future<void> playPrevious();

  /// Salta a [position] dentro de la canción actual.
  Future<void> seek(Duration position);

  /// Activa o desactiva el orden aleatorio.
  Future<void> setShuffle(bool enabled);

  /// Cambia el modo de repetición.
  Future<void> setRepeat(LoopSetting mode);
}

/// Siguiente modo al pulsar «Repetir»: no, toda la cola, una canción, y vuelta a empezar.
LoopSetting nextRepeatMode(LoopSetting mode) => switch (mode) {
  LoopSetting.off => LoopSetting.all,
  LoopSetting.all => LoopSetting.one,
  LoopSetting.one => LoopSetting.off,
};
