import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:reminiscencia/app.dart';
import 'package:reminiscencia/app_settings.dart';
import 'package:reminiscencia/collections.dart';
import 'package:reminiscencia/collections_controller.dart';
import 'package:reminiscencia/collections_store.dart';
import 'package:reminiscencia/covers.dart';
import 'package:reminiscencia/edit_remote.dart';
import 'package:reminiscencia/image_picker.dart';
import 'package:reminiscencia/library_controller.dart';
import 'package:reminiscencia/library_requests.dart';
import 'package:reminiscencia/library_store.dart';
import 'package:reminiscencia/offline_downloads.dart';
import 'package:reminiscencia/pending_edits.dart';
import 'package:reminiscencia/playback.dart';
import 'package:reminiscencia/playlist_covers.dart';
import 'package:reminiscencia/services.dart';
import 'package:reminiscencia/settings_store.dart';
import 'package:reminiscencia/shared_upload.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/upload_tracker.dart';
import 'package:reminiscencia/youtube_importer.dart';
import 'package:reminiscencia/youtube_stream.dart';

/// Canción de prueba con id y título predecibles.
Song fakeSong(
  String id, {
  String? folderId,
  String artist = 'Artista',
  String? cover,
  double? gainDb,
}) {
  return Song(
    cover: cover,
    id: id,
    title: 'Canción $id',
    artist: artist,
    year: 1931,
    tags: const ['jazz'],
    folderId: folderId,
    durationS: 185,
    license: 'Dominio público',
    audio: 'audio/$id.opus',
    gainDb: gainDb,
  );
}

/// Biblioteca falsa: devuelve lo configurado o lanza el error configurado.
class FakeLibrarySource implements LibrarySource {
  FakeLibrarySource({
    this.songs = const [],
    this.folders = const [],
    this.error,
  });

  List<Song> songs;
  List<Folder> folders;
  Object? error;
  int loads = 0;

  /// False simula que no hay red y se usó la copia guardada.
  bool fromNetwork = true;

  @override
  Future<LibraryData> load() async {
    loads++;
    final failure = error;
    if (failure != null) throw failure;
    return LibraryData(
      songs: songs,
      folders: folders,
      fromNetwork: fromNetwork,
    );
  }

  final List<List<Song>> downloadCalls = [];

  /// Si no es null, downloadAll avisa de este progreso y espera a que se complete (o se cancele) antes de terminar.
  Completer<void>? holdDownload;
  OfflineProgress downloadDetail = const OfflineProgress(done: 3, total: 8);

  @override
  Future<int> downloadAll(
    List<Song> songs,
    void Function(int done, int total) onProgress, {
    void Function(OfflineProgress progress)? onDetail,
    OfflineCancel? cancel,
  }) async {
    downloadCalls.add(songs);
    final hold = holdDownload;
    if (hold != null) {
      onDetail?.call(downloadDetail);
      cancel?.onCancel(() {
        if (!hold.isCompleted) hold.complete();
      });
      await hold.future;
    }
    return 0;
  }

  @override
  Future<Set<String>> cachedAudioIds() async => {};

  @override
  Future<void> deleteCachedAudio(String id) async {}
}

/// Reproductor falso: registra las órdenes y expone el mismo contrato que el real.
class FakePlaybackPort implements PlaybackPort {
  final ValueNotifier<NowPlaying> _now = ValueNotifier<NowPlaying>(
    NowPlaying.none,
  );
  final ValueNotifier<String?> _error = ValueNotifier<String?>(null);
  final ValueNotifier<PlaybackProgress> _progress =
      ValueNotifier<PlaybackProgress>(PlaybackProgress.zero);

  /// Si no es null, playAt lanza este error (canción que no se puede reproducir).
  Object? playError;

  final List<String> log = [];

  final Set<String> _queue = {};

  @override
  Set<String> get queueSongIds => Set<String>.of(_queue);

  @override
  ValueListenable<NowPlaying> get nowPlaying => _now;

  @override
  ValueListenable<String?> get playbackError => _error;

  @override
  ValueListenable<PlaybackProgress> get progress => _progress;

