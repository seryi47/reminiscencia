import 'app_error.dart';

/// Longitud máxima del nombre de una lista.
const int kMaxPlaylistNameLength = 60;

/// Valida y normaliza el nombre de una lista: recorta los extremos y colapsa los espacios repetidos.
/// Lanza AppException con un mensaje para el usuario si el nombre no vale.
String cleanPlaylistName(String raw) {
  final collapsed = raw.trim().replaceAll(RegExp(r'\s+'), ' ');
  if (collapsed.isEmpty) {
    throw const AppException('Escribe un nombre para la lista.');
  }
  if (collapsed.length > kMaxPlaylistNameLength) {
    throw AppException(
      'El nombre no puede tener más de $kMaxPlaylistNameLength caracteres.',
    );
  }
  return collapsed;
}

/// Lista de reproducción local: un nombre y las canciones (por id), sin repetir.
class Playlist {
  Playlist({
    required this.id,
    required this.name,
    Iterable<String> songIds = const [],
  }) : songIds = List<String>.unmodifiable(songIds);

  final String id;
  final String name;
  final List<String> songIds;

  Playlist copyWith({String? name, Iterable<String>? songIds}) {
    return Playlist(
      id: id,
      name: name ?? this.name,
      songIds: songIds ?? this.songIds,
    );
  }

  Map<String, Object> toJson() => {'id': id, 'name': name, 'songs': songIds};
}

/// Favoritos y listas del usuario. Clase pura: el guardado en disco está en collections_store.dart.
class Collections {
  Collections({
    Iterable<String> favorites = const [],
    Iterable<Playlist> playlists = const [],
  }) : _favorites = _uniqueIds(favorites),
       _playlists = List<Playlist>.of(playlists);

  final List<String> _favorites;
  final List<Playlist> _playlists;

  /// Ids de las canciones favoritas, en el orden en que se marcaron.
  List<String> get favorites => List<String>.unmodifiable(_favorites);

  List<Playlist> get playlists => List<Playlist>.unmodifiable(_playlists);

  bool isFavorite(String songId) => _favorites.contains(songId);

  /// Marca o desmarca una canción. Devuelve true si queda marcada.
  bool toggleFavorite(String songId) {
    if (_favorites.remove(songId)) return false;
    _favorites.add(songId);
    return true;
  }

  /// Devuelve la lista con ese id, o null si no existe.
  Playlist? playlistOrNull(String id) {
    for (final playlist in _playlists) {
      if (playlist.id == id) return playlist;
    }
    return null;
  }

  /// Crea una lista. El nombre se valida; el id lo pone quien llama para que sea predecible en pruebas.
  Playlist createPlaylist({required String id, required String name}) {
    final cleanName = cleanPlaylistName(name);
    if (_playlists.any((playlist) => playlist.id == id)) {
      throw ArgumentError.value(id, 'id', 'Ya existe una lista con ese id.');
    }
    final playlist = Playlist(id: id, name: cleanName);
    _playlists.add(playlist);
    return playlist;
  }

  void renamePlaylist(String id, String name) {
    final index = _indexOf(id);
    final cleanName = cleanPlaylistName(name);
    _playlists[index] = _playlists[index].copyWith(name: cleanName);
  }

  void deletePlaylist(String id) {
    _playlists.removeAt(_indexOf(id));
  }

  /// Añade una canción a la lista. Devuelve false si ya estaba.
  bool addSong(String playlistId, String songId) {
    final index = _indexOf(playlistId);
    final current = _playlists[index];
    if (current.songIds.contains(songId)) return false;
    _playlists[index] = current.copyWith(songIds: [...current.songIds, songId]);
    return true;
  }

  void removeSong(String playlistId, String songId) {
    final index = _indexOf(playlistId);
    final current = _playlists[index];
    _playlists[index] = current.copyWith(
      songIds: current.songIds.where((id) => id != songId),
    );
  }

  Map<String, Object> toJson() => {
    'version': 1,
    'favorites': _favorites,
    'playlists': [for (final playlist in _playlists) playlist.toJson()],
  };

  /// Lee lo guardado. Las entradas sueltas que no se entiendan se descartan;
  /// lanza FormatException si lo que llega no es un objeto JSON.
  factory Collections.fromJson(Object? json) {
    if (json is! Map) {
      throw const FormatException('Se esperaba un objeto JSON con las listas.');
    }
    final favorites = <String>[];
    final rawFavorites = json['favorites'];
    if (rawFavorites is List) {
      for (final id in rawFavorites) {
        if (id is String && id.isNotEmpty) favorites.add(id);
      }
    }
    final playlists = <Playlist>[];
    final rawPlaylists = json['playlists'];
    if (rawPlaylists is List) {
      for (final item in rawPlaylists) {
        final playlist = _playlistFromJson(item);
        if (playlist != null &&
            playlists.every((other) => other.id != playlist.id)) {
          playlists.add(playlist);
        }
      }
    }
    return Collections(favorites: favorites, playlists: playlists);
  }

  int _indexOf(String id) {
    final index = _playlists.indexWhere((playlist) => playlist.id == id);
    if (index < 0) throw const AppException('Esa lista ya no existe.');
    return index;
  }

  static List<String> _uniqueIds(Iterable<String> ids) {
    final result = <String>[];
    for (final id in ids) {
      if (!result.contains(id)) result.add(id);
    }
    return result;
  }

  static Playlist? _playlistFromJson(Object? item) {
    if (item is! Map) return null;
    final id = item['id'];
    final name = item['name'];
    if (id is! String || id.isEmpty || name is! String) return null;
    final songIds = <String>[];
    final rawSongs = item['songs'];
    if (rawSongs is List) {
      for (final songId in rawSongs) {
        if (songId is String &&
            songId.isNotEmpty &&
            !songIds.contains(songId)) {
          songIds.add(songId);
        }
      }
    }
    try {
      return Playlist(id: id, name: cleanPlaylistName(name), songIds: songIds);
    } on AppException {
      return null;
    }
  }
}
