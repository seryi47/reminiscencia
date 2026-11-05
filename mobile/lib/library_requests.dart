import 'dart:convert';

import 'app_error.dart';

// Peticiones a la biblioteca común (ADR-0008). La app no escribe en el catálogo ni guarda ninguna sesión:
// prepara una incidencia nueva de GitHub con la etiqueta «biblioteca» y la abre en el navegador. Solo las cuentas
// con permiso de escritura en el repositorio la procesan. El cuerpo sigue el contrato del backend
// (backend/sonidos/issue_request.py): «action: organize» y «payload: <JSON en una línea>».

const String kLibraryRepo = 'seryi47/reminiscencia';
const String kLibraryIssueLabel = 'biblioteca';

/// Límites (en caracteres) que la app valida antes de enviar el cambio. Son los del backend
/// (backend/sonidos/issue_request.py) y los comprueba tests/contrato/peticiones.json.
const int kMaxAlbumNameLength = 80;

/// Artista de un álbum.
const int kMaxArtistLength = 80;

/// Artista de una canción: como en el backend (catalog.SONG_ARTIST_MAX_CHARS), 200, no los 80 del álbum.
const int kMaxSongArtistLength = 200;
const int kMaxSongTitleLength = 200;
const int kMaxIssueTitleLength = 120;

/// Canciones que se pueden mover de una vez con «move_songs».
const int kMaxMoveSongs = 100;

/// Canciones que se pueden ordenar de una vez con «order_album» (ADR-0026): caben en los 4000 caracteres del payload.
const int kMaxOrderSongs = 190;

/// Aviso común: los cambios se guardan desde la app.
const String kWriteAccessNote =
    'El cambio se guarda desde aquí, sin pasar por GitHub, y llega a todos en un par de minutos.';

final RegExp _songId = RegExp(r'^S[0-9a-f]{16}$');
// Álbumes: los nuevos llevan «F» y 16 hexadecimales; los antiguos, 10 hexadecimales. Se aceptan los dos.
final RegExp _folderId = RegExp(r'^(?:F[0-9a-f]{16}|[0-9a-f]{10})$');
final RegExp _newFolderId = RegExp(r'^F[0-9a-f]{16}$');

// Caracteres que el backend rechaza (_has_control): de control, de formato, separadores de línea y sustitutos.
final RegExp _control = RegExp(
  r'[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]',
  unicode: true,
);

// Espacios que el backend quita a los lados de un texto (str.strip de Python). No es lo mismo que trim() de Dart:
// Python quita además U+001C a U+001F y no quita U+FEFF.
const Set<int> _backendSpaces = {
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, //
  0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, //
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
};

/// El texto sin los espacios que quita el backend al principio y al final.
String stripLikeBackend(String text) {
  final runes = text.runes.toList();
  var start = 0;
  var end = runes.length;
  while (start < end && _backendSpaces.contains(runes[start])) {
    start++;
  }
  while (end > start && _backendSpaces.contains(runes[end - 1])) {
    end--;
  }
  return String.fromCharCodes(runes.sublist(start, end));
}

/// Una petición que el backend rechazaría. [code] y [field] son los del backend (RequestError de issue_request.py) y
/// los que comparan los casos de tests/contrato/peticiones.json; [message] es el texto que ve la persona.
class LibraryRequestException extends AppException {
  const LibraryRequestException(super.message, this.code, [this.field]);

  final String code;
  final String? field;
}

bool isCatalogSongId(String id) => _songId.hasMatch(id);
bool isCatalogFolderId(String id) => _folderId.hasMatch(id);

/// Si se puede pedir «Cambiar portada»: solo canciones (S + 16) y álbumes nuevos (F + 16), que tienen
/// un nombre de archivo único en el buzón de portadas.
bool canChangeCatalogCover(String id) =>
    _songId.hasMatch(id) || _newFolderId.hasMatch(id);

