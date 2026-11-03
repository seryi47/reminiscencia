import 'dart:io';

import 'package:flutter/foundation.dart';

import 'app_error.dart';
import 'collections.dart';
import 'collections_store.dart';
import 'playlist_covers.dart';

/// Favoritos y listas para la interfaz. Cada cambio se aplica al momento y se guarda después.
/// Si lo guardado no se puede leer, no se permite ningún cambio: así no se pisan datos que aún existen.
class CollectionsController extends ChangeNotifier {
  CollectionsController({
    required this.repository,
    this.covers,
    String Function()? newId,
  }) : _newId = newId ?? _defaultId;

  /// Donde se guardan los favoritos y las listas.
  final CollectionsRepository repository;

  /// Portadas propias de las listas (solo en este teléfono). Null si la función no está disponible.
  final PlaylistCoverStore? covers;
  final String Function() _newId;

  Collections _data = Collections();
  bool _loaded = false;
  bool _writable = false;
  String? _loadError;
  static int _counter = 0;

  Collections get data => _data;

  /// True cuando ya se ha intentado leer lo guardado (con o sin error).
  bool get loaded => _loaded;

  /// Aviso visible si lo guardado no se pudo leer.
  String? get loadError => _loadError;

  static String _defaultId() {
    _counter += 1;
    return '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}$_counter';
  }

  Future<void> load() async {
    try {
      _data = await repository.read();
      _loadError = null;
      _writable = true;
    } catch (error) {
      debugPrint('listas: no se pudieron leer: $error');
      _data = Collections();
      _writable = false;
      _loadError =
          'No se pudieron leer tus listas guardadas. Para no perder datos, no se puede cambiar nada hasta leerlas.';
    }
    _loaded = true;
    notifyListeners();
  }

  bool isFavorite(String songId) => _data.isFavorite(songId);

  /// Marca o desmarca una canción como favorita. Devuelve true si queda marcada.
  Future<bool> toggleFavorite(String songId) async {
    await _change(() => _data.toggleFavorite(songId));
    return _data.isFavorite(songId);
  }

  Future<Playlist> createPlaylist(String name) async {
    late Playlist created;
    await _change(() {
      created = _data.createPlaylist(id: _newId(), name: name);
    });
    return created;
  }

  Future<void> renamePlaylist(String id, String name) =>
      _change(() => _data.renamePlaylist(id, name));

  /// Cambia el nombre y la descripción de una lista.
  Future<void> editPlaylist(
    String id, {
    required String name,
    required String description,
  }) => _change(
    () => _data.editPlaylist(id, name: name, description: description),
  );

  /// Borra la lista y su portada propia, si tenía.
  Future<void> deletePlaylist(String id) async {
    final cover = _data.playlistOrNull(id)?.coverFile;
    await _change(() => _data.deletePlaylist(id));
    if (cover != null) await _deleteCover(cover);
  }

  /// Fichero de la portada propia de una lista, o null si no tiene.
  File? coverFileOf(Playlist playlist) {
    final name = playlist.coverFile;
    if (name == null) return null;
    return covers?.fileFor(name);
  }

  /// Reduce la imagen elegida a 640 px, la guarda en el teléfono y la pone como portada de la lista.
  Future<void> setPlaylistCover(String id, Uint8List imageBytes) async {
    final store = covers;
    if (store == null) {
      throw const AppException(
        'Las portadas propias no están disponibles en este teléfono.',
      );
    }
    _checkWritable();
    if (_data.playlistOrNull(id) == null) {
      throw const AppException('Esa lista ya no existe.');
    }
    final name = await store.save(id, imageBytes);
    String? previous;
    try {
      await _change(() {
        previous = _data.setPlaylistCover(id, name);
      });
    } catch (_) {
      // Si la lista desapareció entretanto, la imagen nueva no se queda huérfana.
      if (_data.playlistOrNull(id)?.coverFile != name) await _deleteCover(name);
      rethrow;
    }
    final old = previous;
    if (old != null && old != name) await _deleteCover(old);
  }

  /// Quita la portada propia: la lista vuelve al degradado.
  Future<void> removePlaylistCover(String id) async {
    String? previous;
    await _change(() {
      previous = _data.setPlaylistCover(id, null);
    });
    final old = previous;
    if (old != null) await _deleteCover(old);
  }

  Future<void> _deleteCover(String name) async {
    try {
      await covers?.delete(name);
    } catch (error) {
      debugPrint('listas: no se pudo borrar la portada $name: $error');
    }
  }

  /// Devuelve false si la canción ya estaba en la lista.
  Future<bool> addSong(String playlistId, String songId) async {
    var added = false;
    await _change(() {
      added = _data.addSong(playlistId, songId);
    });
    return added;
  }

  Future<void> removeSong(String playlistId, String songId) =>
      _change(() => _data.removeSong(playlistId, songId));

  Future<void> _change(void Function() change) async {
    _checkWritable();
    change();
    notifyListeners();
    try {
      await repository.write(_data);
    } catch (error) {
      debugPrint('listas: no se pudieron guardar: $error');
      throw const AppException(
        'No se pudo guardar el cambio. Se mantendrá solo hasta cerrar la app.',
      );
    }
  }

  void _checkWritable() {
    if (!_loaded) {
      throw const AppException('Tus listas todavía se están cargando.');
    }
    if (!_writable) {
      throw const AppException(
        'No se puede cambiar nada hasta que se puedan leer tus listas guardadas.',
      );
    }
  }
}
