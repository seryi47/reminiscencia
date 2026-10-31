import 'package:flutter/material.dart';

import '../services.dart';
import '../song.dart';
import 'common.dart';
import 'song_tile.dart';

/// Pantalla «Favoritos»: las canciones marcadas con la estrella, en el orden en que se marcaron.
class FavoritesPage extends StatelessWidget {
  const FavoritesPage({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    final library = services.library;
    final collections = services.collections;
    return ListenableBuilder(
      listenable: Listenable.merge([library, collections]),
      builder: (context, _) {
        final ids = collections.data.favorites;
        final byId = {for (final song in library.songs) song.id: song};
        final songs = <Song>[];
        for (final id in ids) {
          final song = byId[id];
          if (song != null) songs.add(song);
        }
        final missing = ids.length - songs.length;
        final collectionsError = collections.loadError;
        final libraryError = library.loadError;

        final Widget body;
        if (collectionsError != null) {
          body = MessagePanel(
            icon: Icons.error_outline,
            message:
                'No se pueden mostrar tus favoritos hasta que se puedan leer tus listas guardadas.',
          );
        } else if (ids.isEmpty) {
          body = const MessagePanel(
            icon: Icons.favorite_border,
            message:
                'Todavía no tienes favoritos. Pulsa la estrella de una canción para guardarla aquí.',
          );
        } else if (songs.isEmpty) {
          body = MessagePanel(
            icon: Icons.cloud_off_outlined,
            message: library.loading
                ? 'Cargando la biblioteca…'
                : 'Tus favoritos no están en la biblioteca actual.',
          );
        } else {
          body = ListView.builder(
            padding: const EdgeInsets.only(bottom: 8),
            itemCount: songs.length,
            itemBuilder: (context, i) {
              final song = songs[i];
              return SongTile(
                song: song,
                playback: services.playback,
                position: i + 1,
                onTap: () => runWithNotice(
                  context,
                  () => services.playback.playAt(songs, i),
                  failurePrefix: 'No se pudo reproducir',
                ),
                trailing: [
                  IconButton(
                    tooltip: 'Quitar de favoritos',
                    icon: const Icon(Icons.star),
                    onPressed: () => runWithNotice(context, () async {
                      await collections.toggleFavorite(song.id);
                    }, failurePrefix: 'No se pudo quitar de favoritos'),
                  ),
                ],
              );
            },
          );
        }

        return Column(
          children: [
            if (collectionsError != null)
              InlineBanner(
                icon: Icons.error_outline,
                message: collectionsError,
                actionLabel: 'Reintentar',
                onAction: () => collections.load(),
              ),
            if (libraryError != null && library.songs.isEmpty)
              InlineBanner(
                icon: Icons.cloud_off_outlined,
                message: libraryError,
                actionLabel: 'Reintentar',
                onAction: () => library.load(),
              ),
            if (missing > 0 && library.songs.isNotEmpty)
              InlineBanner(
                icon: Icons.info_outline,
                message: missing == 1
                    ? '1 favorita ya no está en la biblioteca y no se muestra.'
                    : '$missing favoritas ya no están en la biblioteca y no se muestran.',
              ),
            Expanded(child: body),
          ],
        );
      },
    );
  }
}