/// Valida un texto de una sola línea como el backend (_text): sin los espacios de los lados, sin caracteres de
/// control y con [min] a [max] caracteres. Devuelve el texto limpio o lanza [LibraryRequestException] con el motivo.
/// [field] es el nombre que ve la persona; [key], el campo del payload.
String cleanRequestText(
  String raw, {
  required String field,
  required int min,
  required int max,
  String? key,
}) {
  final clean = stripLikeBackend(raw);
  if (_control.hasMatch(clean)) {
    throw LibraryRequestException(
      '$field debe ir en una sola línea, sin caracteres especiales.',
      'control_chars',
      key,
    );
  }
  final length = clean.runes.length;
  if (length < min) {
    throw LibraryRequestException(
      '$field no puede quedar en blanco.',
      'empty_text',
      key,
    );
  }
  if (length > max) {
    throw LibraryRequestException(
      '$field no puede tener más de $max caracteres.',
      'too_long',
      key,
    );
  }
  return clean;
}

String _albumName(String raw) => cleanRequestText(
  raw,
  field: 'El nombre del álbum',
  min: 1,
  max: kMaxAlbumNameLength,
  key: 'name',
);

String _albumArtist(String raw) => cleanRequestText(
  raw,
  field: 'El artista',
  min: 0,
  max: kMaxArtistLength,
  key: 'artist',
);

String _songArtist(String raw) => cleanRequestText(
  raw,
  field: 'El artista',
  min: 0,
  max: kMaxSongArtistLength,
  key: 'artist',
);

void _checkSong(String songId, {String key = 'song_id'}) {
  if (!isCatalogSongId(songId)) {
    throw LibraryRequestException(
      'Solo se pueden editar las canciones de la biblioteca común.',
      'invalid_song_id',
      key,
    );
  }
}

void _checkFolder(String folderId, {String field = 'El álbum'}) {
  if (!isCatalogFolderId(folderId)) {
    throw LibraryRequestException(
      '$field no es un álbum de la biblioteca común.',
      'invalid_folder_id',
      'folder_id',
    );
  }
}

/// Lista de canciones de «move_songs» y «order_album», en el orden del backend (_song_ids): de 1 a [max], todas
/// válidas y sin repetir.
void _checkSongIds(
  List<String> songIds,
  int max, {
  required String empty,
  required String tooMany,
  required String repeated,
}) {
  if (songIds.isEmpty) {
    throw LibraryRequestException(empty, 'song_ids_empty', 'song_ids');
  }
  if (songIds.length > max) {
    throw LibraryRequestException(tooMany, 'song_ids_too_many', 'song_ids');
  }
  for (final id in songIds) {
    _checkSong(id, key: 'song_ids');
  }
  if (songIds.toSet().length != songIds.length) {
    throw LibraryRequestException(repeated, 'duplicate_song_ids', 'song_ids');
  }
}

/// Una petición lista para abrir: título de la incidencia y operación (payload).
class LibraryRequest {
  const LibraryRequest._(this.title, this.payload);

  /// «Editar detalles» de una canción: título y artista.
  factory LibraryRequest.editSong({
    required String songId,
    required String title,
    required String artist,
  }) {
    _checkSong(songId);
    final cleanTitle = cleanRequestText(
      title,
      field: 'El título',
      min: 1,
      max: kMaxSongTitleLength,
      key: 'title',
    );
    return LibraryRequest._('Editar la canción $songId', {
      'op': 'edit_song',
      'song_id': songId,
      'title': cleanTitle,
      'artist': _songArtist(artist),
    });
  }

  /// «Añadir a un álbum»: mueve la canción al álbum [folderId] (null la deja sin álbum).
  factory LibraryRequest.moveSong({
    required String songId,
    required String? folderId,
    String albumName = '',
  }) {
    _checkSong(songId);
    if (folderId != null) _checkFolder(folderId);
    final where = folderId == null
        ? 'sin álbum'
        : (albumName.trim().isEmpty
              ? 'al álbum $folderId'
              : 'al álbum «${albumName.trim()}»');
    return LibraryRequest._('Mover la canción $songId $where', {
      'op': 'edit_song',
      'song_id': songId,
      'folder_id': folderId,
    });
  }

