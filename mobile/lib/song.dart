import 'covers.dart';

/// Una canción del catálogo público (https://reminiscencia.cometia.es/data/songs.json).
class Song {
  const Song({
    required this.id,
    required this.title,
    required this.artist,
    required this.year,
    required this.tags,
    required this.folderId,
    required this.durationS,
    required this.license,
    required this.audio,
    this.cover,
    this.local = false,
    this.uploadStatus,
    this.track,
    this.pendingEdit = false,
  });

  final String id;
  final String title;
  final String artist;
  final int? year;
  final List<String> tags;
  final String? folderId;
  final double durationS;
  final String license;

  /// Ruta relativa a la web, por ejemplo "audio/S123.opus". En una canción local (ADR-0013) es la ruta absoluta del fichero.
  final String audio;

  /// Portada publicada, relativa a la web (`covers/<id>.jpg`). Null si no tiene o si la ruta no es válida.
  final String? cover;

  /// True si la canción se subió desde este teléfono. Nunca viene del catálogo público.
  final bool local;

  /// Estado de una canción recién subida desde este teléfono que todavía no está en el catálogo público
  /// («Publicándose…» o «Error»). Suena desde su copia Opus local. Null en el resto de canciones.
  final String? uploadStatus;

  /// Número de pista dentro de su álbum (ADR-0026): entero desde 1. Null si no tiene álbum o el catálogo no lo trae.
  final int? track;

  /// True si se ve con un cambio enviado que todavía no ha llegado al catálogo (ADR-0027, «Pendiente»).
  final bool pendingEdit;

  /// True si es una subida que todavía no se ha publicado.
  bool get provisional => uploadStatus != null;

  factory Song.fromJson(Map<String, dynamic> json) {
    return Song(
      id: json['id'] as String,
      title: json['title'] as String,
      artist: (json['artist'] as String?) ?? '',
      year: (json['year'] as num?)?.toInt(),
      tags: ((json['tags'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
      folderId: json['folder_id'] as String?,
      durationS: (json['duration_s'] as num).toDouble(),
      license: (json['license'] as String?) ?? '',
      audio: json['audio'] as String,
      cover: cleanCoverPath(json['cover']),
      track: cleanTrack(json['track']),
    );
  }
}

/// Número de pista válido (entero desde 1) o null. Un 2.0, un texto o un booleano no valen.
int? cleanTrack(Object? value) => value is int && value >= 1 ? value : null;

/// Canciones de un álbum en su orden (ADR-0026): primero las que tienen número de pista, de menor a mayor (a igualdad,
/// en el orden en que llegan), y después las que no lo tienen, en el orden en que llegan (el de hoy).
List<Song> sortByTrack(Iterable<Song> songs) {
  final indexed = songs.toList().asMap().entries.toList();
  indexed.sort((a, b) {
    final ta = a.value.track;
    final tb = b.value.track;
    if (ta != null && tb != null && ta != tb) return ta.compareTo(tb);
    if (ta != null && tb == null) return -1;
    if (ta == null && tb != null) return 1;
    return a.key.compareTo(b.key);
  });
  return [for (final entry in indexed) entry.value];
}

/// Álbum del catálogo (https://reminiscencia.cometia.es/data/folders.json). En los datos se llama «carpeta» (folder).
class Folder {
  const Folder({
    required this.id,
    required this.name,
    required this.parentId,
    this.artist = '',
    this.cover,
    this.pendingEdit = false,
  });

  final String id;
  final String name;
  final String? parentId;

  /// Artista del álbum. Vacío si no se conoce.
  final String artist;

  /// Portada publicada, relativa a la web (`covers/<id>.jpg`). Null si no tiene.
  final String? cover;

  /// True si se ve con un cambio enviado que todavía no ha llegado al catálogo (ADR-0027, «Pendiente»).
  final bool pendingEdit;

  factory Folder.fromJson(Map<String, dynamic> json) => Folder(
    id: json['id'] as String,
    name: json['name'] as String,
    parentId: json['parent_id'] as String?,
    artist: json['artist'] is String ? (json['artist'] as String).trim() : '',
    cover: cleanCoverPath(json['cover']),
  );
}
