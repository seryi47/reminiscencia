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
import 'youtube_audio_source.dart';

/// Configuración del servicio de audio (notificación y servicio en primer plano).
///
/// El servicio sigue en primer plano también en pausa (`androidStopForegroundOnPause: false`). Si lo dejara al
/// pausar, volver a sonar sin que el usuario toque nada (al acabar una llamada, just_audio reanuda solo) obligaría a
/// Android a arrancar un servicio en primer plano desde segundo plano, algo que Android 12+ prohíbe
/// (ForegroundServiceStartNotAllowedException, que audio_service se traga): la música seguiría sin servicio ni
/// bloqueo de CPU y el sistema podría matar la app. Para no retener recursos sin fin, el reproductor se cierra solo
/// tras [kIdleStopAfter] sin sonar. `androidNotificationOngoing` debe ser false con esta opción (lo exige
/// audio_service); mientras el servicio está en primer plano, Android ya mantiene la notificación.
const AudioServiceConfig kAudioServiceConfig = AudioServiceConfig(
  androidNotificationChannelId: 'es.orbitalabs.reminiscencia.audio',
  androidNotificationChannelName: 'Reproducción',
  androidNotificationOngoing: false,
  androidStopForegroundOnPause: false,
);

/// Tiempo sin sonar (en pausa, al acabar la cola o tras un error sin salida) tras el que se cierra el reproductor,
/// su servicio y su notificación.
const Duration kIdleStopAfter = Duration(minutes: 15);

/// Si una canción que llega por la red se queda esperando datos este tiempo sin avanzar, se reintenta una vez desde
/// el mismo punto; si sigue parada, se trata como un error. Igual que la web (`STALL_TIMEOUT_MS`, js/player.js).
/// No se aplica a las canciones que suenan desde un fichero del teléfono.
const Duration kStallTimeout = Duration(seconds: 15);

/// Estado que se publica al servicio de audio. Mientras haya una cola activa nunca se publica `idle`: para
/// audio_service, `idle` significa «parar el servicio» (stopSelf), y un error que se está reintentando o saltando
/// (just_audio queda en `idle` tras cualquier error) cerraría el servicio en primer plano mientras la música sigue.
/// Con la reproducción pedida se publica `buffering`; en pausa, `ready`.
AudioProcessingState serviceProcessingState(
  ProcessingState state, {
  required bool active,
  required bool playing,
}) {
  if (state == ProcessingState.idle && active) {
    return playing
        ? AudioProcessingState.buffering
        : AudioProcessingState.ready;
  }
  return AudioProcessingState.values.byName(state.name);
}

/// Si el reproductor está sonando de verdad (o preparándose para sonar enseguida). En pausa, al acabar la cola o
/// parado tras un error, no: es cuando corre el cierre por inactividad.
bool isAudiblyPlaying({
  required bool playing,
  required ProcessingState state,
}) =>
    playing &&
    (state == ProcessingState.ready ||
        state == ProcessingState.buffering ||
        state == ProcessingState.loading);

