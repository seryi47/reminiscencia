import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app.dart';
import 'package:reminiscencia/app_settings.dart';
import 'package:reminiscencia/collections.dart';
import 'package:reminiscencia/collections_controller.dart';
import 'package:reminiscencia/collections_store.dart';
import 'package:reminiscencia/library_controller.dart';
import 'package:reminiscencia/library_store.dart';
import 'package:reminiscencia/playback.dart';
import 'package:reminiscencia/services.dart';
import 'package:reminiscencia/settings_store.dart';
import 'package:reminiscencia/song.dart';

/// Canción de prueba con id y título predecibles.
Song fakeSong(String id, {String? folderId, String artist = 'Artista'}) {
  return Song(
    id: id,
    title: 'Canción $id',
    artist: artist,
    year: 1931,
    tags: const ['jazz'],
    folderId: folderId,
    durationS: 185,
    license: 'Dominio público',
    audio: 'audio/$id.opus',
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

  @override
  Future<LibraryData> load() async {
    loads++;
    final failure = error;
    if (failure != null) throw failure;
    return LibraryData(songs: songs, folders: folders, fromNetwork: true);
  }

  final List<List<Song>> downloadCalls = [];

  @override
  Future<int> downloadAll(
    List<Song> songs,
    void Function(int done, int total) onProgress,
  ) async {
    downloadCalls.add(songs);
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

  /// Si no es null, loadQueue lanza este error (audio que no se puede preparar).
  Object? loadError;

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

  @override
  Future<void> loadQueue(List<Song> songs) async {
    log.add('load:${songs.length}');
    final failure = loadError;
    if (failure != null) throw failure;
    _queue
      ..clear()
      ..addAll(songs.map((song) => song.id));
    if (songs.isEmpty) {
      _now.value = NowPlaying.none;
      return;
    }
    final first = songs.first;
    _now.value = NowPlaying(
      songId: first.id,
      title: first.title,
      artist: first.artist,
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
({
  AppServices services,
  FakeLibrarySource source,
  FakePlaybackPort playback,
  MemoryCollectionsRepository repository,
  List<Uri> openedUrls,
})
buildTestServices({
  List<Song> songs = const [],
  List<Folder> folders = const [],
  Object? libraryError,
  Object? audioError,
  AppSettings settings = AppSettings.defaults,
  Collections? collections,
  DateTime? now,
  bool canOpenUrls = true,
}) {
  final source = FakeLibrarySource(
    songs: songs,
    folders: folders,
    error: libraryError,
  );
  final playback = FakePlaybackPort()..loadError = audioError;
  final repository = MemoryCollectionsRepository(collections);
  var ids = 0;
  final opened = <Uri>[];
  final services = AppServices(
    library: LibraryController(source: source, playback: playback),
    playback: playback,
    collections: CollectionsController(
      repository: repository,
      newId: () => 'lista${++ids}',
    ),
    settings: SettingsController(initial: settings),
    openUrl: (uri) async {
      opened.add(uri);
      return canOpenUrls;
    },
    clock: () => now ?? DateTime(2026, 11, 3, 10),
  );
  return (
    services: services,
    source: source,
    playback: playback,
    repository: repository,
    openedUrls: opened,
  );
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