  /// Mueve varias canciones de una vez al álbum [folderId] (null las deja sin álbum): una sola petición «move_songs».
  /// Admite de 1 a [kMaxMoveSongs] IDs, todos distintos.
  factory LibraryRequest.moveSongs({
    required List<String> songIds,
    required String? folderId,
    String albumName = '',
  }) {
    _checkSongIds(
      songIds,
      kMaxMoveSongs,
      empty: 'Elige al menos una canción.',
      tooMany:
          'Se pueden mover $kMaxMoveSongs canciones como mucho de una vez.',
      repeated: 'Hay canciones repetidas en la selección.',
    );
    if (folderId != null) _checkFolder(folderId);
    final count = songIds.length;
    final songs = count == 1 ? '1 canción' : '$count canciones';
    final String title;
    if (folderId == null) {
      title = 'Quitar $songs de su álbum';
    } else {
      final name = albumName.trim();
      title = name.isEmpty
          ? 'Añadir $songs al álbum $folderId'
          : 'Añadir $songs al álbum «$name»';
    }
    return LibraryRequest._(title, {
      'op': 'move_songs',
      'song_ids': List<String>.unmodifiable(songIds),
      'folder_id': folderId,
    });
  }

  /// «Ordenar canciones» de un álbum: una sola petición «order_album» con la lista COMPLETA de sus canciones en el
  /// orden nuevo (ADR-0026). El backend la rechaza si no es exactamente la del álbum; asigna las pistas 1..n.
  factory LibraryRequest.orderAlbum({
    required String folderId,
    required List<String> songIds,
    String albumName = '',
  }) {
    _checkFolder(folderId);
    _checkSongIds(
      songIds,
      kMaxOrderSongs,
      empty: 'El álbum no tiene canciones que ordenar.',
      tooMany: 'Se pueden ordenar $kMaxOrderSongs canciones como mucho.',
      repeated: 'Hay canciones repetidas en el orden.',
    );
    final name = albumName.trim();
    return LibraryRequest._(
      name.isEmpty ? 'Ordenar el álbum $folderId' : 'Ordenar el álbum «$name»',
      {
        'op': 'order_album',
        'folder_id': folderId,
        'song_ids': List<String>.unmodifiable(songIds),
      },
    );
  }

  /// «Crear álbum»: nombre y artista.
  factory LibraryRequest.createAlbum({
    required String name,
    required String artist,
  }) {
    final cleanName = _albumName(name);
    return LibraryRequest._('Crear el álbum «$cleanName»', {
      'op': 'create_folder',
      'name': cleanName,
      'artist': _albumArtist(artist),
    });
  }

  /// «Editar detalles» de un álbum: nombre y artista.
  factory LibraryRequest.editAlbum({
    required String folderId,
    required String name,
    required String artist,
  }) {
    _checkFolder(folderId);
    return LibraryRequest._('Editar el álbum $folderId', {
      'op': 'edit_folder',
      'folder_id': folderId,
      'name': _albumName(name),
      'artist': _albumArtist(artist),
    });
  }

  final String title;
  final Map<String, Object?> payload;

  /// Cuerpo de la incidencia con el formato de las peticiones: «action: organize» y el payload en JSON compacto en una
  /// sola línea, igual que buildIssueBody de la web (tests/contrato/peticiones.json).
  String get body => 'action: organize\npayload: ${jsonEncode(payload)}';
}

/// Título de incidencia en una línea y con 120 caracteres como mucho.
String cleanIssueTitle(String text) {
  final clean = text
      .replaceAll(RegExp(r'\s+'), ' ')
      .replaceAll(_control, '')
      .trim();
  if (clean.isEmpty) return 'Petición de la biblioteca';
  final runes = clean.runes.toList();
  if (runes.length <= kMaxIssueTitleLength) return clean;
  return '${String.fromCharCodes(runes.take(kMaxIssueTitleLength - 1))}…';
}
