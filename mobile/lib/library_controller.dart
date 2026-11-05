import 'fuzzy_search.dart';
import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'app_error.dart';
import 'covers.dart';
import 'library_store.dart';
import 'local_audio.dart';
import 'offline_choice.dart';
import 'playback.dart';
import 'playback_plan.dart';
import 'shared_upload.dart';
import 'song.dart';
import 'upload_tracker.dart';

/// Estado de la biblioteca para la interfaz: canciones, álbumes (carpetas en los datos), errores visibles y descargas.
///
/// Sincronización (sin temporizadores): al abrir la app, al volver a primer plano si pasaron 10 minutos
/// (syncIfStale) y al refrescar a mano (load). Sin red se usa la copia guardada y no hay error bloqueante.
class LibraryController extends ChangeNotifier {
  LibraryController({
    required this.source,
    required this.playback,
    this.local,
    this.offline,
    this.covers,
    this.uploader,
    PublishedSongsSource? published,
    UploadsStore? uploadsStore,
    PeriodicTimerFactory? pollTimer,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now {
    _lastSongId = playback.nowPlaying.value.songId;
    playback.nowPlaying.addListener(_onNowPlayingChanged);
    uploads = UploadTracker(
      uploader: uploader,
      published: published,
      store: uploadsStore,
      clock: _clock,
      timer: pollTimer,
      knownIds: () => _catalog.map((song) => song.id).toSet(),
      // Al publicarse, la biblioteca se sincroniza sola.
      onPublished: (_) => unawaited(load()),
    );
    uploads.addListener(_onUploadsChanged);
  }

  final LibrarySource source;
  final PlaybackPort playback;

  /// Canciones subidas desde este teléfono (ADR-0013). Null si la función no está disponible.
  final LocalAudioLibrary? local;

  /// Preferencia «escuchar sin conexión». Null en pruebas o si no se guarda.
  final OfflineChoice? offline;

  /// Estado de la red. Sin él, la sincronización nunca descarga audio nuevo.

  /// Portadas de la web guardadas en el teléfono. Null si no se guardan (pruebas).
  final CoverStore? covers;

  /// Subida a la biblioteca común por la función de la web. Null si no está disponible.
  final SharedUploader? uploader;

  /// Estado de cada subida hasta que se publica. Sus canciones provisionales están en [songs] y [recentSongs].
  late final UploadTracker uploads;

  final DateTime Function() _clock;

  List<Song> _songs = const [];
  List<Song> _catalog = const [];
  List<Song> _localSongs = const [];
  List<Folder> _folders = const [];
  bool _started = false;
  bool _loading = false;
  bool _online = false;
  String? _loadError;
  String? _audioNotice;
  bool _downloading = false;
  String _progress = '';
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

  bool get downloading => _downloading;
  String get progress => _progress;

  /// True si el usuario pidió escuchar sin conexión (la sincronización descargará con cualquier conexión).
  bool get offlineWanted => _offlineWanted;

  /// True mientras se convierten y suben archivos a la biblioteca común.
  bool get importing => uploads.busy;

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

  /// Canciones del catálogo de la web (iguales para todos).
  List<Song> get catalogSongs => _catalog;

  /// Canciones subidas desde este teléfono, en el orden en que se añadieron.
  List<Song> get localSongs => _localSongs;

  /// Canciones de un álbum del catálogo, por su número de pista (ADR-0026); las que no lo tienen, al final y en el
  /// orden del catálogo.
  List<Song> songsInFolder(String folderId) =>
      sortByTrack(_songs.where((song) => song.folderId == folderId));

  /// Canción por id (también las locales), o null si ya no está. Una subida ya publicada da la canción pública.
  Song? songOrNull(String? id) {
    if (id == null) return null;
    for (final song in _songs) {
      if (song.id == id) return song;
    }
    final published = uploads.entryOrNull(id)?.publishedId;
    if (published != null && published != id) return songOrNull(published);
    return null;
  }

  /// Portadas que usa el catálogo actual (canciones y álbumes).
  Set<String> get referencedCovers => {
    for (final song in _catalog)
      if (song.cover != null) song.cover!,
    for (final folder in _folders)
      if (folder.cover != null) folder.cover!,
  };

  /// Canciones sin álbum.
  List<Song> get songsWithoutFolder =>
      _songs.where((song) => song.folderId == null).toList();

  /// Añadidas recientemente: primero lo subido en este teléfono (lo último primero) y después el final del catálogo,
  /// que crece por el final al importar.
  List<Song> recentSongs({int limit = 12}) => [
    ..._provisional().reversed,
    ..._localSongs.reversed,
    ..._catalog.reversed,
  ].take(limit).toList();

  /// Subidas que todavía no están en el catálogo cargado: suenan desde su copia Opus local.
  List<Song> _provisional() => uploads.provisionalSongs(
    catalogIds: _catalog.map((song) => song.id).toSet(),
  );

  void _rebuildSongs() {
    _songs = [..._catalog, ..._localSongs, ..._provisional()];
  }

  void _onUploadsChanged() {
    _rebuildSongs();
    notifyListeners();
  }

  /// Canciones cuyo título, artista, año o etiquetas contienen [query] (sin distinguir mayúsculas ni tildes).
  List<Song> searchSongs(String query) {
    final needle = foldForSearch(query);
    if (needle.isEmpty) return const [];
    return _songs.where((song) {
      final haystack = foldForSearch(
        [
          song.title,
          song.artist,
          if (song.year != null) '${song.year}',
          ...song.tags,
        ].join(' '),
      );
      return haystack.contains(needle) || fuzzyMatches(haystack, needle);
    }).toList();
  }

  /// Álbumes cuyo nombre o artista contiene [query].
  List<Folder> searchFolders(String query) {
    final needle = foldForSearch(query);
    if (needle.isEmpty) return const [];
    return _folders.where((folder) {
      final text = '${folder.name} ${folder.artist}';
      return foldForSearch(text).contains(needle) || fuzzyMatches(text, needle);
    }).toList();
  }

  /// Álbum por id, o null si ya no existe.
  Folder? folderOrNull(String id) {
    for (final folder in _folders) {
      if (folder.id == id) return folder;
    }
    return null;
  }

  /// Primera carga al abrir la app; las siguientes llamadas no hacen nada.
  Future<void> ensureLoaded() {
    if (_started) return Future<void>.value();
    _started = true;
    // Lo que quedó por publicar vuelve a la biblioteca y se sigue comprobando. No retrasa la carga.
    unawaited(uploads.restore());
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

  /// Refresco a mano (deslizar hacia abajo): sincroniza y, con la web disponible, pregunta si cambiaron
  /// las portadas ya guardadas. Es la única vía de comprobar portadas guardadas: nunca se sondea.
  Future<void> refresh() async {
    await load();
    final store = covers;
    if (store == null || !_online || _loadError != null) return;
    try {
      await store.revalidate(referencedCovers);
    } catch (error) {
      debugPrint('biblioteca: no se pudieron comprobar las portadas: $error');
    }
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
      _rebuildSongs();
      notifyListeners();
      await _applyQueue();
      return;
    }
    _catalogKnown = true;
    _catalog = data.songs;
    _folders = data.folders;
    _online = data.fromNetwork;
    if (data.fromNetwork) _lastSync = _clock();
    _rebuildSongs();
    _loading = false;
    notifyListeners();
    await _applyQueue();
    if (data.fromNetwork) {
      // Lo subido que ya está en el catálogo sustituye a su canción provisional.
      uploads.reconcile(data.songs);
      await _releasePublishedUploads();
      await _pruneAudio();
      await _pruneCovers();
      if (_offlineWanted) await _downloadInBackground();
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

  /// Con la web disponible: se puede reintentar lo que falló y se borran las portadas que el catálogo ya no usa.
  Future<void> _pruneCovers() async {
    final store = covers;
    if (store == null) return;
    store.resetFailures();
    try {
      await store.prune(referencedCovers);
    } catch (error) {
      debugPrint('biblioteca: no se pudieron limpiar las portadas: $error');
    }
  }

  void _onNowPlayingChanged() {
    final songId = playback.nowPlaying.value.songId;
    if (songId == _lastSongId) return;
    _lastSongId = songId;
    unawaited(_pruneAudio());
    unawaited(_releasePublishedUploads());
  }

  /// Borra la copia local de las subidas que ya están en el catálogo, salvo si suenan o están en la cola:
  /// así la canción pública sustituye a la provisional sin cortar la reproducción.
  Future<void> _releasePublishedUploads() async {
    final catalog = _catalog.map((song) => song.id).toSet();
    final inUse = {
      ...playback.queueSongIds,
      if (playback.nowPlaying.value.songId != null)
        playback.nowPlaying.value.songId!,
    };
    for (final entry in uploads.entries) {
      if (entry.stage != UploadStage.published ||
          entry.opusPath == null ||
          !catalog.contains(entry.publishedId) ||
          inUse.contains(entry.key)) {
        continue;
      }
      await uploads.discardAudio(entry.key);
    }
  }

  /// Descarga lo que falta con cualquier conexión, también con datos móviles. Un fallo no interrumpe nada: se registra y se espera a la próxima sincronización.
  Future<void> _downloadInBackground() async {
    if (_downloading) return;
    try {
      await downloadForOffline();
    } catch (error) {
      debugPrint('biblioteca: descarga en segundo plano incompleta: $error');
    }
  }

  /// Reproduce una canción de la biblioteca completa. Lanza AppException si no se puede.
  Future<void> playSong(Song song) async {
    final index = _songs.indexWhere((item) => item.id == song.id);
    if (index < 0) {
      throw const AppException('Esa canción ya no está en la biblioteca.');
    }
    await playback.playAt(_songs, index);
    // Al tocar una canción la cola puede cambiar: lo que ya no está en uso se puede borrar.
    unawaited(_pruneAudio());
  }

  /// Comprueba la red antes de elegir archivos. Sin subida disponible, true (el error lo da [uploadShared]).
  Future<bool> canUpload() async {
    final shared = uploader;
    if (shared == null) return true;
    return shared.hasConnection();
  }

  /// Convierte y sube a la biblioteca común los archivos elegidos, de uno en uno y en trozos, y sigue cada uno
  /// hasta que se publica ([uploads]). Sin red lanza AppException sin intentar nada.
  /// [review] puede quitar canciones de la tanda antes de que entren en la cola (aviso de duplicados, ADR-0026).
  Future<SharedUploadResult> uploadShared(
    List<PickedAudioFile> files, {
    UploadReview? review,
  }) => uploads.start(files, review: review);

  /// Vuelve a subir un archivo con error.
  Future<void> retryUpload(String key) => uploads.retry(key);

  /// Reproduce una subida: la canción pública si ya se publicó; si no, su copia Opus local.
  Future<void> playUpload(String key) async {
    final entry = uploads.entryOrNull(key);
    if (entry == null) {
      throw const AppException('Esa subida ya no está.');
    }
    final publishedId = entry.publishedId;
    var song = songOrNull(publishedId ?? key);
    if (song == null && publishedId != null) {
      await load();
      song = songOrNull(publishedId);
    }
    if (song == null) {
      throw const AppException('Esa canción todavía no se puede reproducir.');
    }
    await playSong(song);
  }

  /// Al salir de la app: para la conversión (no sigue en segundo plano) y deja de comprobar la publicación.
  Future<void> pauseImport() => uploads.pause();

  /// Al volver a primer plano: comprueba enseguida lo que se está publicando y sigue cada 20 s.
  void resumeUploads() => uploads.setForeground(true);

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
    _rebuildSongs();
    notifyListeners();
  }

  /// Guarda para escuchar sin conexión (audio y portadas). Recuerda la elección: las siguientes sincronizaciones
  /// descargan lo nuevo en Wi-Fi. Solo descarga el catálogo: las canciones locales no existen en la web.
  Future<int> downloadForOffline() async {
    if (!_offlineWanted) {
      _offlineWanted = true;
      await offline?.write(true);
    }
    _downloading = true;
    _progress = 'Preparando…';
    notifyListeners();
    try {
      final done = await source.downloadAll(_catalog, (done, total) {
        _progress = '$done de $total';
        notifyListeners();
      });
      // Las portadas también, para verlas sin conexión. Un fallo aquí no anula la descarga del audio.
      final store = covers;
      if (store != null) {
        try {
          await store.downloadAll(referencedCovers);
        } catch (error) {
          debugPrint('biblioteca: portadas sin descargar: $error');
        }
      }
      return done;
    } finally {
      _downloading = false;
      _progress = '';
      notifyListeners();
    }
  }

  @override
  void dispose() {
    playback.nowPlaying.removeListener(_onNowPlayingChanged);
    uploads.removeListener(_onUploadsChanged);
    uploads.dispose();
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

/// Texto normalizado para buscar: minúsculas, sin tildes ni diéresis y sin espacios repetidos.
String foldForSearch(String text) {
  const from = 'áàäâãéèëêíìïîóòöôõúùüûñç';
  const to = 'aaaaaeeeeiiiiooooouuuunc';
  final lower = text.toLowerCase();
  final buffer = StringBuffer();
  for (final char in lower.split('')) {
    final index = from.indexOf(char);
    buffer.write(index < 0 ? char : to[index]);
  }
  return buffer.toString().trim().replaceAll(RegExp(r'\s+'), ' ');
}
