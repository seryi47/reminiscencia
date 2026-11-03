import 'package:flutter/material.dart';

import '../services.dart';
import '../song.dart';
import 'cards.dart';
import 'collection_page.dart';
import 'collection_ref.dart';
import 'common.dart';
import 'settings_page.dart';

/// Saludo según la hora: «Buenos días» de 6 a 13, «Buenas tardes» de 13 a 21 y «Buenas noches» el resto.
String greetingFor(DateTime time) {
  final hour = time.hour;
  if (hour >= 6 && hour < 13) return 'Buenos días';
  if (hour >= 13 && hour < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

/// Inicio: saludo, accesos rápidos en cuadrícula y estantes (carpetas, añadidas recientemente, tus listas).
class HomePage extends StatelessWidget {
  const HomePage({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    final library = services.library;
    final collections = services.collections;
    return ListenableBuilder(
      listenable: Listenable.merge([library, collections]),
      builder: (context, _) {
        final theme = Theme.of(context);
        final header = Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 4, 0),
          child: Row(
            children: [
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(
                    greetingFor(services.clock()),
                    style: theme.textTheme.headlineMedium,
                  ),
                ),
              ),
              _OfflineButton(services: services),
              IconButton(
                tooltip: 'Ajustes',
                icon: const Icon(Icons.settings_outlined),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => SettingsPage(services: services),
                  ),
                ),
              ),
            ],
          ),
        );
        final body = _body(context);
        return RefreshIndicator(
          onRefresh: () => library.load(),
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverSafeArea(
                bottom: false,
                sliver: SliverToBoxAdapter(child: header),
              ),
              ..._notices(),
              ...body,
              const SliverToBoxAdapter(child: SizedBox(height: 24)),
            ],
          ),
        );
      },
    );
  }

  List<Widget> _notices() {
    final library = services.library;
    final notice = library.audioNotice;
    return [
      if (notice != null)
        SliverToBoxAdapter(
          child: InlineBanner(
            icon: Icons.volume_off_outlined,
            message: notice,
            actionLabel: 'Reintentar',
            onAction: () => library.retryAudio(),
          ),
        ),
      if (library.loadError != null && library.songs.isNotEmpty)
        SliverToBoxAdapter(
          child: InlineBanner(
            icon: Icons.cloud_off_outlined,
            message: library.loadError!,
            actionLabel: 'Reintentar',
            onAction: () => library.load(),
          ),
        ),
      if (library.loadError == null &&
          !library.online &&
          library.songs.isNotEmpty)
        const SliverToBoxAdapter(
          child: InlineBanner(
            icon: Icons.cloud_off_outlined,
            message: 'Sin conexión: se usa la copia guardada de la biblioteca.',
          ),
        ),
    ];
  }

  List<Widget> _body(BuildContext context) {
    final library = services.library;
    final loadError = library.loadError;
    Widget fill(Widget child) =>
        SliverFillRemaining(hasScrollBody: false, child: child);
    if (library.loading && library.songs.isEmpty) {
      return [fill(const Center(child: CircularProgressIndicator()))];
    }
    if (loadError != null && library.songs.isEmpty) {
      return [
        fill(
          MessagePanel(
            icon: Icons.cloud_off_outlined,
            message: loadError,
            actionLabel: 'Reintentar',
            onAction: () => library.load(),
          ),
        ),
      ];
    }
    if (library.songs.isEmpty) {
      return [
        fill(
          const MessagePanel(
            icon: Icons.library_music_outlined,
            message: 'Sin canciones todavía.',
          ),
        ),
      ];
    }
    return [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
        sliver: SliverGrid(
          gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 320,
            mainAxisExtent: quickTileExtent(context),
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
          ),
          delegate: SliverChildListDelegate([
            for (final ref in _quickRefs())
              _quickTile(context, resolveCollection(services, ref)),
          ]),
        ),
      ),
      SliverToBoxAdapter(child: _shelves(context)),
    ];
  }

  /// Accesos rápidos: «Me gusta», tus listas, las carpetas y, si hay, lo subido en este teléfono. Hasta 8.
  List<CollectionRef> _quickRefs() {
    final library = services.library;
    final refs = <CollectionRef>[
      const LikedRef(),
      for (final playlist in services.collections.data.playlists)
        PlaylistRef(playlist.id),
      for (final folder in library.folders.where((f) => f.parentId == null))
        FolderRef(folder.id),
      if (library.localSongs.isNotEmpty) const LocalRef(),
      const AllSongsRef(),
    ];
    return refs.take(8).toList();
  }

  Widget _quickTile(BuildContext context, CollectionView view) {
    return QuickTile(
      seed: view.ref.key,
      title: view.title,
      icon: view.icon,
      color: view.color,
      onTap: () => openCollection(context, services, view.ref),
    );
  }

  Widget _shelves(BuildContext context) {
    final library = services.library;
    final collections = services.collections;
    final folders = library.folders.where((f) => f.parentId == null).toList();
    final recent = library.recentSongs();
    final playlists = collections.data.playlists;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (folders.isNotEmpty)
          Shelf(
            title: 'Carpetas',
            children: [
              for (final folder in folders)
                _collectionCard(context, FolderRef(folder.id)),
            ],
          ),
        Shelf(
          title: 'Añadidas recientemente',
          children: [
            for (var i = 0; i < recent.length; i++)
              _songCard(context, recent, i),
          ],
        ),
        Shelf(
          title: 'Tus listas',
          children: [
            _collectionCard(context, const LikedRef()),
            for (final playlist in playlists)
              _collectionCard(context, PlaylistRef(playlist.id)),
            if (library.localSongs.isNotEmpty)
              _collectionCard(context, const LocalRef()),
          ],
        ),
      ],
    );
  }

  Widget _collectionCard(BuildContext context, CollectionRef ref) {
    final view = resolveCollection(services, ref);
    return ShelfCard(
      seed: ref.key,
      title: view.title,
      subtitle: view.subtitle,
      icon: view.icon,
      color: view.color,
      onTap: () => openCollection(context, services, ref),
    );
  }

  Widget _songCard(BuildContext context, List<Song> songs, int index) {
    final song = songs[index];
    final details = song.artist.isNotEmpty
        ? song.artist
        : (song.local ? 'En este teléfono' : 'Canción');
    return ShelfCard(
      seed: song.id,
      title: song.title,
      subtitle: details,
      icon: Icons.music_note_rounded,
      semanticHint: 'reproducir',
      onTap: () => runWithNotice(
        context,
        () => services.playback.playAt(songs, index),
        failurePrefix: 'No se pudo reproducir «${song.title}»',
      ),
    );
  }
}

