import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'app_error.dart';
import 'library_store.dart';
import 'local_audio.dart';
import 'network.dart';
import 'offline_choice.dart';
import 'playback.dart';
import 'playback_plan.dart';
import 'song.dart';

/// Estado de la biblioteca para la interfaz: canciones, carpetas, errores visibles y descargas.
///
/// Sincronización (sin temporizadores): al abrir la app, al volver a primer plano si pasaron 10 minutos
/// (syncIfStale) y al refrescar a mano (load). Sin red se usa la copia guardada y no hay error bloqueante.
class LibraryController extends ChangeNotifier {
  LibraryController({
    required this.source,
    required this.playback,
    this.local,
    this.offline,
    this.network,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now {
    _lastSongId = playback.nowPlaying.value.songId;
    playback.nowPlaying.addListener(_onNowPlayingChanged);
  }

  final LibrarySource source;
  final PlaybackPort playback;

  /// Canciones subidas desde este teléfono (ADR-0013). Null si la función no está disponible.
  final LocalAudioLibrary? local;

  /// Preferencia «escuchar sin conexión». Null en pruebas o si no se guarda.
  final OfflineChoice? offline;

  /// Estado de la red. Sin él, la sincronización nunca descarga audio nuevo.
  final NetworkInfo? network;

  final DateTime Function() _clock;

  /// Clave del filtro «Sin carpeta» (canciones sin folder_id).
  static const String noFolderKey = 'none';

  List<Song> _songs = const [];
  List<Song> _catalog = const [];
  List<Song> _localSongs = const [];
  List<Folder> _folders = const [];
  bool _started = false;
  bool _loading = false;
  bool _online = false;
  String? _loadError;
  String? _audioNotice;
  String? _folderKey;
  bool _downloading = false;
  String _progress = '';
  bool _importing = false;
  String _importProgress = '';
  bool _offlineWanted = false;
  bool _catalogKnown = false;
  DateTime? _lastSync;
  Future<void>? _inFlight;
  String? _lastSongId;

  List<Song> get songs => _songs;
  List<Folder> get folders => _folders;
  bool get loading => _loading;

  /// True si la última lectura vino de la web; false si se usó la copia guardada.
  bool get online => _online;

  /// Error que impide mostrar la biblioteca (no hay ni red ni copia). Null si todo va bien.
  String? get loadError => _loadError;

  /// Aviso cuando la biblioteca se ve pero el audio no está listo. La lista sigue visible.
  String? get audioNotice => _audioNotice;

  /// Carpeta seleccionada: null = todas, [noFolderKey] = sin carpeta, o el id de una carpeta.
  String? get folderKey => _folderKey;

  bool get downloading => _downloading;
  String get progress => _progress;

  /// True si el usuario pidió escuchar sin conexión (la sincronización descargará en Wi-Fi).
  bool get offlineWanted => _offlineWanted;

  /// True mientras se convierten y guardan archivos elegidos en este teléfono.
  bool get importing => _importing;
  String get importProgress => _importProgress;

  String get status {
    if (_loading && _songs.isEmpty) return 'Cargando la biblioteca…';
    if (_loadError != null && _songs.isEmpty) {
      return 'Sin biblioteca disponible';
    }
    if (_loadError != null) {
      return '${_songs.length} canciones · biblioteca web no disponible';
    }
    if (_songs.isEmpty) return 'Sin canciones todavía';
    final connection = _online ? 'en línea' : 'sin conexión (copia guardada)';
    return '${_songs.length} canciones · $connection';
  }

  List<Song> get visibleSongs {
    final key = _folderKey;
    if (key == null) return _songs;
    if (key == noFolderKey) {
      return _songs.where((song) => song.folderId == null).toList();
    }
    return _songs.where((song) => song.folderId == key).toList();
  }

  void selectFolder(String? key) {
    _folderKey = key;
    notifyListeners();
  }

  /// Primera carga al abrir la app; las siguientes llamadas no hacen nada.
  Future<void> ensureLoaded() {
    if (_started) return Future<void>.value();
    _started = true;
    return load();
  }

  /// Sincroniza ahora (botón de refrescar, reintentar). Si ya hay una sincronización en curso, espera a esa.
  Future<void> load() {
    final running = _inFlight;
    if (running != null) return running;
    final run = _sync();
    _inFlight = run;
    return run.whenComplete(() {
      _inFlight = null;
    });
  }

  /// Sincroniza al volver a primer plano, solo si ha pasado un tiempo desde la última vez.
  Future<void> syncIfStale() {
    if (!shouldSyncOnResume(last: _lastSync, now: _clock())) {
      return Future<void>.value();
    }
    return load();
  }

  Future<void> _sync() async {
    _loading = true;
    _loadError = null;
    _audioNotice = null;
    notifyListeners();
    _localSongs = await _readLocalSongs();
    _offlineWanted = await offline?.read() ?? false;
    LibraryData data;
    try {
      data = await source.load();
    } catch (error) {
      debugPrint('biblioteca: no se pudo cargar: $error');
      _lastSync = _clock();
      _loading = false;
      _loadError = describeLoadError(error);
      // Sin biblioteca web se siguen viendo las canciones de este teléfono.
      _songs = [..._catalog, ..._localSongs];
      notifyListeners();
      await _applyQueue();
      return;
    }
    _catalogKnown = true;
    _catalog = data.songs;
    _folders = data.folders;
    _online = data.fromNetwork;
    if (data.fromNetwork) _lastSync = _clock();
    _songs = [..._catalog, ..._localSongs];
    _loading = false;
    notifyListeners();
    await _applyQueue();
    if (data.fromNetwork) {
      await _pruneAudio();
      if (_offlineWanted) await _downloadOnWifi();
    }
  }

  /// Canciones locales guardadas. Un fallo al leerlas no impide ver la biblioteca web.
  Future<List<Song>> _readLocalSongs() async {
    final library = local;
    if (library == null) return const [];
    try {
      return await library.songs();
    } catch (error) {
      debugPrint(
        'biblioteca: no se pudieron leer las canciones locales: $error',
      );
      return const [];
    }
  }

  /// Prepara la cola solo si cambió y no hay una canción cargada: así una sincronización no corta lo que suena.
  /// Si hay una canción cargada, playAt rehace la cola al tocar otra.
  Future<void> _applyQueue() async {
    if (_songs.isEmpty) return;
    if (playback.nowPlaying.value.songId != null) return;
    final wanted = _songs.map((song) => song.id).toSet();
    if (setEquals(wanted, playback.queueSongIds)) return;
    await _prepareAudio();
  }

  /// Vuelve a intentar preparar el audio tras un fallo.
  Future<void> retryAudio() => _prepareAudio();

  Future<void> _prepareAudio() async {
    try {
      await playback.loadQueue(_songs);
      _audioNotice = null;
    } catch (error) {
      debugPrint('biblioteca: no se pudo preparar el audio: $error');
      _audioNotice = describeAudioError(error);
    }
    notifyListeners();
  }

  /// Borra el audio guardado de las canciones que ya no están en la web y no están sonando ni en la cola.
  /// Las locales no se tocan. Se llama tras sincronizar y cuando cambia la canción que suena.
  Future<void> _pruneAudio() async {
    if (!_catalogKnown) return;
    try {
      final cached = await source.cachedAudioIds();
      final catalog = _catalog.map((song) => song.id).toSet();
      final inUse = {
        ...playback.queueSongIds,
        if (playback.nowPlaying.value.songId != null)
          playback.nowPlaying.value.songId!,
      };
      final doomed = prunableAudioIds(
        cached: cached,
        catalog: catalog,
        inUse: inUse,
      );
      for (final id in doomed) {
        await source.deleteCachedAudio(id);
      }
    } catch (error) {
      debugPrint('biblioteca: no se pudo limpiar el audio retirado: $error');
    }
  }

  void _onNowPlayingChanged() {
    final songId = playback.nowPlaying.value.songId;
    if (songId == _lastSongId) return;
    _lastSongId = songId;
    unawaited(_pruneAudio());
  }

  /// Descarga lo que falta, solo si hay Wi-Fi o cable. Un fallo no interrumpe nada: se registra y se espera a la próxima sincronización.
  Future<void> _downloadOnWifi() async {
    final info = network;
    if (info == null || _downloading) return;
    if (!await info.onUnmeteredNetwork()) return;
    try {
      await downloadForOffline();
    } catch (error) {
      debugPrint('biblioteca: descarga en segundo plano incompleta: $error');
    }
  }

  /// Reproduce una canción de la biblioteca completa. Lanza AppException si no se puede.
  Future<void> playSong(Song song) async {
    final index = _songs.indexOf(song);
    if (index < 0) {
      throw const AppException('Esa canción ya no está en la biblioteca.');
    }
    await playback.playAt(_songs, index);
    // Al tocar una canción la cola puede cambiar: lo que ya no está en uso se puede borrar.
    unawaited(_pruneAudio());
  }

  /// Convierte y guarda archivos elegidos en este teléfono. Las canciones aparecen en la lista sin recargar la biblioteca.
  /// No recarga la cola de reproducción: si hace falta, playAt la prepara al tocar una canción.
  Future<LocalAddResult> addLocalFiles(List<PickedAudioFile> files) async {
    final library = local;
    if (library == null) {
      throw const AppException(
        'Añadir audio no está disponible en este teléfono.',
      );
    }
    if (files.isEmpty) return const LocalAddResult(added: [], failed: []);
    _importing = true;
    _importProgress = 'Preparando…';
    notifyListeners();
    try {
      final result = await library.addFiles(
        files,
        onProgress: (index, total, title) {
          _importProgress = 'Convirtiendo ${index + 1} de $total: $title';
          notifyListeners();
        },
      );
      if (result.added.isNotEmpty) {
        _localSongs = [..._localSongs, ...result.added];
        _songs = [..._catalog, ..._localSongs];
      }
      return result;
    } finally {
      _importing = false;
      _importProgress = '';
      notifyListeners();
    }
  }

  /// Para la conversión al salir de la app (no sigue en segundo plano).
  Future<void> pauseImport() async {
    if (_importing) await local?.cancelImport();
  }

  /// Borra una canción subida desde este teléfono. Las canciones del catálogo público no se pueden borrar desde aquí.
  Future<void> deleteLocal(Song song) async {
    final library = local;
    if (library == null || !song.local) {
      throw const AppException(
        'Solo se pueden borrar las canciones subidas desde este teléfono.',
      );
    }
    await library.delete(song);
    _localSongs = _localSongs.where((item) => item.id != song.id).toList();
    _songs = [..._catalog, ..._localSongs];
    notifyListeners();
  }

  /// Guarda para escuchar sin conexión. Recuerda la elección: las siguientes sincronizaciones descargan en Wi-Fi.
  /// Solo descarga el catálogo: las canciones locales no existen en la web.
  Future<int> downloadForOffline() async {
    if (!_offlineWanted) {
      _offlineWanted = true;
      await offline?.write(true);
    }
    _downloading = true;
    _progress = 'Preparando…';
    notifyListeners();
    try {
      return await source.downloadAll(_catalog, (done, total) {
        _progress = '$done de $total';
        notifyListeners();
      });
    } finally {
      _downloading = false;
      _progress = '';
      notifyListeners();
    }
  }

  @override
  void dispose() {
    playback.nowPlaying.removeListener(_onNowPlayingChanged);
    super.dispose();
  }
}

/// Texto para el usuario cuando no se puede cargar la biblioteca.
String describeLoadError(Object error) {
  if (_isConnectionError(error)) {
    return 'No hay conexión y todavía no hay una copia de la biblioteca guardada en este teléfono. '
        'Conéctate a internet y vuelve a intentarlo.';
  }
  if (error is HttpException) {
    return 'La web de la biblioteca no respondió bien (${error.message}). Vuelve a intentarlo en unos minutos.';
  }
  return 'No se pudo leer la biblioteca. Vuelve a intentarlo.';
}

/// Texto para el usuario cuando el audio no se puede preparar, con el motivo.
String describeAudioError(Object error) {
  final reason = error is AppException ? error.message : '$error';
  return 'No se puede preparar el audio. Motivo: $reason';
}

bool _isConnectionError(Object error) =>
    error is SocketException ||
    error is TimeoutException ||
    error is http.ClientException;
