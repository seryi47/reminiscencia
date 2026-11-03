import 'package:flutter/material.dart';

import '../layout.dart';
import '../library_controller.dart';
import '../playback.dart';
import '../services.dart';
import '../song.dart';
import '../theme.dart';
import 'common.dart';
import 'playlist_flows.dart';

/// Fila de una canción: portada de 40 px, título, artista y menú. La que suena va en verde.
class SongRow extends StatelessWidget {
  const SongRow({
    super.key,
    required this.song,
    required this.services,
    required this.onTap,
    this.playlistId,
  });

  final Song song;
  final AppServices services;
  final VoidCallback onTap;

  /// Lista desde la que se muestra, para ofrecer «Quitar de esta lista».
  final String? playlistId;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = paletteOf(context);
    return ValueListenableBuilder<NowPlaying>(
      valueListenable: services.playback.nowPlaying,
      builder: (context, now, _) {
        final current = now.songId == song.id;
        final details = songDetails(song);
        return Semantics(
          container: true,
          button: true,
          selected: current,
          label: [
            song.title,
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
                    CoverArt(seed: song.id, size: kRowArtworkSize),
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
                                if (song.local) ...[
                                  Icon(
                                    Icons.phone_android_rounded,
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
}

/// «Artista · año», o lo que haya. Las canciones subidas dicen dónde están.
String songDetails(Song song) {
  final parts = [
    if (song.artist.isNotEmpty) song.artist,
    if (song.year != null) '${song.year}',
  ];
  if (parts.isEmpty && song.local) return 'En este teléfono';
  return parts.join(' · ');
}

/// Menú de una canción en una hoja inferior: «Me gusta», añadir a una lista, quitar de la lista y borrar.
Future<void> showSongMenu(
  BuildContext context,
  AppServices services,
  Song song, {
  String? playlistId,
}) {
  return showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheetContext) => _SongMenu(
      services: services,
      song: song,
      playlistId: playlistId,
      hostContext: context,
    ),
  );
}

class _SongMenu extends StatelessWidget {
  const _SongMenu({
    required this.services,
    required this.song,
    required this.playlistId,
    required this.hostContext,
  });

  final AppServices services;
  final Song song;
  final String? playlistId;

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
                  CoverArt(seed: song.id, size: 48),
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
            ListTile(
              leading: Icon(
                liked ? Icons.favorite_rounded : Icons.favorite_border_rounded,
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
