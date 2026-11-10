// ignore_for_file: experimental_member_use

import 'dart:async';

import 'package:just_audio/just_audio.dart';

/// Una carga de fuentes que pidió el handler: qué fuentes, desde qué canción y en qué punto.
class LoadCall {
  LoadCall(this.sources, this.initialIndex, this.initialPosition);

  final List<AudioSource> sources;
  final int? initialIndex;
  final Duration? initialPosition;

  /// Dirección de la fuente [index]: `file://…` si suena desde el fichero, la de la red si se transmite.
  Uri uriAt(int index) => switch (sources[index]) {
    final LockCachingAudioSource source => source.uri,
    final UriAudioSource source => source.uri,
    _ => throw StateError('fuente inesperada'),
  };

  bool streamedAt(int index) => sources[index] is LockCachingAudioSource;
}

/// Reproductor falso con la misma forma que just_audio 0.10, para probar SonidosAudioHandler sin plataforma.
/// Como el real: tras un error queda en `idle` con `playing` como estaba, y solo una carga nueva lo prepara.
class FakeAudioPlayer implements AudioPlayer {
  final _events = StreamController<PlaybackEvent>.broadcast(sync: true);
  final _errors = StreamController<PlayerException>.broadcast(sync: true);
  final _playing = StreamController<bool>.broadcast(sync: true);
  final _index = StreamController<int?>.broadcast(sync: true);

  final List<LoadCall> loads = [];
  final List<String> log = [];

  /// Índices cuya carga falla (la canción no se puede preparar): setAudioSources lanza y se avisa por errorStream.
  /// Buscar uno de ellos, como en just_audio, no acaba nunca: falla y el Future de seek se queda esperando.
  final Set<int> failingIndexes = {};

  ProcessingState _state = ProcessingState.idle;
  bool _isPlaying = false;
  int? _currentIndex;
  Duration _position = Duration.zero;

  @override
  Stream<PlaybackEvent> get playbackEventStream => _events.stream;

  @override
  Stream<PlayerException> get errorStream => _errors.stream;

  @override
  Stream<bool> get playingStream => _playing.stream;

  @override
  Stream<int?> get currentIndexStream => _index.stream;

  @override
  Stream<bool> get shuffleModeEnabledStream => const Stream.empty();

  @override
  Stream<LoopMode> get loopModeStream => const Stream.empty();

  @override
  Stream<PositionDiscontinuity> get positionDiscontinuityStream =>
      const Stream.empty();

  @override
  ProcessingState get processingState => _state;

  @override
  bool get playing => _isPlaying;

  @override
  int? get currentIndex => _currentIndex;

  @override
  Duration get position => _position;

  @override
  Duration get bufferedPosition => _position;

  @override
  Duration? get duration => const Duration(minutes: 3);

  @override
  double get speed => 1.0;

  @override
  bool get shuffleModeEnabled => false;

  @override
  LoopMode get loopMode => LoopMode.off;

  @override
  bool get hasPrevious => (_currentIndex ?? 0) > 0;

  void _emit() => _events.add(
    PlaybackEvent(
      processingState: _state,
      updatePosition: _position,
      currentIndex: _currentIndex,
    ),
  );

  /// Simula un cambio de estado del reproductor nativo.
  void setState(ProcessingState state, {Duration? position}) {
    _state = state;
    if (position != null) _position = position;
    _emit();
  }

  /// Simula un error de la canción que suena: idle y aviso por errorStream, como just_audio 0.10.
  void fail(int index, [String message = 'Source error']) {
    _state = ProcessingState.idle;
    _emit();
    _errors.add(PlayerException(0, message, index));
  }

  @override
  Future<Duration?> setAudioSources(
    List<AudioSource> audioSources, {
    bool preload = true,
    int? initialIndex,
    Duration? initialPosition,
    ShuffleOrder? shuffleOrder,
  }) async {
    loads.add(LoadCall(audioSources, initialIndex, initialPosition));
    _currentIndex = initialIndex ?? 0;
    _position = initialPosition ?? Duration.zero;
    _index.add(_currentIndex);
    if (failingIndexes.contains(_currentIndex)) {
      fail(_currentIndex!);
      throw PlayerException(0, 'Source error', _currentIndex);
    }
    setState(ProcessingState.ready);
    return const Duration(minutes: 3);
  }

  @override
  Future<void> seek(Duration? position, {int? index}) {
    log.add('seek:${index ?? _currentIndex}');
    if (index != null && index != _currentIndex) {
      _currentIndex = index;
      _index.add(index);
    }
    _position = position ?? Duration.zero;
    if (failingIndexes.contains(_currentIndex)) {
      fail(_currentIndex!);
      return Completer<void>().future;
    }
    _emit();
    return Future<void>.value();
  }

  @override
  Future<void> seekToNext() =>
      seek(Duration.zero, index: (_currentIndex ?? 0) + 1);

  @override
  Future<void> play() async {
    log.add('play');
    _isPlaying = true;
    _playing.add(true);
  }

  @override
  Future<void> pause() async {
    log.add('pause');
    _isPlaying = false;
    _playing.add(false);
  }

  @override
  Future<void> stop() async {
    log.add('stop');
    _isPlaying = false;
    _playing.add(false);
    setState(ProcessingState.idle);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