/// Reproductor en segundo plano con controles del sistema y el contrato [PlaybackPort] para la interfaz.
/// Si la canción está guardada se reproduce desde el fichero local; si no, se transmite
/// y se guarda mientras suena (LockCachingAudioSource), así la siguiente vez funciona sin conexión.
/// Al abrir la app no hay nada cargado: la cola se prepara cuando el usuario toca una canción.
class SonidosAudioHandler extends BaseAudioHandler
    with QueueHandler, SeekHandler
    implements PlaybackPort {
  SonidosAudioHandler(
    this._store, {
    CoverCache? covers,
    AudioPlayer? player,
    bool configureSession = true,
    this.idleStopAfter = kIdleStopAfter,
    this.stallTimeout = kStallTimeout,
  }) : _player = player ?? AudioPlayer(),
       // ignore: prefer_initializing_formals
       _covers = covers {
    _player.playbackEventStream.listen((_) => _broadcastState());
    // just_audio 0.10 da los errores por errorStream (ya no por el onError de playbackEventStream).
    _player.errorStream.listen(_onPlayerError);
    _player.playingStream.listen((_) => _broadcastState());
    // Aleatorio, repetir y saltos de posición (por ejemplo, al repetir una canción) cambian lo que se ve.
    _player.shuffleModeEnabledStream.listen((_) => _broadcastState());
    _player.loopModeStream.listen((_) => _broadcastState());
    _player.positionDiscontinuityStream.listen((_) => _broadcastState());
    _player.currentIndexStream.listen((index) {
      final items = queue.value;
      if (_active && index != null && index >= 0 && index < items.length) {
        mediaItem.add(items[index]);
        _fillArtwork(index);
      }
      // Otra canción: el reintento por parón vuelve a estar disponible.
      if (index != _lastIndex) _stallRetried = false;
      _lastIndex = index;
      _publish();
    });
    if (configureSession) unawaited(_configureSession());
  }

  final LibraryStore _store;

  /// Cierre por inactividad ([kIdleStopAfter]); en pruebas, más corto.
  final Duration idleStopAfter;

  /// Vigilante de parones de la red ([kStallTimeout]); en pruebas, más corto.
  final Duration stallTimeout;

  /// Portadas guardadas: la notificación usa el fichero local (file://), nunca descarga por su cuenta.
  final CoverCache? _covers;
  final AudioPlayer _player;
  final ValueNotifier<NowPlaying> _now = ValueNotifier<NowPlaying>(
    NowPlaying.none,
  );
  final ValueNotifier<PlaybackProgress> _progress =
      ValueNotifier<PlaybackProgress>(PlaybackProgress.zero);
  final ValueNotifier<String?> _error = ValueNotifier<String?>(null);

  // Cola cargada. Vacía hasta que el usuario toca una canción y otra vez vacía tras stop().
  List<String> _queueIds = const [];
  List<Song> _queueSongs = const [];
  // Fichero de cada canción (null en YouTube) y si su fuente actual es ese fichero (si no, llega por la red).
  List<File?> _queueFiles = const [];
  List<bool> _fromFile = const [];
  // Dirección de audio en uso por canción transmitida y las ya probadas en esta cola (ADR-0031).
  final Map<String, Uri> _streamUris = <String, Uri>{};
  final Map<String, Set<Uri>> _sourcesTried = <String, Set<Uri>>{};
  // Escuchar de YouTube (ADR-0021): su dirección, para poder recargarla.
  Uri? _youtubeUri;
  Map<String, String>? _youtubeHeaders;

  /// Hay una cola cargada y no se ha parado. Solo entonces se protege el servicio de un `idle` pasajero.
  bool _active = false;

  /// Número de la última carga de fuentes: un error de una carga anterior ya no se atiende.
  int _loadSeq = 0;

  int? _lastIndex;
  Timer? _idleStop;
  Timer? _stall;
  Duration _stallFrom = Duration.zero;
  bool _stallRetried = false;

  Future<void> _serial = Future<void>.value();

  @override
  ValueListenable<NowPlaying> get nowPlaying => _now;

  @override
  ValueListenable<PlaybackProgress> get progress => _progress;

  @override
  ValueListenable<String?> get playbackError => _error;

  @override
  Set<String> get queueSongIds => _queueIds.toSet();

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

  // ---------------------------------------------------------------------------------------------------------------
  // Cola y fuentes

  /// Prepara [songs] como cola, empezando por [initialIndex] (la canción tocada se prepara primero: sin red, una
  /// primera canción no guardada ya no impide oír la tocada). Un fallo de la canción inicial al prepararse no
  /// rompe la cola: lo atiende el camino de error (otra dirección, o saltar a la siguiente que pueda sonar).
  Future<bool> _loadQueue(List<Song> songs, int initialIndex) async {
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
    final files = <File?>[];
    for (final song in songs) {
      // Las canciones locales (ADR-0013) tienen su fichero en `audio` y nunca se transmiten.
      files.add(song.local ? File(song.audio) : await _store.audioFile(song));
    }
    final initial = songs[initialIndex];
    if (initial.local && !await files[initialIndex]!.exists()) {
      throw AppException(
        'Falta el archivo de «${initial.title}». Bórrala de la lista y vuelve a añadirla.',
      );
    }
    _cancelTimers();
    _youtubeUri = null;
    _youtubeHeaders = null;
    _queueSongs = songs;
    _queueIds = [for (final song in songs) song.id];
    _queueFiles = files;
    _streamUris.clear();
    _sourcesTried.clear();
    _active = true;
    queue.add(items);
    mediaItem.add(items[initialIndex]);
    _fillArtwork(initialIndex);
    _publish();
    return _setSources(initialIndex, Duration.zero);
  }

  /// Fuente de la canción [index] de la cola: su fichero si ya está en el teléfono (aunque se descargara después de
  /// cargar la cola), o la transmisión que la guarda mientras suena.
  Future<(AudioSource, bool fromFile)> _sourceFor(int index) async {
    final song = _queueSongs[index];
    final youtube = _youtubeUri;
    if (youtube != null) {
      return (
        YoutubeAudioSource(uri: youtube, headers: _youtubeHeaders, tag: song.id)
            as AudioSource,
        false,
      );
    }
    final file = _queueFiles[index]!;
    if (song.local || await file.exists()) {
      // Una local sin fichero falla al llegar a ella y se salta.
      return (AudioSource.file(file.path, tag: song.id) as AudioSource, true);
    }
    final uri = _streamUris[song.id] ??= _store.audioUri(song);
    (_sourcesTried[song.id] ??= <Uri>{}).add(uri);
    return (
      // LockCachingAudioSource (experimental en just_audio 0.10) transmite y guarda a la vez. Si al pedirla el
      // fichero ya está completo, lo sirve desde el disco sin red.
      // ignore: experimental_member_use
      LockCachingAudioSource(uri, cacheFile: file, tag: song.id) as AudioSource,
      false,
    );
  }

  /// (Re)carga todas las fuentes de la cola, comprobando de nuevo qué está guardado, y prepara [index] en
  /// [position]. Es también la forma de recuperarse de un error: tras un error just_audio queda parado y solo una
  /// carga nueva lo vuelve a preparar. Devuelve false si la canción [index] no se pudo preparar (ya se está
  /// atendiendo el error).
  Future<bool> _setSources(int index, Duration position) async {
    final sources = <AudioSource>[];
    final fromFile = <bool>[];
    for (var i = 0; i < _queueSongs.length; i++) {
      final (source, file) = await _sourceFor(i);
      sources.add(source);
      fromFile.add(file);
    }
    _fromFile = fromFile;
    _stallRetried = false;
    final seq = ++_loadSeq;
    try {
      await _player.setAudioSources(
        sources,
        initialIndex: index,
        initialPosition: position,
      );
      return true;
    } on PlayerInterruptedException catch (error) {
      // Otra carga la sustituyó: no es un fallo.
      debugPrint('reproductor: carga interrumpida: $error');
      return false;
    } on PlayerException catch (error) {
      // La canción inicial no se pudo preparar: se atiende como cualquier error (errorStream también lo avisa; el
      // número de carga evita atenderlo dos veces).
      debugPrint(
        'reproductor: no se pudo preparar «${_titleAt(index)}»: $error',
      );
      unawaited(_exclusive(() => _recover(index, seq, error)));
      return false;
    }
  }

  String _titleAt(int index) =>
      index >= 0 && index < _queueSongs.length ? _queueSongs[index].title : '';

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

  // ---------------------------------------------------------------------------------------------------------------
  // Errores, parones y recuperación

  void _onPlayerError(PlayerException error) {
    final index = error.index ?? _player.currentIndex;
    if (index == null) return;
    final seq = _loadSeq;
    unawaited(_exclusive(() => _recover(index, seq, error)));
  }

  /// Error (o parón sin salida) de la canción [index]. Por orden: si ya está guardada y no sonaba desde el fichero,
  /// se recarga desde el fichero en el mismo punto; si se transmitía, se prueba la siguiente dirección de su audio
  /// (Worker, r2.dev y la web; ADR-0031) en el mismo punto; si no, se salta a la siguiente que pueda sonar sin red. Si
  /// no queda ninguna, se pausa con un aviso. Si la cola cambió o se recargó desde el error, no hace nada.
  Future<void> _recover(int index, int seq, Object error) async {
    if (!_active || seq != _loadSeq) return;
    if (index < 0 || index >= _queueSongs.length) return;
    if (index != (_player.currentIndex ?? index)) {
      debugPrint('reproductor: error de un elemento que no suena: $error');
      return;
    }
    final song = _queueSongs[index];
    final position = _player.position;
    debugPrint('reproductor: «${song.title}» falló: $error');
    if (_youtubeUri != null) {
      _reportError(error);
      await _guardQuiet(_player.pause);
      return;
    }
    final file = _queueFiles[index];
    if (!_fromFile[index] && file != null && await file.exists()) {
      debugPrint(
        'reproductor: «${song.title}» ya está guardada; sigue desde el fichero',
      );
      if (await _setSources(index, position)) {
        _startPlayback();
      }
      return;
    }
    final next = _fromFile[index]
        ? null
        : nextFallbackUri(
            song: song,
            cached: false,
            sources: _store.audioUris(song),
            tried: _sourcesTried[song.id] ?? const <Uri>{},
          );
    if (next != null) {
      debugPrint('reproductor: «${song.title}»: reintento desde ${next.host}');
      _streamUris[song.id] = next;
      if (await _setSources(index, position)) {
        _startPlayback();
      }
      return;
    }
    await _skipUnavailable(index);
  }

  /// Salta a la siguiente canción que puede sonar sin red (comprobando de nuevo lo guardado). Si no hay, pausa.
  Future<void> _skipUnavailable(int index) async {
    final song = _queueSongs[index];
    final streamed = !_fromFile[index];
    final playable = [
      for (var i = 0; i < _queueSongs.length; i++)
        playableOffline(
          song: _queueSongs[i],
          cached: _queueFiles[i] != null && await _queueFiles[i]!.exists(),
        ),
    ];
    // La que acaba de fallar no se vuelve a intentar en este salto.
    final next = nextAvailableIndex(playable, index);
    if (next != null) {
      if (await _setSources(next, Duration.zero)) {
        _startPlayback();
      }
    } else {
      await _guardQuiet(_player.pause);
    }
    // Se muestra después de arrancar, porque _startPlayback limpia el error anterior.
    final reason = streamed
        ? '«${song.title}» no está guardada y no hay conexión.'
        : 'No se pudo reproducir «${song.title}».';
    _error.value = next == null
        ? '$reason No quedan canciones que sonar sin conexión.'
        : '$reason Paso a la siguiente.';
  }

  Future<void> _guardQuiet(Future<void> Function() action) async {
    try {
      await action();
    } catch (error) {
      debugPrint('reproductor: $error');
    }
  }

  /// Arma o quita el vigilante de parones: solo con la reproducción pedida, esperando datos y con una canción que
  /// llega por la red. Cualquier avance real de la posición lo deja listo para otro reintento.
  void _updateStallWatch() {
    final index = _player.currentIndex;
    final state = _player.processingState;
    final streamed =
        _active &&
        index != null &&
        index >= 0 &&
        index < _fromFile.length &&
        !_fromFile[index];
    final waiting =
        streamed &&
        _player.playing &&
        (state == ProcessingState.buffering ||
            state == ProcessingState.loading);
    if (!waiting) {
      _stall?.cancel();
      _stall = null;
      if (state == ProcessingState.ready &&
          _player.playing &&
          _player.position > _stallFrom) {
        _stallRetried = false;
      }
      return;
    }
    if (_stall != null) return;
    _stallFrom = _player.position;
    _stall = Timer(stallTimeout, _onStall);
  }

  void _onStall() {
    _stall = null;
    final index = _player.currentIndex;
    final state = _player.processingState;
    if (!_active ||
        index == null ||
        index >= _fromFile.length ||
        _fromFile[index] ||
        !_player.playing ||
        !(state == ProcessingState.buffering ||
            state == ProcessingState.loading)) {
      return;
    }
    if (_player.position > _stallFrom) {
      _updateStallWatch();
      return;
    }
    final seq = _loadSeq;
    if (!_stallRetried) {
      debugPrint(
        'reproductor: «${_titleAt(index)}» parada; reintento desde el mismo punto',
      );
      final position = _player.position;
      unawaited(
        _exclusive(() async {
          if (!_active || seq != _loadSeq) return;
          if (await _setSources(index, position)) {
            _stallRetried = true;
            _startPlayback();
          }
        }),
      );
      return;
    }
    unawaited(
      _exclusive(
        () => _recover(index, seq, const AppException('la red no responde')),
      ),
    );
  }

  /// Cierre por inactividad: corre mientras hay cola y no suena nada; si llega a [idleStopAfter], para todo.
  void _updateIdleStop() {
    final audible = isAudiblyPlaying(
      playing: _player.playing,
      state: _player.processingState,
    );
    if (!_active || audible) {
      _idleStop?.cancel();
      _idleStop = null;
      return;
    }
    _idleStop ??= Timer(idleStopAfter, () {
      _idleStop = null;
      debugPrint('reproductor: sin sonar desde hace $idleStopAfter; se cierra');
      unawaited(stop());
    });
  }

  void _cancelTimers() {
    _idleStop?.cancel();
    _idleStop = null;
    _stall?.cancel();
    _stall = null;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Órdenes

  @override
  Future<void> playAt(List<Song> songs, int index) => _exclusive(() async {
    if (index < 0 || index >= songs.length) {
      throw const AppException('Esa canción ya no está disponible.');
    }
    bool ready;
    try {
      if (!_sameQueue(songs)) {
        ready = await _loadQueue(songs, index);
      } else if (_player.processingState == ProcessingState.idle) {
        // Tras un error just_audio queda parado: buscar no lo vuelve a preparar, cargar sí.
        ready = await _setSources(index, Duration.zero);
      } else {
        await _player.seek(Duration.zero, index: index);
        ready = true;
      }
    } on AppException {
      rethrow;
    } catch (error) {
      throw AppException(describePlayerError(error));
    }
    // Si no se pudo preparar, el camino de error ya decide (otra dirección o la siguiente que pueda sonar).
    if (ready) _startPlayback();
  });

  @override
  Future<void> playStream({
    required String id,
    required String title,
    required String artist,
    required Uri uri,
    Duration? duration,
    Map<String, String>? headers,
  }) => _exclusive(() async {
    final queueId = 'yt-$id';
    final item = MediaItem(
      id: queueId,
      title: title,
      artist: artist.isEmpty ? null : artist,
      album: 'YouTube',
      duration: duration,
    );
    _cancelTimers();
    queue.add([item]);
    _youtubeUri = uri;
    _youtubeHeaders = headers;
    // Marcador para la cola: nunca se busca en la biblioteca ni se guarda.
    _queueSongs = [
      Song(
        id: queueId,
        title: title,
        artist: artist,
        year: null,
        tags: const [],
        folderId: null,
        durationS: (duration?.inMilliseconds ?? 0) / 1000,
        license: '',
        audio: '',
      ),
    ];
    _queueIds = [queueId];
    _queueFiles = const [null];
    _fromFile = const [false];
    _streamUris.clear();
    _sourcesTried.clear();
    _active = true;
    _loadSeq += 1;
    try {
      await _player.setAudioSources([
        YoutubeAudioSource(uri: uri, headers: headers, tag: queueId),
      ]);
    } catch (error) {
      await _clearQueue();
      throw AppException(describePlayerError(error));
    }
    mediaItem.add(item);
    _publish();
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

  /// Para la música, cierra el servicio y su notificación y deja el reproductor vacío: sin canción ni cola, así
  /// la interfaz no muestra una canción que ya no está cargada.
  @override
  Future<void> stop() async {
    _active = false;
    _loadSeq += 1;
    _cancelTimers();
    await _guardQuiet(_player.stop);
    await _clearQueue();
    await super.stop();
  }

  Future<void> _clearQueue() async {
    _active = false;
    _queueIds = const [];
    _queueSongs = const [];
    _queueFiles = const [];
    _fromFile = const [];
    _streamUris.clear();
    _sourcesTried.clear();
    _youtubeUri = null;
    _youtubeHeaders = null;
    queue.add(const []);
    mediaItem.add(null);
    _publish();
    _publishProgress();
  }

  /// Al quitar la app de recientes se para la música y se cierra el servicio y su notificación.
  @override
  Future<void> onTaskRemoved() => stop();

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
    if (!_active || _youtubeUri != null) return false;
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
    final item = _active ? mediaItem.value : null;
    final state = _player.processingState;
    final playing = _active && _player.playing;
    final now = NowPlaying(
      songId: item?.id,
      title: item?.title ?? '',
      artist: item?.artist ?? '',
      playing: playing,
      buffering:
          state == ProcessingState.loading ||
          state == ProcessingState.buffering ||
          (state == ProcessingState.idle && playing),
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
    if (!_active) {
      _progress.value = PlaybackProgress.zero;
      return;
    }
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
        processingState: serviceProcessingState(
          _player.processingState,
          active: _active,
          playing: playing,
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
    _updateIdleStop();
    _updateStallWatch();
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
