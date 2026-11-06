import 'package:flutter/material.dart';

import '../layout.dart';
import '../library_controller.dart';
import '../playback.dart';
import '../services.dart';
import '../song.dart';
import '../theme.dart';
import '../upload_tracker.dart';
import 'common.dart';
import 'library_edit.dart';
import 'pending_edits_panel.dart';
import 'playlist_flows.dart';

/// Fila de una canción: portada de 40 px, título, artista y menú. La que suena va en verde.
class SongRow extends StatelessWidget {
  const SongRow({
    super.key,
    required this.song,
    required this.services,
    required this.onTap,
    this.playlistId,
    this.albumId,
  });

  final Song song;
  final AppServices services;
  final VoidCallback onTap;

  /// Lista desde la que se muestra, para ofrecer «Quitar de esta lista».
  final String? playlistId;

  /// Álbum de la biblioteca común desde el que se muestra, para ofrecer «Quitar de este álbum».
  final String? albumId;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = paletteOf(context);
    return ValueListenableBuilder<NowPlaying>(
      valueListenable: services.playback.nowPlaying,
      builder: (context, now, _) {
        final current = now.songId == song.id;
        final details = songDetails(song);
        final uploadFailed = song.uploadStatus == kUploadErrorLabel;
        return Semantics(
          container: true,
          button: true,
          selected: current,
          label: [
            song.title,
            if (song.pendingEdit) 'cambio pendiente',
            if (details.isNotEmpty) details,
            formatDuration(song.durationS),
            if (current) now.playing ? 'sonando' : 'en pausa',
          ].join(', '),
          child: InkWell(
            onTap: onTap,
            highlightColor: palette.cardPressed,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 56),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 4, 6),
                child: Row(
                  children: [
                    CatalogCover(
                      covers: services.covers,
                      cover: song.cover,
                      seed: song.id,
                      size: kRowArtworkSize,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: ExcludeSemantics(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              song.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.bodyLarge?.copyWith(
                                color: current ? palette.accent : palette.ink,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            Row(
                              children: [
                                if (song.pendingEdit) ...[
                                  const PendingEditBadge(),
                                  const SizedBox(width: 6),
                                ],
                                if (song.local) ...[
                                  Icon(
                                    song.provisional
                                        ? Icons.cloud_upload_outlined
                                        : Icons.phone_android_rounded,
                                    size: 14,
                                    color: palette.inkMuted,
                                  ),
                                  const SizedBox(width: 4),
                                ],
                                Expanded(
                                  child: Text(
                                    details.isEmpty
                                        ? formatDuration(song.durationS)
                                        : '$details · ${formatDuration(song.durationS)}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: theme.textTheme.bodySmall,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (uploadFailed)
                      Semantics(
                        button: true,
                        label: 'Reintentar la subida de «${song.title}»',
                        onTap: () => _retry(context),
                        excludeSemantics: true,
                        child: TextButton(
                          onPressed: () => _retry(context),
                          style: TextButton.styleFrom(
                            minimumSize: const Size(48, 48),
                            tapTargetSize: MaterialTapTargetSize.padded,
                          ),
                          child: const Text('Reintentar'),
                        ),
                      ),
                    IconButton(
                      tooltip: 'Más opciones de «${song.title}»',
                      icon: Icon(
                        Icons.more_vert_rounded,
                        color: palette.inkMuted,
                      ),
                      onPressed: () => showSongMenu(
                        context,
                        services,
                        song,
                        playlistId: playlistId,
                        albumId: albumId,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _retry(BuildContext context) => runWithNotice(
    context,
    () => services.library.retryUpload(song.id),
    failurePrefix: 'No se pudo reintentar',
  );
}

/// «Artista · año», o lo que haya. Las canciones subidas dicen dónde están; las que se están publicando, su estado.
String songDetails(Song song) {
  final status = song.uploadStatus;
  if (status != null) return status;
  final parts = [
    if (song.artist.isNotEmpty) song.artist,
    if (song.year != null) '${song.year}',
  ];
  if (parts.isEmpty && song.local) return 'En este teléfono';
  return parts.join(' · ');
}

/// Menú de una canción en una hoja inferior: «Me gusta», añadir a una lista, quitar de la lista y borrar.
/// Las canciones de la biblioteca común añaden las acciones de edición, que se guardan para todos.
/// Desde la página de un álbum ([albumId]) se ofrece además «Quitar de este álbum».
Future<void> showSongMenu(
  BuildContext context,
  AppServices services,
  Song song, {
  String? playlistId,
  String? albumId,
}) {
  return showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheetContext) => _SongMenu(
      services: services,
      song: song,
      playlistId: playlistId,
      albumId: albumId,
      hostContext: context,
    ),
  );
}

class _SongMenu extends StatelessWidget {
  const _SongMenu({
    required this.services,
    required this.song,
    required this.playlistId,
    required this.albumId,
    required this.hostContext,
  });

  final AppServices services;
  final Song song;
  final String? playlistId;
  final String? albumId;

  /// Contexto de la página que abrió el menú: los diálogos y avisos se muestran ahí.
  final BuildContext hostContext;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final collections = services.collections;
    final liked = collections.isFavorite(song.id);
    final details = songDetails(song);
    void close() => Navigator.of(context).pop();
    return SafeArea(
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Row(
                children: [
                  CatalogCover(
                    covers: services.covers,
                    cover: song.cover,
                    seed: song.id,
                    size: 48,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          song.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.titleMedium,
                        ),
                        if (details.isNotEmpty)
                          Text(details, style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            if (song.provisional) ...[
              if (song.uploadStatus == kUploadErrorLabel)
                ListTile(
                  leading: const Icon(Icons.refresh_rounded),
                  title: const Text('Reintentar la subida'),
                  onTap: () {
                    close();
                    runWithNotice(
                      hostContext,
                      () => services.library.retryUpload(song.id),
                      failurePrefix: 'No se pudo reintentar',
                    );
                  },
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                child: Text(
                  'Suena desde la copia de este teléfono. Cuando se publique podrás añadirla a «Me gusta» y a tus listas.',
                  style: theme.textTheme.bodySmall,
                ),
              ),
            ] else ...[
              ListTile(
                leading: Icon(
                  liked
                      ? Icons.favorite_rounded
                      : Icons.favorite_border_rounded,
                  color: liked ? theme.colorScheme.primary : null,
                ),
                title: Text(liked ? 'Quitar de Me gusta' : 'Añadir a Me gusta'),
                onTap: () {
                  close();
                  runWithNotice(hostContext, () async {
                    await collections.toggleFavorite(song.id);
                  }, failurePrefix: 'No se pudo cambiar «Me gusta»');
                },
              ),
              ListTile(
                leading: const Icon(Icons.playlist_add_rounded),
                title: const Text('Añadir a una lista'),
                onTap: () {
                  close();
                  showAddToPlaylistDialog(hostContext, services, song);
                },
              ),
              if (playlistId != null)
                ListTile(
                  leading: const Icon(Icons.remove_circle_outline_rounded),
                  title: const Text('Quitar de esta lista'),
                  onTap: () {
                    close();
                    runWithNotice(
                      hostContext,
                      () => collections.removeSong(playlistId!, song.id),
                      failurePrefix: 'No se pudo quitar la canción',
                    );
                  },
                ),
              if (song.local)
                ListTile(
                  leading: const Icon(Icons.delete_outline_rounded),
                  title: const Text('Borrar de este teléfono'),
                  onTap: () {
                    close();
                    confirmDeleteLocal(hostContext, services.library, song);
                  },
                ),
              if (isEditableSong(song))
                ...libraryEditTiles(
                  hostContext: hostContext,
                  services: services,
                  close: close,
                  editDetails: () =>
                      editSongDetailsFlow(hostContext, services, song),
                  addToAlbum: () =>
                      addSongToAlbumFlow(hostContext, services, song),
                  coverId: song.id,
                  coverWhat: 'la canción',
                ),
              if (albumId != null &&
                  isEditableSong(song) &&
                  song.folderId == albumId)
                ListTile(
                  key: const ValueKey('remove-from-album'),
                  leading: const Icon(Icons.remove_circle_outline_rounded),
                  title: const Text('Quitar de este álbum'),
                  onTap: () {
                    close();
                    removeSongFromAlbumFlow(
                      hostContext,
                      services,
                      song,
                      albumName:
                          services.library.folderOrNull(albumId!)?.name ?? '',
                    );
                  },
                ),
            ],
            if (song.license.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Text(
                  'Licencia: ${song.license}',
                  style: theme.textTheme.bodySmall,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Borra una canción subida desde este teléfono tras pedir confirmación.
Future<void> confirmDeleteLocal(
  BuildContext context,
  LibraryController library,
  Song song,
) async {
  final confirmed = await showConfirmDialog(
    context,
    title: 'Borrar canción',
    message: '¿Borrar «${song.title}» de este teléfono? No se puede deshacer.',
    confirmLabel: 'Borrar',
  );
  if (!confirmed || !context.mounted) return;
  await runWithNotice(
    context,
    () => library.deleteLocal(song),
    failurePrefix: 'No se pudo borrar «${song.title}»',
  );
}