  /// Fija la posición que publica el reproductor (para probar la barra de progreso).
  void setProgress(PlaybackProgress value) => _progress.value = value;

  /// Como el real al parar (quitar de recientes, cerrar la notificación o el cierre por inactividad): sin canción
  /// ni cola.
  Future<void> stop() async {
    log.add('stop');
    _queue.clear();
    _now.value = NowPlaying.none;
  }

  /// Solo para pruebas: deja [songs] como cola con la canción [index] cargada y en pausa, como tras tocarla y
  /// pausarla. (Al abrir la app no hay nada cargado.)
  void cue(List<Song> songs, int index) {
    final song = songs[index];
    _queue
      ..clear()
      ..addAll(songs.map((item) => item.id));
    _now.value = NowPlaying(
      songId: song.id,
      title: song.title,
      artist: song.artist,
    );
  }

  @override
  Future<void> playStream({
    required String id,
    required String title,
    required String artist,
    required Uri uri,
    Duration? duration,
    Map<String, String>? headers,
  }) async {
    log.add('stream:$id');
    final failure = playError;
    if (failure != null) throw failure;
    _queue
      ..clear()
      ..add('yt-$id');
    _now.value = NowPlaying(
      songId: 'yt-$id',
      title: title,
      artist: artist,
      playing: true,
    );
  }

  @override
  Future<void> playAt(List<Song> songs, int index) async {
    log.add('play:$index');
    final failure = playError;
    if (failure != null) throw failure;
    final song = songs[index];
    // Como el reproductor real: si la lista no es la cola cargada, la cola se rehace.
    final wanted = songs.map((item) => item.id).toSet();
    if (!(wanted.length == _queue.length && wanted.containsAll(_queue))) {
      _queue
        ..clear()
        ..addAll(wanted);
    }
    _now.value = NowPlaying(
      songId: song.id,
      title: song.title,
      artist: song.artist,
      playing: true,
      shuffle: _now.value.shuffle,
      repeat: _now.value.repeat,
    );
  }

  @override
  Future<void> togglePlayPause() async {
    log.add('toggle');
    _now.value = _now.value.copyWith(playing: !_now.value.playing);
  }

  @override
  Future<void> playNext() async => log.add('next');

  @override
  Future<void> playPrevious() async => log.add('previous');

  @override
  Future<void> seek(Duration position) async =>
      log.add('seek:${position.inSeconds}');

  @override
  Future<void> setShuffle(bool enabled) async {
    log.add('shuffle:$enabled');
    _now.value = _now.value.copyWith(shuffle: enabled);
  }

  @override
  Future<void> setRepeat(LoopSetting mode) async {
    log.add('repeat:${mode.name}');
    _now.value = _now.value.copyWith(repeat: mode);
  }
}

/// Imagen PNG de 2×2 px válida, para las portadas de las pruebas.
final Uint8List kTinyPng = img.encodePng(img.Image(width: 2, height: 2));

/// Portadas falsas: las rutas de [available] tienen imagen; registra lo que se pide.
class FakeCoverImages extends ChangeNotifier implements CoverImages {
  FakeCoverImages([Iterable<String> available = const []])
    : available = available.toSet();

  final Set<String> available;
  final List<String> requested = [];

  @override
  ImageProvider? imageFor(String? coverPath) {
    if (coverPath == null) return null;
    requested.add(coverPath);
    return available.contains(coverPath) ? MemoryImage(kTinyPng) : null;
  }

  /// Simula que acaba de bajar una portada.
  void arrive(String coverPath) {
    available.add(coverPath);
    notifyListeners();
  }
}

/// Almacén de portadas falso para el controlador de la biblioteca: registra las llamadas.
class FakeCoverStore implements CoverStore {
  final List<String> log = [];
  Set<String>? lastKeep;
  List<String> lastDownload = const [];
  List<String> lastRevalidate = const [];

  @override
  Future<int> downloadAll(Iterable<String> coverPaths) async {
    lastDownload = coverPaths.toList()..sort();
    log.add('download');
    return lastDownload.length;
  }

