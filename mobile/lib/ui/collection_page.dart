import 'package:flutter/material.dart';

import '../fuzzy_search.dart';
import '../library_requests.dart';
import '../playback.dart';
import '../services.dart';
import '../song.dart';
import '../theme.dart';
import 'collection_ref.dart';
import 'common.dart';
import 'library_edit.dart';
import 'pending_edits_panel.dart';
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

/// Página de álbum o lista: cabecera en degradado, botón verde de reproducir y filas de canción.
class CollectionPage extends StatefulWidget {
  const CollectionPage({super.key, required this.services, required this.ref});

  final AppServices services;
  final CollectionRef ref;

  @override
  State<CollectionPage> createState() => _CollectionPageState();
}

/// Con pocas canciones el filtro sobra.
const int kCollectionFilterMinSongs = 6;

class _CollectionPageState extends State<CollectionPage> {
  final TextEditingController _filter = TextEditingController();
  String _filterText = '';

  /// Modo «Seleccionar» de un álbum: casillas por canción y acciones para todas las elegidas (una sola petición).
  bool _selecting = false;
  final Set<String> _selected = {};

  void _startSelecting() => setState(() {
    _selecting = true;
    _selected.clear();
  });

  void _stopSelecting() => setState(() {
    _selecting = false;
    _selected.clear();
  });

  AppServices get services => widget.services;
  CollectionRef get ref => widget.ref;

  @override
  void dispose() {
    _filter.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final library = services.library;
    final collections = services.collections;
    return ListenableBuilder(
      listenable: Listenable.merge([library, collections, services.covers]),
      builder: (context, _) {
        final view = resolveCollection(services, ref);
        final palette = paletteOf(context);
        final theme = Theme.of(context);
        final color = view.color ?? coverColorFor(ref.key);
        final playlistId = switch (ref) {
          PlaylistRef(:final id) when view.exists => id,
          _ => null,
        };
        final albumId = switch (ref) {
          FolderRef(:final id) when view.exists => id,
          _ => null,
        };
        final allSongs = view.songs;
        final folder = albumId == null ? null : library.folderOrNull(albumId);
        final editable = allSongs.where(isEditableSong).toList();
        final selecting = _selecting && folder != null && editable.isNotEmpty;
        // Las elegidas que siguen en el álbum, en su orden.
        final chosen = [
          for (final song in editable)
            if (_selected.contains(song.id)) song.id,
        ];
        final showFilter = allSongs.length >= kCollectionFilterMinSongs;
        final songs = showFilter
            ? filterSongsByText(
                allSongs,
                _filterText,
                albumName: (song) => song.folderId == null
                    ? ''
                    : library.folderOrNull(song.folderId!)?.name ?? '',
              )
            : allSongs;
        return Scaffold(
          backgroundColor: palette.background,
          bottomNavigationBar: selecting
              ? _SelectionBar(
                  chosen: chosen,
                  onSelectAll: () => setState(
                    () => _selected.addAll(
                      songs.where(isEditableSong).map((song) => song.id),
                    ),
                  ),
                  onSelectNone: () => setState(_selected.clear),
                  onCancel: _stopSelecting,
                  onRemove: () async {
                    final sent = await removeSongsFromAlbumFlow(
                      context,
                      services,
                      folder,
                      chosen,
                    );
                    if (sent && mounted) _stopSelecting();
                  },
                  onMove: () async {
                    final sent = await moveSongsToAlbumFlow(
                      context,
                      services,
                      folder,
                      chosen,
                    );
                    if (sent && mounted) _stopSelecting();
                  },
                )
              : null,
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
                  onSelect: folder != null && editable.isNotEmpty && !selecting
                      ? _startSelecting
                      : null,
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
              if (showFilter)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                    child: TextField(
                      key: const Key('collection-filter'),
                      controller: _filter,
                      onChanged: (value) => setState(() => _filterText = value),
                      textInputAction: TextInputAction.search,
                      decoration: InputDecoration(
                        hintText: 'Buscar en esta colección',
                        prefixIcon: const Icon(Icons.search_rounded),
                        suffixIcon: _filterText.isEmpty
                            ? null
                            : IconButton(
                                tooltip: 'Borrar el filtro',
                                icon: const Icon(Icons.close_rounded),
                                onPressed: () {
                                  _filter.clear();
                                  setState(() => _filterText = '');
                                },
                              ),
                        filled: true,
                        isDense: true,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide: BorderSide.none,
                        ),
                      ),
                    ),
                  ),
                ),
              if (songs.isEmpty)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 32, 24, 32),
                    child: Text(
                      showFilter && _filterText.trim().isNotEmpty
                          ? 'Ninguna canción coincide con «${_filterText.trim()}».'
                          : view.emptyMessage,
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
                    if (selecting) {
                      return _SelectableSongRow(
                        song: song,
                        selected: _selected.contains(song.id),
                        onChanged: isEditableSong(song)
                            ? (value) => setState(() {
                                if (value) {
                                  _selected.add(song.id);
                                } else {
                                  _selected.remove(song.id);
                                }
                              })
                            : null,
                      );
                    }
                    return SongRow(
                      song: song,
                      services: services,
                      playlistId: playlistId,
                      albumId: albumId,
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
    this.onSelect,
  });

  final CollectionView view;
  final Color color;
  final AppServices services;
  final String? playlistId;

