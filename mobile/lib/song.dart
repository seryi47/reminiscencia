import 'covers.dart';

/// Una canción del catálogo público (https://reminiscencia.vercel.app/data/songs.json).
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
    );
  }
}

/// Álbum del catálogo (https://reminiscencia.vercel.app/data/folders.json). En los datos se llama «carpeta» (folder).
class Folder {
  const Folder({
    required this.id,
    required this.name,
    required this.parentId,
    this.artist = '',
    this.cover,
  });

  final String id;
  final String name;
  final String? parentId;

  /// Artista del álbum. Vacío si no se conoce.
  final String artist;

  /// Portada publicada, relativa a la web (`covers/<id>.jpg`). Null si no tiene.
  final String? cover;

  factory Folder.fromJson(Map<String, dynamic> json) => Folder(
    id: json['id'] as String,
    name: json['name'] as String,
    parentId: json['parent_id'] as String?,
    artist: json['artist'] is String ? (json['artist'] as String).trim() : '',
    cover: cleanCoverPath(json['cover']),
  );
}
