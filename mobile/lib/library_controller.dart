import 'fuzzy_search.dart';

export 'fuzzy_search.dart' show foldForSearch;
import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'app_error.dart';
import 'covers.dart';
import 'edit_remote.dart' show EditStatusFetcher;
import 'library_store.dart';
import 'local_audio.dart';
import 'offline_choice.dart';
import 'offline_downloads.dart';
import 'pending_edits.dart';
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
    EditStatusFetcher? editStatus,
    PendingEditsStore? editsStore,
    EditTimerFactory? editTimer,
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
    // Ediciones enviadas que aún no están en el catálogo (ADR-0027): se ven encima del catálogo real.
    edits = PendingEditsController(
      fetchStatus: editStatus,
      store: editsStore,
      clock: _clock,
      timer: editTimer,
    );
    edits.currentCatalog = () =>
        (songs: _catalog, folders: _catalogFolders, ok: _catalogKnown);
    edits.loadCatalog = () async {
      await load();
      return (
        songs: _catalog,
        folders: _catalogFolders,
        ok: _online && _loadError == null,
      );
    };
    edits.onCoverConfirmed = (path) {
      final store = covers;
      if (store != null) unawaited(store.revalidate({path}).catchError((_) {}));
    };
    edits.addListener(_onEditsChanged);
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

  /// Ediciones de la biblioteca común enviadas desde este teléfono que aún no están en el catálogo (ADR-0027).
  /// [songs] y [folders] ya las muestran; [catalogSongs] y [catalogFolders] son el catálogo real.
  late final PendingEditsController edits;

  final DateTime Function() _clock;

  List<Song> _songs = const [];
  List<Song> _catalog = const [];
  List<Song> _localSongs = const [];
  List<Folder> _folders = const [];
  List<Folder> _catalogFolders = const [];
  bool _started = false;
  bool _loading = false;
  bool _online = false;
  String? _loadError;
  String? _audioNotice;
  bool _downloading = false;
  bool _offlineWanted = false;
  OfflineCancel? _offlineCancel;
  bool _lastDownloadCancelled = false;
  final Stopwatch _progressClock = Stopwatch();

  /// Progreso de «Guardar para escuchar sin conexión» (ADR-0033), o null si no se está guardando. Es aparte de
  /// [notifyListeners]: cada canción o cada trozo recibido solo repinta lo que lo escucha, no Inicio entero.
  final ValueNotifier<OfflineProgress?> offlineProgress =
      ValueNotifier<OfflineProgress?>(null);
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

  /// «Guardando 3 de 8 · 2,4 MB», o vacío.
  String get progress => offlineProgress.value?.text ?? '';

  /// True si la última descarga terminó porque se canceló.
  bool get lastDownloadCancelled => _lastDownloadCancelled;

  /// Corta la descarga en marcha: lo ya guardado se queda y deja de guardarse lo nuevo al sincronizar.
  Future<void> cancelDownload() async {
    final cancel = _offlineCancel;
    if (cancel == null) return;
    cancel.cancel();
    _offlineWanted = false;
    await offline?.write(false);
    notifyListeners();
  }

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

  /// Canciones del catálogo de la web (iguales para todos), sin las ediciones pendientes.
  List<Song> get catalogSongs => _catalog;

  /// Álbumes del catálogo de la web, sin las ediciones pendientes.
  List<Folder> get catalogFolders => _catalogFolders;

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
    for (final folder in _catalogFolders)
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
    final view = edits.apply(_catalog, _catalogFolders);
    _folders = view.folders;
    _songs = [...view.songs, ..._localSongs, ..._provisional()];
  }

  void _onEditsChanged() {
    _rebuildSongs();
    notifyListeners();
  }

  /// Lo de las subidas que cambia la biblioteca: qué canciones provisionales hay, su etiqueta y si se puede subir.
  String _uploadsSignature() => [
    uploads.busy,
    for (final entry in uploads.entries)
      '${entry.key}:${entry.stage.name}:${entry.opusPath != null}:${entry.publishedId}',
  ].join('|');

  String _lastUploadsSignature = '';

  /// Un avance de una subida (porcentaje, trozo) no cambia la biblioteca: solo lo repinta el panel de subidas, que
  /// escucha a [uploads] directamente. Rehacer la lista de canciones y repintar Inicio y Tu biblioteca en cada trozo
  /// frenaba el teléfono (ADR-0033).
  void _onUploadsChanged() {
    final signature = _uploadsSignature();
    if (signature == _lastUploadsSignature) return;
    _lastUploadsSignature = signature;
    _rebuildSongs();
    notifyListeners();
  }

  /// Canciones que coinciden con [query] por título, artista, álbum, año o etiquetas, de más a menos relevantes (la
  /// regla común de búsqueda, ADR-0028). Sin texto, ninguna.
  List<Song> searchSongs(String query) {
    if (foldForSearch(query).isEmpty) return const [];
    return searchRank(
      _songs,
      query,
      (song) => songSearchFields(song, _albumNameOf(song)),
    );
  }

  /// Álbumes que coinciden con [query] por nombre o artista, de más a menos relevantes. Sin texto, ninguno.
  List<Folder> searchFolders(String query) {
    if (foldForSearch(query).isEmpty) return const [];
    return searchRank(_folders, query, folderSearchFields);
  }

  String _albumNameOf(Song song) {
    final id = song.folderId;
    return id == null ? '' : folderOrNull(id)?.name ?? '';
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
    unawaited(edits.restore());
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
    _catalogFolders = data.folders;
    // Lo que ya está en el catálogo deja de verse como pendiente.
    if (data.fromNetwork) edits.reconcile(data.songs, data.folders);
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

  /// Convierte y sube a la biblioteca común los archivos elegidos, en trozos (se convierte el siguiente mientras se
  /// envía el anterior y van hasta dos a la vez; ADR-0030), y sigue cada uno
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
  /// descargan lo nuevo (también si se cerró la app a medias: sigue donde se quedó, sin bajar otra vez lo guardado).
  /// Solo descarga el catálogo: las canciones locales no existen en la web. Varias canciones a la vez, sin bloquear la
  /// interfaz, y se puede cancelar con [cancelDownload] (ADR-0033).
  Future<int> downloadForOffline() async {
    if (_downloading) return 0;
    if (!_offlineWanted) {
      _offlineWanted = true;
      await offline?.write(true);
    }
    final cancel = OfflineCancel();
    _offlineCancel = cancel;
    _lastDownloadCancelled = false;
    _downloading = true;
    offlineProgress.value = OfflineProgress.preparing;
    _progressClock
      ..reset()
      ..start();
    notifyListeners();
    try {
      final done = await source.downloadAll(
        _catalog,
        (_, _) {},
        onDetail: _reportOffline,
        cancel: cancel,
      );
      // Las portadas también, para verlas sin conexión. Un fallo aquí no anula la descarga del audio.
      final store = covers;
      if (store != null && !cancel.cancelled) {
        try {
          await store.downloadAll(referencedCovers);
        } catch (error) {
          debugPrint('biblioteca: portadas sin descargar: $error');
        }
      }
      return done;
    } finally {
      _lastDownloadCancelled = cancel.cancelled;
      _downloading = false;
      _offlineCancel = null;
      offlineProgress.value = null;
      _progressClock.stop();
      notifyListeners();
    }
  }

  /// Los bytes llegan a trozos: como mucho un repintado cada 150 ms, salvo si cambia el número de canciones.
  void _reportOffline(OfflineProgress next) {
    final current = offlineProgress.value;
    final sameSongs =
        current != null &&
        current.done == next.done &&
        current.failed == next.failed &&
        current.total == next.total;
    if (sameSongs && _progressClock.elapsedMilliseconds < 150) return;
    _progressClock
      ..reset()
      ..start();
    offlineProgress.value = next;
  }

  @override
  void dispose() {
    playback.nowPlaying.removeListener(_onNowPlayingChanged);
    uploads.removeListener(_onUploadsChanged);
    uploads.dispose();
    edits.removeListener(_onEditsChanged);
    edits.dispose();
    _offlineCancel?.cancel();
    offlineProgress.dispose();
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
