import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'app_error.dart';
import 'library_store.dart';
import 'playback.dart';
import 'song.dart';

/// Estado de la biblioteca para la interfaz: canciones, carpetas, errores visibles y descargas.
class LibraryController extends ChangeNotifier {
  LibraryController({required this.source, required this.playback});

  final LibrarySource source;
  final PlaybackPort playback;

  /// Clave del filtro «Sin carpeta» (canciones sin folder_id).
  static const String noFolderKey = 'none';

  List<Song> _songs = const [];
  List<Folder> _folders = const [];
  bool _started = false;
  bool _loading = false;
  bool _online = false;
  String? _loadError;
  String? _audioNotice;
  String? _folderKey;
  bool _downloading = false;
  String _progress = '';

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

  String get status {
    if (_loading && _songs.isEmpty) return 'Cargando la biblioteca…';
    if (_loadError != null) return 'Sin biblioteca disponible';
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

  /// Carga la biblioteca la primera vez; las siguientes llamadas no hacen nada.
  Future<void> ensureLoaded() {
    if (_started) return Future<void>.value();
    _started = true;
    return load();
  }

  Future<void> load() async {
    _loading = true;
    _loadError = null;
    _audioNotice = null;
    notifyListeners();
    LibraryData data;
    try {
      data = await source.load();
    } catch (error) {
      debugPrint('biblioteca: no se pudo cargar: $error');
      _loading = false;
      _loadError = describeLoadError(error);
      notifyListeners();
      return;
    }
    _songs = data.songs;
    _folders = data.folders;
    _online = data.fromNetwork;
    _loading = false;
    notifyListeners();
    if (_songs.isNotEmpty) await _prepareAudio();
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

  /// Reproduce una canción de la biblioteca completa. Lanza AppException si no se puede.
  Future<void> playSong(Song song) async {
    final index = _songs.indexOf(song);
    if (index < 0) {
      throw const AppException('Esa canción ya no está en la biblioteca.');
    }
    await playback.playAt(_songs, index);
  }

  /// Guarda para escuchar sin conexión. Devuelve cuántas canciones se han descargado.
  Future<int> downloadForOffline() async {
    _downloading = true;
    _progress = 'Preparando…';
    notifyListeners();
    try {
      return await source.downloadAll(_songs, (done, total) {
        _progress = '$done de $total';
        notifyListeners();
      });
    } finally {
      _downloading = false;
      _progress = '';
      notifyListeners();
    }
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
