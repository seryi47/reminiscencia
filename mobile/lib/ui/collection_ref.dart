import 'package:flutter/material.dart';

import '../services.dart';
import '../song.dart';
import 'common.dart';

/// Color fijo de «Canciones que te gustan».
const Color kLikedColor = Color(0xFF4B2FBF);

/// Una colección de canciones que se abre en su propia página: carpeta del catálogo, lista propia,
/// «Me gusta», lo subido en este teléfono, todo el catálogo o lo añadido recientemente.
sealed class CollectionRef {
  const CollectionRef();

  /// Clave estable (portada, comparación).
  String get key;
}

class LikedRef extends CollectionRef {
  const LikedRef();
  @override
  String get key => 'me-gusta';
}

class PlaylistRef extends CollectionRef {
  const PlaylistRef(this.id);
  final String id;
  @override
  String get key => 'lista:$id';
}

class FolderRef extends CollectionRef {
  const FolderRef(this.id);
  final String id;
  @override
  String get key => 'carpeta:$id';
}

class LocalRef extends CollectionRef {
  const LocalRef();
  @override
  String get key => 'local';
}

class AllSongsRef extends CollectionRef {
  const AllSongsRef();
  @override
  String get key => 'todas';
}

class RecentRef extends CollectionRef {
  const RecentRef();
  @override
  String get key => 'recientes';
}

/// Lo que la interfaz necesita de una colección, ya resuelto contra la biblioteca y las listas.
class CollectionView {
  const CollectionView({
    required this.ref,
    required this.title,
    required this.kind,
    required this.songs,
    required this.icon,
    required this.exists,
    this.color,
    this.missing = 0,
    this.emptyMessage = 'Aquí no hay canciones todavía.',
  });

  final CollectionRef ref;
  final String title;

  /// Tipo, para el subtítulo: «Lista», «Carpeta»…
  final String kind;
  final List<Song> songs;
  final IconData icon;
  final Color? color;

  /// False si la lista o la carpeta ya no existe.
  final bool exists;

  /// Canciones guardadas en la lista que ya no están en la biblioteca.
  final int missing;
  final String emptyMessage;

  String get subtitle => '$kind · ${songCountLabel(songs.length)}';
}

/// Resuelve [ref] con el estado actual de la biblioteca y de las listas.
CollectionView resolveCollection(AppServices services, CollectionRef ref) {
  final library = services.library;
  final data = services.collections.data;
  final byId = {for (final song in library.songs) song.id: song};
  List<Song> pick(List<String> ids) => [
    for (final id in ids)
      if (byId[id] != null) byId[id]!,
  ];
  switch (ref) {
    case LikedRef():
      final songs = pick(data.favorites);
      return CollectionView(
        ref: ref,
        title: 'Canciones que te gustan',
        kind: 'Lista',
        songs: songs,
        icon: Icons.favorite_rounded,
        color: kLikedColor,
        exists: true,
        missing: library.songs.isEmpty
            ? 0
            : data.favorites.length - songs.length,
        emptyMessage:
            'Las canciones que marques con «Me gusta» aparecerán aquí.',
      );
    case PlaylistRef(:final id):
      final playlist = data.playlistOrNull(id);
      if (playlist == null) {
        return CollectionView(
          ref: ref,
          title: 'Lista',
          kind: 'Lista',
          songs: const [],
          icon: Icons.queue_music_rounded,
          exists: false,
          emptyMessage: 'Esta lista ya no existe.',
        );
      }
      final songs = pick(playlist.songIds);
      return CollectionView(
        ref: ref,
        title: playlist.name,
        kind: 'Lista',
        songs: songs,
        icon: Icons.queue_music_rounded,
        exists: true,
        missing: library.songs.isEmpty
            ? 0
            : playlist.songIds.length - songs.length,
        emptyMessage: playlist.songIds.isEmpty
            ? 'La lista está vacía. Usa «Añadir canciones».'
            : 'Ninguna canción de esta lista está en la biblioteca actual.',
      );
    case FolderRef(:final id):
      final folder = library.folderOrNull(id);
      return CollectionView(
        ref: ref,
        title: folder?.name ?? 'Carpeta',
        kind: 'Carpeta',
        songs: folder == null ? const [] : library.songsInFolder(id),
        icon: Icons.folder_rounded,
        exists: folder != null,
        emptyMessage: folder == null
            ? 'Esta carpeta ya no está en la biblioteca.'
            : 'No hay canciones en esta carpeta.',
      );
    case LocalRef():
      return CollectionView(
        ref: ref,
        title: 'En este teléfono',
        kind: 'Subidas',
        songs: library.localSongs,
        icon: Icons.phone_android_rounded,
        exists: true,
        emptyMessage:
            'Todavía no has subido canciones. Usa «Subir canciones» en Tu biblioteca.',
      );
    case AllSongsRef():
      return CollectionView(
        ref: ref,
        title: 'Todas las canciones',
        kind: 'Biblioteca',
        songs: library.songs,
        icon: Icons.library_music_rounded,
        exists: true,
        emptyMessage: 'Sin canciones todavía.',
      );
    case RecentRef():
      return CollectionView(
        ref: ref,
        title: 'Añadidas recientemente',
        kind: 'Biblioteca',
        songs: library.recentSongs(limit: 50),
        icon: Icons.schedule_rounded,
        exists: true,
        emptyMessage: 'Sin canciones todavía.',
      );
  }
}
