import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

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
}

class LibraryStore implements LibrarySource {
  Directory? _root;

  Future<Directory> _dir() async {
    if (_root != null) return _root!;
    final docs = await getApplicationDocumentsDirectory();
    _root = Directory('${docs.path}/biblioteca');
    await _root!.create(recursive: true);
    return _root!;
  }

  /// Lee la biblioteca de Vercel; si no hay conexión, usa la última copia guardada.
  @override
  Future<LibraryData> load() async {
    final dir = await _dir();
    try {
      final songsBody = await _get('data/songs.json');
      final foldersBody = await _get('data/folders.json');
      await File('${dir.path}/songs.json').writeAsString(songsBody);
      await File('${dir.path}/folders.json').writeAsString(foldersBody);
      return _parse(songsBody, foldersBody, fromNetwork: true);
    } catch (error) {
      debugPrint('biblioteca: descarga fallida, uso la copia guardada: $error');
      final songsFile = File('${dir.path}/songs.json');
      final foldersFile = File('${dir.path}/folders.json');
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
    final response = await http
        .get(Uri.parse('$kLibraryBase$path'))
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw HttpException('HTTP ${response.statusCode}', uri: Uri.parse(path));
    }
    return response.body;
  }

  Uri audioUri(Song song) => Uri.parse('$kLibraryBase${song.audio}');

  /// Fichero local de una canción (puede no existir todavía).
  Future<File> audioFile(Song song) async {
    final dir = await _dir();
    final audioDir = Directory('${dir.path}/audio');
    await audioDir.create(recursive: true);
    return File('${audioDir.path}/${song.id}.opus');
  }

  Future<bool> isCached(Song song) async => (await audioFile(song)).exists();

  @override
  Future<int> downloadAll(
    List<Song> songs,
    void Function(int done, int total) onProgress,
  ) async {
    var done = 0;
    final missing = <Song>[];
    for (final song in songs) {
      if (!await isCached(song)) missing.add(song);
    }
    for (final song in missing) {
      final file = await audioFile(song);
      final response = await http
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
