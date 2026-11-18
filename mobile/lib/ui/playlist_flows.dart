import 'package:flutter/material.dart';

import '../app_error.dart';
import '../collections.dart';
import '../collections_controller.dart';
import '../services.dart';
import '../song.dart';
import 'collection_ref.dart';
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

/// «Editar detalles» de una lista propia: nombre y descripción. Se guarda solo en este teléfono.
Future<void> editPlaylistFlow(
  BuildContext context,
  AppServices services,
  Playlist playlist,
) async {
  final result = await showDialog<({String name, String description})>(
    context: context,
    builder: (_) => _PlaylistDetailsDialog(playlist: playlist),
  );
  if (result == null || !context.mounted) return;
  await runWithNotice(
    context,
    () => services.collections.editPlaylist(
      playlist.id,
      name: result.name,
      description: result.description,
    ),
    failurePrefix: 'No se pudo guardar la lista',
  );
}

/// «Cambiar portada» de una lista propia: elegir una imagen del teléfono (se reduce a 640 px y se guarda
/// solo aquí) o quitarla.
Future<void> playlistCoverFlow(
  BuildContext context,
  AppServices services,
  Playlist playlist,
) async {
  final hasCover = playlist.coverFile != null;
  final choice = await showModalBottomSheet<String>(
    context: context,
    useRootNavigator: true,
    builder: (sheetContext) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
            child: Semantics(
              header: true,
              child: Text(
                'Portada de «${playlist.name}»',
                style: Theme.of(sheetContext).textTheme.titleLarge,
              ),
            ),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(
              'La imagen se reduce a 640 px y se guarda solo en este teléfono: no se publica ni entra en la copia de seguridad.',
            ),
          ),
          ListTile(
            key: const Key('playlist-cover-pick'),
            leading: const Icon(Icons.photo_library_outlined),
            title: const Text('Elegir una imagen del teléfono'),
            onTap: () => Navigator.of(sheetContext).pop('pick'),
          ),
          if (hasCover)
            ListTile(
              key: const Key('playlist-cover-remove'),
              leading: const Icon(Icons.hide_image_outlined),
              title: const Text('Quitar la portada'),
              onTap: () => Navigator.of(sheetContext).pop('remove'),
            ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
  if (choice == null || !context.mounted) return;
  if (choice == 'remove') {
    await runWithNotice(
      context,
      () => services.collections.removePlaylistCover(playlist.id),
      failurePrefix: 'No se pudo quitar la portada',
    );
    return;
  }
  await runWithNotice(context, () async {
    final bytes = await services.pickImage();
    if (bytes == null) return;
    await services.collections.setPlaylistCover(playlist.id, bytes);
  }, failurePrefix: 'No se pudo cambiar la portada');
}

class _PlaylistDetailsDialog extends StatefulWidget {
  const _PlaylistDetailsDialog({required this.playlist});

  final Playlist playlist;

  @override
  State<_PlaylistDetailsDialog> createState() => _PlaylistDetailsDialogState();
}

class _PlaylistDetailsDialogState extends State<_PlaylistDetailsDialog> {
  late final TextEditingController _name = TextEditingController(
    text: widget.playlist.name,
  );
  late final TextEditingController _description = TextEditingController(
    text: widget.playlist.description,
  );
  String? _nameError;
  String? _descriptionError;

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  void _submit() {
    String? name;
    String? description;
    String? nameError;
    String? descriptionError;
    try {
      name = cleanPlaylistName(_name.text);
    } on AppException catch (error) {
      nameError = error.message;
    }
    try {
      description = cleanPlaylistDescription(_description.text);
    } on AppException catch (error) {
      descriptionError = error.message;
    }
    if (name == null || description == null) {
      setState(() {
        _nameError = nameError;
        _descriptionError = descriptionError;
      });
      return;
    }
    Navigator.of(context).pop((name: name, description: description));
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Editar detalles'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              key: const Key('playlist-name'),
              controller: _name,
              autofocus: true,
              maxLength: kMaxPlaylistNameLength,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: 'Nombre',
                errorText: _nameError,
              ),
            ),
            TextField(
              key: const Key('playlist-description'),
              controller: _description,
              maxLength: kMaxPlaylistDescriptionLength,
              minLines: 2,
              maxLines: 4,
              decoration: InputDecoration(
                labelText: 'Descripción (opcional)',
                errorText: _descriptionError,
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(onPressed: _submit, child: const Text('Guardar')),
      ],
    );
  }
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
                      seed: PlaylistRef(playlist.id).key,
                      size: 40,
                      icon: Icons.queue_music_rounded,
                      image: _playlistImage(collections, playlist),
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
                      secondary: CatalogCover(
                        covers: services.covers,
                        cover: song.cover,
                        seed: song.id,
                        size: 40,
                      ),
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

ImageProvider? _playlistImage(
  CollectionsController collections,
  Playlist playlist,
) {
  final file = collections.coverFileOf(playlist);
  return file == null ? null : FileImage(file);
}
