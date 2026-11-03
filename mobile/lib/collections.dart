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

/// Longitud máxima de la descripción de una lista.
const int kMaxPlaylistDescriptionLength = 300;

/// Valida la descripción de una lista: recortada, sin caracteres de control (se admiten saltos de línea)
/// y como mucho [kMaxPlaylistDescriptionLength] caracteres. Puede quedar vacía.
String cleanPlaylistDescription(String raw) {
  final clean = raw
      .replaceAll('\r\n', '\n')
      .replaceAll(RegExp(r'[\u0000-\u0009\u000b-\u001f\u007f-\u009f]'), ' ')
      .replaceAll(RegExp(r'\n{3,}'), '\n\n')
      .trim();
  if (clean.runes.length > kMaxPlaylistDescriptionLength) {
    throw AppException(
      'La descripción no puede tener más de $kMaxPlaylistDescriptionLength caracteres.',
    );
  }
  return clean;
}

/// Nombre de fichero válido para la portada propia de una lista (se guarda solo en el teléfono).
final RegExp kPlaylistCoverFileName = RegExp(r'^[A-Za-z0-9_-]{1,80}\.jpg$');

/// Lista de reproducción local: nombre, descripción, portada propia (opcional) y las canciones (por id), sin repetir.
class Playlist {
  Playlist({
    required this.id,
    required this.name,
    this.description = '',
    this.coverFile,
    Iterable<String> songIds = const [],
  }) : songIds = List<String>.unmodifiable(songIds);

  final String id;
  final String name;

  /// Descripción escrita por el usuario. Vacía si no tiene.
  final String description;

  /// Nombre del fichero de la portada elegida del teléfono (ver PlaylistCoverStore), o null.
  final String? coverFile;
  final List<String> songIds;

  Playlist copyWith({
    String? name,
    String? description,
    Iterable<String>? songIds,
    Object? coverFile = _keep,
  }) {
    return Playlist(
      id: id,
      name: name ?? this.name,
      description: description ?? this.description,
      coverFile: identical(coverFile, _keep)
          ? this.coverFile
          : coverFile as String?,
      songIds: songIds ?? this.songIds,
    );
  }

  Map<String, Object> toJson() => {
    'id': id,
    'name': name,
    if (description.isNotEmpty) 'description': description,
    'cover': ?coverFile,
    'songs': songIds,
  };
}

const Object _keep = Object();

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

  /// Cambia el nombre y la descripción. Valida los dos antes de cambiar nada.
  void editPlaylist(
    String id, {
    required String name,
    required String description,
  }) {
    final index = _indexOf(id);
    final cleanName = cleanPlaylistName(name);
    final cleanDescription = cleanPlaylistDescription(description);
    _playlists[index] = _playlists[index].copyWith(
      name: cleanName,
      description: cleanDescription,
    );
  }

  /// Pone (o quita, con null) la portada propia. Devuelve el fichero anterior, para borrarlo.
  String? setPlaylistCover(String id, String? coverFile) {
    if (coverFile != null && !kPlaylistCoverFileName.hasMatch(coverFile)) {
      throw ArgumentError.value(coverFile, 'coverFile');
    }
    final index = _indexOf(id);
    final previous = _playlists[index].coverFile;
    _playlists[index] = _playlists[index].copyWith(coverFile: coverFile);
    return previous;
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
    final rawDescription = item['description'];
    final rawCover = item['cover'];
    String description = '';
    if (rawDescription is String) {
      try {
        description = cleanPlaylistDescription(rawDescription);
      } on AppException {
        description = '';
      }
    }
    try {
      return Playlist(
        id: id,
        name: cleanPlaylistName(name),
        description: description,
        coverFile:
            rawCover is String && kPlaylistCoverFileName.hasMatch(rawCover)
            ? rawCover
            : null,
        songIds: songIds,
      );
    } on AppException {
      return null;
    }
  }
}
