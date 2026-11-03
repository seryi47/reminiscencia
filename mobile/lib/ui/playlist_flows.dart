import 'package:flutter/material.dart';

import '../collections.dart';
import '../collections_controller.dart';
import '../services.dart';
import '../song.dart';
import 'common.dart';

/// Pide un nombre y crea la lista. Muestra el resultado o el motivo del fallo.
/// Devuelve la lista creada, o null.
Future<Playlist?> createPlaylistFlow(
  BuildContext context,
  CollectionsController collections,
) async {
  final name = await showNameDialog(
    context,
    title: 'Nueva lista',
    confirmLabel: 'Crear',
  );
  if (name == null || !context.mounted) return null;
  final messenger = ScaffoldMessenger.of(context);
  try {
    final created = await collections.createPlaylist(name);
    messenger.showSnackBar(
      SnackBar(content: Text('Lista «${created.name}» creada.')),
    );
    return created;
  } catch (error) {
    messenger.showSnackBar(
      SnackBar(
        content: Text('No se pudo crear la lista: ${describeError(error)}'),
      ),
    );
    return null;
  }
}

Future<void> renamePlaylistFlow(
  BuildContext context,
  AppServices services,
  Playlist playlist,
) async {
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

/// Borra la lista tras confirmar. Devuelve true si se borró.
Future<bool> deletePlaylistFlow(
  BuildContext context,
  AppServices services,
  Playlist playlist,
) async {
  final confirmed = await showConfirmDialog(
    context,
    title: 'Borrar la lista',
    message:
        '«${playlist.name}» se borrará. Las canciones siguen en la biblioteca.',
    confirmLabel: 'Borrar',
  );
  if (!confirmed || !context.mounted) return false;
  return runWithNotice(
    context,
    () => services.collections.deletePlaylist(playlist.id),
    failurePrefix: 'No se pudo borrar la lista',
  );
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
                ListTile(
                  leading: const Icon(Icons.add_rounded),
                  title: const Text('Nueva lista…'),
                  onTap: () => _createAndAdd(context),
                ),
                for (final playlist in lists)
                  ListTile(
                    leading: CoverArt(
                      seed: playlist.id,
                      size: 40,
                      icon: Icons.queue_music_rounded,
                    ),
                    title: Text(
                      playlist.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(songCountLabel(playlist.songIds.length)),
                    trailing: playlist.songIds.contains(song.id)
                        ? Icon(
                            Icons.check_circle_rounded,
                            color: Theme.of(context).colorScheme.primary,
                            semanticLabel: 'Ya está en la lista',
                          )
                        : null,
                    onTap: () => _addTo(context, playlist),
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

/// Hoja con toda la biblioteca para marcar o desmarcar canciones de una lista.
Future<void> showSongPicker(
  BuildContext context,
  AppServices services,
  String playlistId,
) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useRootNavigator: true,
    builder: (_) => _SongPicker(services: services, playlistId: playlistId),
  );
}

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
                child: Semantics(
                  header: true,
                  child: Text(
                    'Añadir canciones a «${playlist.name}»',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
              ),
              Expanded(
                child: ListView.builder(
                  itemCount: songs.length,
                  itemBuilder: (context, i) {
                    final song = songs[i];
                    return CheckboxListTile(
                      value: playlist.songIds.contains(song.id),
                      activeColor: Theme.of(context).colorScheme.primary,
                      checkColor: Theme.of(context).colorScheme.onPrimary,
                      secondary: CoverArt(seed: song.id, size: 40),
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