  @override
  Future<void> prune(Set<String> keep) async {
    lastKeep = keep;
    log.add('prune');
  }

  @override
  void resetFailures() => log.add('reset');

  @override
  Future<void> revalidate(Iterable<String> coverPaths) async {
    lastRevalidate = coverPaths.toList()..sort();
    log.add('revalidate');
  }
}

/// Portadas propias de las listas en memoria: no reduce la imagen, solo la cuenta.
class MemoryPlaylistCoverStore implements PlaylistCoverStore {
  final Map<String, Uint8List> files = {};
  final List<String> deleted = [];
  int _next = 0;

  @override
  Future<String> save(String playlistId, Uint8List imageBytes) async {
    final name = '$playlistId-${++_next}.jpg';
    files[name] = imageBytes;
    return name;
  }

  @override
  File? fileFor(String fileName) => File('/memoria/$fileName');

  @override
  Future<void> delete(String fileName) async {
    files.remove(fileName);
    deleted.add(fileName);
  }
}

/// Repositorio de listas en memoria. Puede simular fallos de lectura o de escritura.
class MemoryCollectionsRepository implements CollectionsRepository {
  MemoryCollectionsRepository([Collections? initial])
    : stored = initial ?? Collections();

  Collections stored;
  Object? readError;
  Object? writeError;
  int writes = 0;

  @override
  Future<Collections> read() async {
    final failure = readError;
    if (failure != null) throw failure;
    return Collections.fromJson(stored.toJson());
  }

  @override
  Future<void> write(Collections data) async {
    final failure = writeError;
    if (failure != null) throw failure;
    writes++;
    stored = Collections.fromJson(data.toJson());
  }
}

/// Servicios de la app con todos los fakes, y acceso directo a ellos para las aserciones.
typedef TestServices = ({
  AppServices services,
  FakeLibrarySource source,
  FakePlaybackPort playback,
  MemoryCollectionsRepository repository,
  List<Uri> openedUrls,
  List<LibraryRequest> submitted,
  List<({String id, Uint8List jpeg})> submittedCovers,
  FakeCoverImages covers,
  FakeCoverStore coverStore,
  MemoryPlaylistCoverStore playlistCovers,
  FakeEditStatus editStatus,
  FakePollTimer editTimers,
  MemoryPendingEditsStore editsStore,
});

/// Monta [TestServices].
TestServices buildTestServices({
  List<Song> songs = const [],
  List<Folder> folders = const [],
  Object? libraryError,
  AppSettings settings = AppSettings.defaults,
  Collections? collections,
  DateTime? now,
  bool canOpenUrls = true,
  Object? submitError,
  Iterable<String> availableCovers = const [],
  ImagePicker? pickImage,
  SharedUploader? uploader,
  AudioFilesPicker? pickAudio,
  PublishedSongsSource? published,
  UploadsStore? uploadsStore,
  PeriodicTimerFactory? pollTimer,
  DateTime Function()? clock,
  YoutubeImporter? youtube,
  YoutubeStreamResolver? streamResolver,
  AudioDurationProbe? probeDuration,
  FakeEditStatus? editStatus,
  FakePollTimer? editTimers,
  MemoryPendingEditsStore? editsStore,
}) {
  final source = FakeLibrarySource(
    songs: songs,
    folders: folders,
    error: libraryError,
  );
  final playback = FakePlaybackPort();
  final repository = MemoryCollectionsRepository(collections);
  var ids = 0;
  final opened = <Uri>[];
  final submitted = <LibraryRequest>[];
  final submittedCovers = <({String id, Uint8List jpeg})>[];
  final covers = FakeCoverImages(availableCovers);
  final coverStore = FakeCoverStore();
  final playlistCovers = MemoryPlaylistCoverStore();
  final status = editStatus ?? FakeEditStatus();
  final editTimer = editTimers ?? FakePollTimer();
  final edits = editsStore ?? MemoryPendingEditsStore();
  var issues = 0;
  final services = AppServices(
    library: LibraryController(
      source: source,
      playback: playback,
      covers: coverStore,
      uploader: uploader,
      published: published,
      uploadsStore: uploadsStore,
      pollTimer: pollTimer ?? FakePollTimer().call,
      clock: clock,
      editStatus: status.call,
      editsStore: edits,
      editTimer: editTimer.call,
    ),
    playback: playback,
    collections: CollectionsController(
      repository: repository,
      covers: playlistCovers,
      newId: () => 'lista${++ids}',
    ),
    settings: SettingsController(initial: settings),
    covers: covers,
    openUrl: (uri) async {
      opened.add(uri);
      return canOpenUrls;
    },
    submitEdit: (request) async {
      if (submitError != null) throw submitError;
      submitted.add(request);
      return EditReceipt(message: 'Guardado.', issue: ++issues);
    },
    submitCover: (id, jpeg) async {
      if (submitError != null) throw submitError;
      submittedCovers.add((id: id, jpeg: jpeg));
      return const EditReceipt(message: 'Guardado.');
    },
    pickImage: pickImage ?? () async => null,
    pickAudio: pickAudio ?? () async => const [],
    probeDuration: probeDuration ?? (_) async => null,
    youtube: youtube,
    streamResolver: streamResolver,
    clock: () => now ?? DateTime(2026, 11, 3, 10),
  );
  return (
    services: services,
    source: source,
    playback: playback,
    repository: repository,
    openedUrls: opened,
    submitted: submitted,
    submittedCovers: submittedCovers,
    covers: covers,
    coverStore: coverStore,
    playlistCovers: playlistCovers,
    editStatus: status,
    editTimers: editTimer,
    editsStore: edits,
  );
}

