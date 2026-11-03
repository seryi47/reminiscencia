import 'package:flutter/material.dart';

import '../playback.dart';
import '../services.dart';
import '../theme.dart';
import 'collection_ref.dart';
import 'common.dart';
import 'playlist_flows.dart';
import 'song_row.dart';

/// Abre una colección dentro de la pestaña actual (la barra inferior y el minirreproductor siguen a la vista).
Future<void> openCollection(
  BuildContext context,
  AppServices services,
  CollectionRef ref,
) {
  return Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => CollectionPage(services: services, ref: ref),
    ),
  );
}

/// Página de carpeta o lista: cabecera en degradado, botón verde de reproducir y filas de canción.
class CollectionPage extends StatelessWidget {
  const CollectionPage({super.key, required this.services, required this.ref});

  final AppServices services;
  final CollectionRef ref;

  @override
  Widget build(BuildContext context) {
    final library = services.library;
    final collections = services.collections;
    return ListenableBuilder(
      listenable: Listenable.merge([library, collections]),
      builder: (context, _) {
        final view = resolveCollection(services, ref);
        final palette = paletteOf(context);
        final theme = Theme.of(context);
        final color = view.color ?? coverColorFor(ref.key);
        final playlistId = switch (ref) {
          PlaylistRef(:final id) when view.exists => id,
          _ => null,
        };
        final songs = view.songs;
        return Scaffold(
          backgroundColor: palette.background,
          body: CustomScrollView(
            slivers: [
              SliverAppBar(
                pinned: true,
                backgroundColor: Color.lerp(color, Colors.black, 0.45),
                title: Text(
                  view.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                leading: IconButton(
                  tooltip: 'Volver',
                  icon: const Icon(Icons.arrow_back_rounded),
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
              ),
              SliverToBoxAdapter(
                child: _Header(
                  view: view,
                  color: color,
                  services: services,
                  playlistId: playlistId,
                ),
              ),
              if (collections.loadError != null &&
                  (ref is LikedRef || ref is PlaylistRef))
                SliverToBoxAdapter(
                  child: InlineBanner(
                    icon: Icons.error_outline,
                    message: collections.loadError!,
                    actionLabel: 'Reintentar',
                    onAction: () => collections.load(),
                  ),
                ),
              if (view.missing > 0)
                SliverToBoxAdapter(
                  child: InlineBanner(
                    message: view.missing == 1
                        ? '1 canción ya no está en la biblioteca y no se muestra.'
                        : '${view.missing} canciones ya no están en la biblioteca y no se muestran.',
                  ),
                ),
              if (songs.isEmpty)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 32, 24, 32),
                    child: Text(
                      view.emptyMessage,
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyLarge?.copyWith(
                        color: palette.inkMuted,
                      ),
                    ),
                  ),
                )
              else
                SliverList.builder(
                  itemCount: songs.length,
                  itemBuilder: (context, i) {
                    final song = songs[i];
                    return SongRow(
                      song: song,
                      services: services,
                      playlistId: playlistId,
                      onTap: () => runWithNotice(
                        context,
                        () => services.playback.playAt(songs, i),
                        failurePrefix: 'No se pudo reproducir «${song.title}»',
                      ),
                    );
                  },
                ),
              const SliverToBoxAdapter(child: SizedBox(height: 24)),
            ],
          ),
        );
      },
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.view,
    required this.color,
    required this.services,
    required this.playlistId,
  });

  final CollectionView view;
  final Color color;
  final AppServices services;
  final String? playlistId;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = paletteOf(context);
    final songs = view.songs;
    final total = songs.fold<double>(0, (sum, song) => sum + song.durationS);
    final playlist = playlistId == null
        ? null
        : services.collections.data.playlistOrNull(playlistId!);
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color.lerp(color, Colors.black, 0.45)!, palette.background],
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: CoverArt(
                seed: view.ref.key,
                size: 192,
                icon: view.icon,
                color: color,
              ),
            ),
            const SizedBox(height: 20),
            Semantics(
              header: true,
              child: Text(view.title, style: theme.textTheme.headlineMedium),
            ),
            const SizedBox(height: 4),
            Text(
              songs.isEmpty
                  ? view.subtitle
                  : '${view.subtitle} · ${formatTotalDuration(total)}',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                if (playlist != null) ...[
                  IconButton(
                    tooltip: 'Añadir canciones',
                    icon: const Icon(Icons.add_circle_outline_rounded),
                    iconSize: 28,
                    onPressed: () =>
                        showSongPicker(context, services, playlist.id),
                  ),
                  IconButton(
                    tooltip: 'Renombrar lista',
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: () =>
                        renamePlaylistFlow(context, services, playlist),
                  ),
                  IconButton(
                    tooltip: 'Borrar lista',
                    icon: const Icon(Icons.delete_outline_rounded),
                    onPressed: () async {
                      final navigator = Navigator.of(context);
                      final deleted = await deletePlaylistFlow(
                        context,
                        services,
                        playlist,
                      );
                      if (deleted) navigator.pop();
                    },
                  ),
                ],
                const Spacer(),
                ValueListenableBuilder<NowPlaying>(
                  valueListenable: services.playback.nowPlaying,
                  builder: (context, now, _) {
                    final ids = songs.map((song) => song.id).toSet();
                    final here =
                        now.songId != null &&
                        ids.contains(now.songId) &&
                        _sameQueue(services, ids);
                    final playing = here && now.playing;
                    return PlayCircleButton(
                      key: const Key('collection-play'),
                      playing: playing,
                      label: playing
                          ? 'Pausar «${view.title}»'
                          : 'Reproducir «${view.title}»',
                      onPressed: songs.isEmpty
                          ? null
                          : () => runWithNotice(
                              context,
                              () => here
                                  ? services.playback.togglePlayPause()
                                  : services.playback.playAt(songs, 0),
                              failurePrefix: 'No se pudo reproducir',
                            ),
                    );
                  },
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static bool _sameQueue(AppServices services, Set<String> ids) {
    final queue = services.playback.queueSongIds;
    return queue.length == ids.length && queue.containsAll(ids);
  }
}
