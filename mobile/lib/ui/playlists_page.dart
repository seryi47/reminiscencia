import 'package:flutter/material.dart';

import '../collections.dart';
import '../collections_controller.dart';
import '../services.dart';
import '../song.dart';
import 'common.dart';
import 'song_tile.dart';

/// Pantalla «Listas»: las listas del usuario. Crear una lista se hace con el botón «Nueva lista».
class PlaylistsPage extends StatelessWidget {
  const PlaylistsPage({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    final collections = services.collections;
    return ListenableBuilder(
      listenable: collections,
      builder: (context, _) {
        if (!collections.loaded) {
          return const Center(child: CircularProgressIndicator());
        }
        final lists = collections.data.playlists;
        final loadError = collections.loadError;
        return Column(
          children: [
            if (loadError != null)
              InlineBanner(
                icon: Icons.error_outline,
                message: loadError,
                actionLabel: 'Reintentar',
                onAction: () => collections.load(),
              ),
            Expanded(
              child: lists.isEmpty
                  ? MessagePanel(
                      icon: Icons.queue_music_outlined,
                      message: loadError == null
                          ? 'Todavía no tienes listas. Crea una con «Nueva lista».'
                          : 'No hay listas que mostrar.',
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.only(bottom: 88),
                      itemCount: lists.length,
                      itemBuilder: (context, i) {
                        final playlist = lists[i];
                        return ListTile(
                          leading: const Icon(Icons.queue_music),
                          title: Text(
                            playlist.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(_countLabel(playlist.songIds.length)),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => PlaylistDetailPage(
                                services: services,
                                playlistId: playlist.id,
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        );
      },
    );
  }
}

/// Pide un nombre y crea la lista. Muestra el resultado o el motivo del fallo.
Future<void> createPlaylistFlow(
  BuildContext context,
  CollectionsController collections,
) async {
  final name = await showNameDialog(
    context,
    title: 'Nueva lista',
    confirmLabel: 'Crear',
  );
  if (name == null || !context.mounted) return;
  final messenger = ScaffoldMessenger.of(context);
  try {
    final created = await collections.createPlaylist(name);
    messenger.showSnackBar(
      SnackBar(content: Text('Lista «${created.name}» creada.')),
    );
  } catch (error) {
    messenger.showSnackBar(
      SnackBar(
        content: Text('No se pudo crear la lista: ${describeError(error)}'),
      ),
    );
  }
}

/// Diálogo para añadir una canción a una lista existente, o a una lista nueva.
Future<void> showAddToPlaylistDialog(
  BuildContext context,
  AppServices services,
  Song song,
) {
  return showDialog<void>(
    context: context,
    builder: (_) => _AddToPlaylistDialog(services: services, song: song),
  );
}

class _AddToPlaylistDialog extends StatelessWidget {
  const _AddToPlaylistDialog({required this.services, required this.song});

  final AppServices services;
  final Song song;

  @override
  Widget build(BuildContext context) {
    final collections = services.collections;
    return AlertDialog(
      title: const Text('Añadir a una lista'),
      content: ListenableBuilder(
        listenable: collections,
        builder: (context, _) {
          final lists = collections.data.playlists;
          final loadError = collections.loadError;
          return SizedBox(
            width: double.maxFinite,
            child: ListView(
              shrinkWrap: true,
              children: [
                if (loadError != null)
                  InlineBanner(icon: Icons.error_outline, message: loadError),
                for (final playlist in lists)
                  ListTile(
                    leading: const Icon(Icons.queue_music),
                    title: Text(
                      playlist.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(_countLabel(playlist.songIds.length)),
                    trailing: playlist.songIds.contains(song.id)
                        ? const Icon(Icons.check)
                        : null,
                    onTap: () => _addTo(context, playlist),
                  ),
                ListTile(
                  leading: const Icon(Icons.add),
                  title: const Text('Nueva lista…'),
                  onTap: () => _createAndAdd(context),
                ),
              ],
            ),
          );
        },
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cerrar'),
        ),
      ],
    );
  }

  Future<void> _addTo(BuildContext context, Playlist playlist) async {
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final added = await services.collections.addSong(playlist.id, song.id);
      navigator.pop();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            added
                ? 'Añadida a «${playlist.name}».'
                : 'Ya estaba en «${playlist.name}».',
          ),
        ),
      );
    } catch (error) {
      messenger.showSnackBar(
        SnackBar(content: Text('No se pudo añadir: ${describeError(error)}')),
      );
    }
  }

  Future<void> _createAndAdd(BuildContext context) async {
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final name = await showNameDialog(
      context,
      title: 'Nueva lista',
      confirmLabel: 'Crear',
    );
    if (name == null) return;
    try {
      final created = await services.collections.createPlaylist(name);
      await services.collections.addSong(created.id, song.id);
      navigator.pop();
      messenger.showSnackBar(
        SnackBar(content: Text('Añadida a «${created.name}».')),
      );
    } catch (error) {
      messenger.showSnackBar(
        SnackBar(
          content: Text('No se pudo crear la lista: ${describeError(error)}'),
        ),
      );
    }
  }
}

/// Detalle de una lista: reproducir, quitar canciones, añadir canciones, renombrar y borrar.
class PlaylistDetailPage extends StatelessWidget {
  const PlaylistDetailPage({
    super.key,
    required this.services,
    required this.playlistId,
  });

  final AppServices services;
  final String playlistId;

  @override
  Widget build(BuildContext context) {
    final collections = services.collections;
    final library = services.library;
    return ListenableBuilder(
      listenable: Listenable.merge([collections, library]),
      builder: (context, _) {
        final playlist = collections.data.playlistOrNull(playlistId);
        return Scaffold(
          appBar: AppBar(
            title: Text(
              playlist?.name ?? 'Lista',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            actions: [
              if (playlist != null) ...[
                IconButton(
                  tooltip: 'Renombrar lista',
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () => _rename(context, playlist),
                ),
                IconButton(
                  tooltip: 'Borrar lista',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _delete(context, playlist),
                ),
              ],
            ],
          ),
          floatingActionButton: playlist == null
              ? null
              : FloatingActionButton.extended(
                  icon: const Icon(Icons.playlist_add),
                  label: const Text('Añadir canciones'),
                  onPressed: () => _pickSongs(context, playlist.id),
                ),
          body: playlist == null
              ? MessagePanel(
                  icon: Icons.error_outline,
                  message: 'Esta lista ya no existe.',
                  actionLabel: 'Volver',
                  onAction: () => Navigator.of(context).pop(),
                )
              : _PlaylistSongs(services: services, playlist: playlist),
        );
      },
    );
  }

  Future<void> _rename(BuildContext context, Playlist playlist) async {
    final name = await showNameDialog(
      context,
      title: 'Renombrar lista',
      confirmLabel: 'Guardar',
      initial: playlist.name,
    );
    if (name == null || !context.mounted) return;
    await runWithNotice(
      context,
      () => services.collections.renamePlaylist(playlist.id, name),
      failurePrefix: 'No se pudo renombrar la lista',
    );
  }

  Future<void> _delete(BuildContext context, Playlist playlist) async {
    final confirmed = await showConfirmDialog(
      context,
      title: 'Borrar la lista',
      message:
          '«${playlist.name}» se borrará. Las canciones siguen en la biblioteca.',
      confirmLabel: 'Borrar',
    );
    if (!confirmed || !context.mounted) return;
    final navigator = Navigator.of(context);
    final deleted = await runWithNotice(
      context,
      () => services.collections.deletePlaylist(playlist.id),
      failurePrefix: 'No se pudo borrar la lista',
    );
    if (deleted) navigator.pop();
  }

  void _pickSongs(BuildContext context, String playlistId) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _SongPicker(services: services, playlistId: playlistId),
    );
  }
}

class _PlaylistSongs extends StatelessWidget {
  const _PlaylistSongs({required this.services, required this.playlist});

  final AppServices services;
  final Playlist playlist;

  @override
  Widget build(BuildContext context) {
    final library = services.library;
    final byId = {for (final song in library.songs) song.id: song};
    final songs = <Song>[];
    for (final id in playlist.songIds) {
      final song = byId[id];
      if (song != null) songs.add(song);
    }
    final missing = playlist.songIds.length - songs.length;
    return Column(
      children: [
        if (missing > 0 && library.songs.isNotEmpty)
          InlineBanner(
            icon: Icons.info_outline,
            message:
                '$missing canciones ya no están en la biblioteca y no se muestran.',
          ),
        Expanded(
          child: songs.isEmpty
              ? MessagePanel(
                  icon: Icons.playlist_add,
                  message: playlist.songIds.isEmpty
                      ? 'La lista está vacía. Usa «Añadir canciones».'
                      : 'Ninguna canción de esta lista está en la biblioteca actual.',
                )
              : ListView.builder(
                  padding: const EdgeInsets.only(bottom: 88),
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
                          tooltip: 'Quitar de la lista',
                          icon: const Icon(Icons.remove_circle_outline),
                          onPressed: () => runWithNotice(
                            context,
                            () => services.collections.removeSong(
                              playlist.id,
                              song.id,
                            ),
                            failurePrefix: 'No se pudo quitar la canción',
                          ),
                        ),
                      ],
                    );
                  },
                ),
        ),
      ],
    );
  }
}

