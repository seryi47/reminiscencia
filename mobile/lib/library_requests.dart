import 'dart:convert';

import 'app_error.dart';

// Peticiones a la biblioteca común (ADR-0008). La app no escribe en el catálogo ni guarda ninguna sesión:
// prepara una incidencia nueva de GitHub con la etiqueta «biblioteca» y la abre en el navegador. Solo las cuentas
// con permiso de escritura en el repositorio la procesan. El cuerpo sigue el contrato del backend
// (backend/sonidos/issue_request.py): «action: organize» y «payload: <JSON en una línea>».

const String kLibraryRepo = 'seryi47/reminiscencia';
const String kLibraryIssueLabel = 'biblioteca';

/// Límites (en caracteres) que la app valida antes de enviar el cambio.
const int kMaxAlbumNameLength = 80;
const int kMaxArtistLength = 80;
const int kMaxSongTitleLength = 200;
const int kMaxIssueTitleLength = 120;

/// Canciones que se pueden mover de una vez con «move_songs».
const int kMaxMoveSongs = 100;

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

bool isCatalogSongId(String id) => _songId.hasMatch(id);
bool isCatalogFolderId(String id) => _folderId.hasMatch(id);

/// Si se puede pedir «Cambiar portada»: solo canciones (S + 16) y álbumes nuevos (F + 16), que tienen
/// un nombre de archivo único en el buzón de portadas.
bool canChangeCatalogCover(String id) =>
    _songId.hasMatch(id) || _newFolderId.hasMatch(id);

/// Valida un texto de una sola línea: sin saltos ni caracteres de control, recortado y con [min] a [max] caracteres.
/// Devuelve el texto limpio o lanza AppException con el motivo.
String cleanRequestText(
  String raw, {
  required String field,
  required int min,
  required int max,
}) {
  if (_control.hasMatch(raw)) {
    throw AppException(
      '$field debe ir en una sola línea, sin caracteres especiales.',
    );
  }
  final clean = raw.trim();
  final length = clean.runes.length;
  if (length < min) {
    throw AppException('$field no puede quedar en blanco.');
  }
  if (length > max) {
    throw AppException('$field no puede tener más de $max caracteres.');
  }
  return clean;
}

String _albumName(String raw) => cleanRequestText(
  raw,
  field: 'El nombre del álbum',
  min: 1,
  max: kMaxAlbumNameLength,
);

String _artist(String raw) =>
    cleanRequestText(raw, field: 'El artista', min: 0, max: kMaxArtistLength);

void _checkSong(String songId) {
  if (!isCatalogSongId(songId)) {
    throw const AppException(
      'Solo se pueden editar las canciones de la biblioteca común.',
    );
  }
}

void _checkFolder(String folderId, {String field = 'El álbum'}) {
  if (!isCatalogFolderId(folderId)) {
    throw AppException('$field no es un álbum de la biblioteca común.');
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
    );
    return LibraryRequest._('Editar la canción $songId', {
      'op': 'edit_song',
      'song_id': songId,
      'title': cleanTitle,
      'artist': _artist(artist),
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
    if (songIds.isEmpty) {
      throw const AppException('Elige al menos una canción.');
    }
    if (songIds.length > kMaxMoveSongs) {
      throw const AppException(
        'Se pueden mover $kMaxMoveSongs canciones como mucho de una vez.',
      );
    }
    if (songIds.toSet().length != songIds.length) {
      throw const AppException('Hay canciones repetidas en la selección.');
    }
    songIds.forEach(_checkSong);
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

  /// «Crear álbum»: nombre y artista.
  factory LibraryRequest.createAlbum({
    required String name,
    required String artist,
  }) {
    final cleanName = _albumName(name);
    return LibraryRequest._('Crear el álbum «$cleanName»', {
      'op': 'create_folder',
      'name': cleanName,
      'artist': _artist(artist),
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
      'artist': _artist(artist),
    });
  }

  final String title;
  final Map<String, Object?> payload;

  /// Cuerpo de la incidencia con el formato de las peticiones.
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
