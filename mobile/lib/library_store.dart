import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'local_audio.dart';
import 'song.dart';

/// Origen de la biblioteca. La web de Vercel es la fuente; la app guarda copias para usarla sin conexión.
const String kLibraryBase = 'https://reminiscencia.vercel.app/';

class LibraryData {
  const LibraryData({
    required this.songs,
    required this.folders,
    required this.fromNetwork,
  });

  final List<Song> songs;
  final List<Folder> folders;
  final bool fromNetwork;
}

/// Acceso a la biblioteca. La implementación real usa la web y la copia local; en pruebas se usa una falsa.
abstract interface class LibrarySource {
  /// Lee la biblioteca. Si no hay red, usa la copia guardada; si tampoco hay copia, lanza excepción.
  Future<LibraryData> load();

  /// Descarga las canciones que falten para escucharlas sin conexión. Devuelve cuántas se han descargado.
  Future<int> downloadAll(
    List<Song> songs,
    void Function(int done, int total) onProgress,
  );

  /// Ids de las canciones cuyo audio está guardado en la copia de la web (nunca las locales).
  Future<Set<String>> cachedAudioIds();

  /// Borra el audio guardado de una canción de la web. No toca la lista ni las canciones locales.
  Future<void> deleteCachedAudio(String id);
}

class LibraryStore implements LibrarySource {
  LibraryStore({Future<Directory> Function()? root, http.Client? client})
    : _resolveRoot = root ?? _documentsRoot,
      _client = client ?? http.Client();

  final Future<Directory> Function() _resolveRoot;
  final http.Client _client;
  Directory? _root;

  static Future<Directory> _documentsRoot() async {
    final docs = await getApplicationDocumentsDirectory();
    return Directory('${docs.path}/biblioteca');
  }

  Future<Directory> _dir() async {
    if (_root != null) return _root!;
    final root = await _resolveRoot();
    await root.create(recursive: true);
    _root = root;
    return root;
  }

  /// Lee la biblioteca de Vercel. Si no hay conexión, usa la última copia guardada.
  /// La copia solo se reemplaza cuando la respuesta es válida: un JSON roto no borra la copia buena.
  @override
  Future<LibraryData> load() async {
    final dir = await _dir();
    final songsFile = File('${dir.path}/songs.json');
    final foldersFile = File('${dir.path}/folders.json');
    try {
      final songsBody = await _get('data/songs.json');
      final foldersBody = await _get('data/folders.json');
      final data = _parse(songsBody, foldersBody, fromNetwork: true);
      await songsFile.writeAsString(songsBody, flush: true);
      await foldersFile.writeAsString(foldersBody, flush: true);
      return data;
    } catch (error) {
      debugPrint('biblioteca: descarga fallida, uso la copia guardada: $error');
      if (!await songsFile.exists()) rethrow;
      final foldersBody = await foldersFile.exists()
          ? await foldersFile.readAsString()
          : '[]';
      return _parse(
        await songsFile.readAsString(),
        foldersBody,
        fromNetwork: false,
      );
    }
  }

  LibraryData _parse(
    String songsBody,
    String foldersBody, {
    required bool fromNetwork,
  }) {
    final songs = (jsonDecode(songsBody) as List)
        .map((e) => Song.fromJson(e as Map<String, dynamic>))
        .toList();
    final folders = (jsonDecode(foldersBody) as List)
        .map((e) => Folder.fromJson(e as Map<String, dynamic>))
        .toList();
    return LibraryData(
      songs: songs,
      folders: folders,
      fromNetwork: fromNetwork,
    );
  }

  Future<String> _get(String path) async {
    final response = await _client
        .get(Uri.parse('$kLibraryBase$path'))
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw HttpException('HTTP ${response.statusCode}', uri: Uri.parse(path));
    }
    return response.body;
  }

  Uri audioUri(Song song) => Uri.parse('$kLibraryBase${song.audio}');

  /// Fichero local de una canción de la web (puede no existir todavía).
  Future<File> audioFile(Song song) async {
    final dir = await _dir();
    final audioDir = Directory('${dir.path}/audio');
    await audioDir.create(recursive: true);
    return File('${audioDir.path}/${song.id}.opus');
  }

  Future<bool> isCached(Song song) async => (await audioFile(song)).exists();

  @override
  Future<Set<String>> cachedAudioIds() async {
    final dir = await _dir();
    final audioDir = Directory('${dir.path}/audio');
    if (!await audioDir.exists()) return {};
    final ids = <String>{};
    await for (final entity in audioDir.list()) {
      if (entity is! File) continue;
      final name = entity.uri.pathSegments.last;
      if (!name.endsWith('.opus')) continue;
      final id = name.substring(0, name.length - '.opus'.length);
      if (!isLocalSongId(id)) ids.add(id);
    }
    return ids;
  }

  @override
  Future<void> deleteCachedAudio(String id) async {
    // Las canciones locales viven en otra carpeta; esta guarda evita borrar nada que no sea de la web.
    if (isLocalSongId(id)) return;
    final dir = await _dir();
    final file = File('${dir.path}/audio/$id.opus');
    if (await file.exists()) await file.delete();
  }

  @override
  Future<int> downloadAll(
    List<Song> songs,
    void Function(int done, int total) onProgress,
  ) async {
    var done = 0;
    final missing = <Song>[];
    for (final song in songs) {
      if (song.local) continue;
      if (!await isCached(song)) missing.add(song);
    }
    for (final song in missing) {
      final file = await audioFile(song);
      final response = await _client
          .get(audioUri(song))
          .timeout(const Duration(minutes: 3));
      if (response.statusCode != 200) {
        throw HttpException('No se pudo descargar ${song.title}');
      }
      await file.writeAsBytes(response.bodyBytes, flush: true);
      done += 1;
      onProgress(done, missing.length);
    }
    return done;
  }
}