/// Botón «Guardar para escuchar sin conexión»; mientras descarga muestra el progreso.
class _OfflineButton extends StatelessWidget {
  const _OfflineButton({required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    final library = services.library;
    if (library.downloading) {
      return Semantics(
        liveRegion: true,
        label: 'Guardando para escuchar sin conexión: ${library.progress}',
        excludeSemantics: true,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text(
            library.progress,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      );
    }
    return IconButton(
      tooltip: library.offlineWanted
          ? 'Guardar lo nuevo para escuchar sin conexión'
          : 'Guardar para escuchar sin conexión',
      icon: Icon(
        library.offlineWanted
            ? Icons.download_done_rounded
            : Icons.download_for_offline_outlined,
      ),
      onPressed: library.songs.isEmpty
          ? null
          : () => downloadForOfflineFlow(context, services),
    );
  }
}

/// Descarga el catálogo para escucharlo sin conexión y lo cuenta en un aviso.
Future<void> downloadForOfflineFlow(
  BuildContext context,
  AppServices services,
) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final done = await services.library.downloadForOffline();
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          done == 0
              ? 'Ya estaba todo guardado.'
              : 'Guardadas $done canciones para escuchar sin conexión.',
        ),
      ),
    );
  } catch (error) {
    messenger.showSnackBar(
      SnackBar(content: Text('No se pudo descargar: ${describeError(error)}')),
    );
  }
}