/// Estado falso de las ediciones (GET /api/editar?incidencia=N): [states] por número (por defecto 'abierta') o
/// [error] si «no hay conexión». Cuenta las consultas.
class FakeEditStatus {
  final Map<int, String> states = {};
  Object? error;
  int fetches = 0;

  Future<String> call(int issue) async {
    fetches++;
    final failure = error;
    if (failure != null) throw failure;
    return states[issue] ?? 'abierta';
  }
}

/// Fija el tamaño lógico de la ventana de prueba (dp, con densidad 1).
void setWindow(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

/// Deja avanzar unos fotogramas para que terminen las cargas. No se usa pumpAndSettle
/// porque los indicadores de carga animan sin fin y nunca se asientan.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

/// Monta la app con los servicios dados y espera a que cargue la biblioteca.
Future<void> pumpApp(WidgetTester tester, AppServices services) async {
  await services.collections.load();
  await tester.pumpWidget(ReminiscenciaApp(services: services));
  await settle(tester);
}

/// Temporizador periódico falso: no corre solo; la prueba lo dispara con [fire].
class FakePollTimer {
  final List<FakeTimer> timers = [];

  Timer call(Duration period, void Function() onTick) {
    final timer = FakeTimer(period, onTick);
    timers.add(timer);
    return timer;
  }

  /// Temporizadores sin cancelar.
  List<FakeTimer> get active => timers.where((t) => t.isActive).toList();

  /// Dispara una vez cada temporizador activo.
  void fire() {
    for (final timer in active) {
      timer.fireOnce();
    }
  }
}

class FakeTimer implements Timer {
  FakeTimer(this.period, this.onTick);

  final Duration period;
  final void Function() onTick;
  bool _active = true;
  int _ticks = 0;

  void fireOnce() {
    if (!_active) return;
    _ticks++;
    onTick();
  }

  @override
  void cancel() => _active = false;

  @override
  bool get isActive => _active;

  @override
  int get tick => _ticks;
}

/// Canciones publicadas falsas: devuelve [songs] (que la prueba cambia) o lanza [error]. Cuenta las lecturas.
class FakePublishedSongs implements PublishedSongsSource {
  FakePublishedSongs([List<PublishedSong>? songs]) : songs = songs ?? [];

  List<PublishedSong> songs;
  Object? error;
  int fetches = 0;

  @override
  Future<List<PublishedSong>> fetch() async {
    fetches++;
    final failure = error;
    if (failure != null) throw failure;
    return List.of(songs);
  }
}