  /// Entra en el modo «Seleccionar» (solo en un álbum con canciones de la biblioteca común).
  final VoidCallback? onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = paletteOf(context);
    final songs = view.songs;
    final total = songs.fold<double>(0, (sum, song) => sum + song.durationS);
    final playlist = playlistId == null
        ? null
        : services.collections.data.playlistOrNull(playlistId!);
    final folder = switch (view.ref) {
      FolderRef(:final id) => services.library.folderOrNull(id),
      _ => null,
    };
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
                image: view.image,
              ),
            ),
            const SizedBox(height: 20),
            Semantics(
              header: true,
              child: Text(view.title, style: theme.textTheme.headlineMedium),
            ),
            if (folder != null && folder.pendingEdit) ...[
              const SizedBox(height: 6),
              const PendingEditBadge(),
            ],
            if (view.description.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                view.description,
                key: const Key('collection-description'),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: palette.inkMuted,
                ),
              ),
            ],
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
                    tooltip: 'Editar detalles',
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: () =>
                        editPlaylistFlow(context, services, playlist),
                  ),
                  IconButton(
                    tooltip: 'Cambiar portada',
                    icon: const Icon(Icons.image_outlined),
                    onPressed: () =>
                        playlistCoverFlow(context, services, playlist),
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
                if (folder != null)
                  IconButton(
                    tooltip: 'Más opciones de «${folder.name}»',
                    icon: const Icon(Icons.more_vert_rounded),
                    onPressed: () => showAlbumMenu(context, services, folder),
                  ),
                if (onSelect != null)
                  TextButton.icon(
                    key: const ValueKey('album-select'),
                    onPressed: onSelect,
                    icon: const Icon(Icons.checklist_rounded),
                    label: const Text('Seleccionar'),
                  ),
                const Spacer(),
                // Aleatorio del álbum: reproduce EN ALEATORIO solo las canciones de ESTE álbum (la cola pasa a ser este
                // álbum), para que nunca se cuelen canciones de otros álbumes. Igual que el botón «Aleatorio» de la web.
                IconButton(
                  key: const Key('collection-shuffle'),
                  tooltip: 'Reproducir en aleatorio',
                  icon: const Icon(Icons.shuffle_rounded),
                  onPressed: songs.isEmpty
                      ? null
                      : () => runWithNotice(
                          context,
                          () async {
                            await services.playback.playAt(songs, 0);
                            await services.playback.setShuffle(true);
                          },
                          failurePrefix: 'No se pudo reproducir',
                        ),
                ),
                const SizedBox(width: 8),
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

/// Fila de una canción en el modo «Seleccionar»: casilla, título y artista. Las que no son de la biblioteca común
/// (subidas a este teléfono) se ven sin casilla activa.
class _SelectableSongRow extends StatelessWidget {
  const _SelectableSongRow({
    required this.song,
    required this.selected,
    required this.onChanged,
  });

  final Song song;
  final bool selected;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final change = onChanged;
    return CheckboxListTile(
      key: ValueKey('album-select-song-${song.id}'),
      value: selected,
      onChanged: change == null ? null : (value) => change(value ?? false),
      controlAffinity: ListTileControlAffinity.leading,
      title: Text(song.title, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: song.artist.isEmpty
          ? null
          : Text(song.artist, maxLines: 1, overflow: TextOverflow.ellipsis),
    );
  }
}

/// Texto del contador del modo «Seleccionar».
String selectionCountText(int count) {
  if (count == 0) return 'Ninguna canción elegida';
  if (count > kMaxMoveSongs) {
    return '$count seleccionadas: como mucho $kMaxMoveSongs de una vez';
  }
  return count == 1 ? '1 seleccionada' : '$count seleccionadas';
}

/// Barra del modo «Seleccionar»: contador, «Seleccionar todo», «Ninguna», «Quitar del álbum», «Mover a otro álbum» y
/// «Cancelar». Las acciones envían una sola petición con todas las elegidas (de 1 a [kMaxMoveSongs]).
class _SelectionBar extends StatelessWidget {
  const _SelectionBar({
    required this.chosen,
    required this.onSelectAll,
    required this.onSelectNone,
    required this.onCancel,
    required this.onRemove,
    required this.onMove,
  });

  final List<String> chosen;
  final VoidCallback onSelectAll;
  final VoidCallback onSelectNone;
  final VoidCallback onCancel;
  final VoidCallback onRemove;
  final VoidCallback onMove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final count = chosen.length;
    final canAct = count > 0 && count <= kMaxMoveSongs;
    return Material(
      key: const ValueKey('album-select-bar'),
      elevation: 8,
      color: theme.colorScheme.surfaceContainerHigh,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Semantics(
                      liveRegion: true,
                      child: Text(
                        selectionCountText(count),
                        key: const ValueKey('album-select-count'),
                        style: theme.textTheme.titleSmall,
                      ),
                    ),
                  ),
                  TextButton(
                    key: const ValueKey('album-select-all'),
                    onPressed: onSelectAll,
                    child: const Text('Seleccionar todo'),
                  ),
                  TextButton(
                    key: const ValueKey('album-select-none'),
                    onPressed: count == 0 ? null : onSelectNone,
                    child: const Text('Ninguna'),
                  ),
                ],
              ),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                alignment: WrapAlignment.end,
                children: [
                  TextButton(
                    key: const ValueKey('album-select-cancel'),
                    onPressed: onCancel,
                    child: const Text('Cancelar'),
                  ),
                  OutlinedButton.icon(
                    key: const ValueKey('album-select-move'),
                    onPressed: canAct ? onMove : null,
                    icon: const Icon(Icons.drive_file_move_outline),
                    label: const Text('Mover a otro álbum'),
                  ),
                  FilledButton.icon(
                    key: const ValueKey('album-select-remove'),
                    onPressed: canAct ? onRemove : null,
                    icon: const Icon(Icons.remove_circle_outline_rounded),
                    label: const Text('Quitar del álbum'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