/// Hoja con toda la biblioteca: marcar o desmarcar canciones de la lista.
class _SongPicker extends StatelessWidget {
  const _SongPicker({required this.services, required this.playlistId});

  final AppServices services;
  final String playlistId;

  @override
  Widget build(BuildContext context) {
    final library = services.library;
    final collections = services.collections;
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.8,
      child: ListenableBuilder(
        listenable: Listenable.merge([library, collections]),
        builder: (context, _) {
          final playlist = collections.data.playlistOrNull(playlistId);
          if (playlist == null) {
            return const MessagePanel(
              icon: Icons.error_outline,
              message: 'Esta lista ya no existe.',
            );
          }
          final songs = library.songs;
          if (songs.isEmpty) {
            return MessagePanel(
              icon: Icons.library_music_outlined,
              message: library.loadError ?? 'La biblioteca está vacía.',
            );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Text(
                  'Añadir canciones',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              Expanded(
                child: ListView.builder(
                  itemCount: songs.length,
                  itemBuilder: (context, i) {
                    final song = songs[i];
                    return CheckboxListTile(
                      value: playlist.songIds.contains(song.id),
                      title: Text(
                        song.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: song.artist.isEmpty
                          ? null
                          : Text(
                              song.artist,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                      onChanged: (checked) => runWithNotice(context, () async {
                        if (checked == true) {
                          await collections.addSong(playlist.id, song.id);
                        } else {
                          await collections.removeSong(playlist.id, song.id);
                        }
                      }, failurePrefix: 'No se pudo cambiar la lista'),
                    );
                  },
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

String _countLabel(int count) => count == 1 ? '1 canción' : '$count canciones';
