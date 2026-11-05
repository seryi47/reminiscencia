import 'package:flutter/material.dart';

import '../app_error.dart';
import '../local_audio.dart';
import '../services.dart';
import '../shared_upload.dart';
import '../theme.dart';
import 'collection_page.dart';
import 'collection_ref.dart';
import 'common.dart';
import 'duplicate_review.dart';
import 'homeostasia.dart';
import 'playlist_flows.dart';
import 'uploads_panel.dart';

/// Filtro de Tu biblioteca.
enum LibraryFilter { all, playlists, albums }

/// Tu biblioteca: «Canciones que te gustan», tus listas, los álbumes del catálogo y lo subido en este teléfono.
/// Arriba, «Subir canciones» (a la biblioteca común, para todos) y crear una lista.
class LibraryPage extends StatefulWidget {
  const LibraryPage({super.key, required this.services});

  final AppServices services;

  @override
  State<LibraryPage> createState() => _LibraryPageState();
}

class _LibraryPageState extends State<LibraryPage> {
  LibraryFilter _filter = LibraryFilter.all;

  @override
  Widget build(BuildContext context) {
    final services = widget.services;
    final library = services.library;
    final collections = services.collections;
    return ListenableBuilder(
      listenable: Listenable.merge([library, collections, services.covers]),
      builder: (context, _) {
        final theme = Theme.of(context);
        final refs = _refs();
        return CustomScrollView(
          slivers: [
            SliverSafeArea(
              bottom: false,
              sliver: SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 4, 0),
                  child: Row(
                    children: [
                      Expanded(
                        child: Semantics(
                          header: true,
                          child: Text(
                            'Tu biblioteca',
                            style: theme.textTheme.headlineMedium,
                          ),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Crear lista',
                        icon: const Icon(Icons.add_rounded),
                        iconSize: 30,
                        onPressed: () async {
                          final created = await createPlaylistFlow(
                            context,
                            collections,
                          );
                          if (created != null && context.mounted) {
                            await openCollection(
                              context,
                              services,
                              PlaylistRef(created.id),
                            );
                          }
                        },
                      ),
                    ],
                  ),
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: Alignment.centerLeft,
                      child: FilledButton.icon(
                        key: const Key('upload-songs'),
                        onPressed: library.importing
                            ? null
                            : () => uploadSongs(context, services),
                        icon: const Icon(Icons.upload_rounded),
                        label: const Text('Subir canciones'),
                      ),
                    ),
                    const SizedBox(height: 10),
                    HomeostasiaButton(services: services),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: Text(
                  kUploadRightsNotice,
                  style: theme.textTheme.bodySmall,
                ),
              ),
            ),
            SliverToBoxAdapter(child: UploadsPanel(services: services)),
            SliverToBoxAdapter(
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Row(
                  children: [
                    _chip('Todo', LibraryFilter.all),
                    const SizedBox(width: 8),
                    _chip('Listas', LibraryFilter.playlists),
                    const SizedBox(width: 8),
                    _chip('Álbumes', LibraryFilter.albums),
                  ],
                ),
              ),
            ),
            if (collections.loadError != null)
              SliverToBoxAdapter(
                child: InlineBanner(
                  icon: Icons.error_outline,
                  message: collections.loadError!,
                  actionLabel: 'Reintentar',
                  onAction: () => collections.load(),
                ),
              ),
            if (refs.isEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(24, 32, 24, 0),
                  child: Text(
                    _filter == LibraryFilter.albums
                        ? 'El catálogo todavía no tiene álbumes.'
                        : 'Todavía no tienes listas. Crea una con «Crear lista».',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyLarge,
                  ),
                ),
              )
            else
              SliverList.builder(
                itemCount: refs.length,
                itemBuilder: (context, i) =>
                    _LibraryRow(services: services, ref: refs[i]),
              ),
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
          ],
        );
      },
    );
  }

  List<CollectionRef> _refs() {
    final library = widget.services.library;
    final playlists = widget.services.collections.data.playlists;
    final folders = library.folders.where((f) => f.parentId == null);
    return switch (_filter) {
      LibraryFilter.all => [
        const LikedRef(),
        if (library.localSongs.isNotEmpty) const LocalRef(),
        for (final playlist in playlists) PlaylistRef(playlist.id),
        for (final folder in folders) FolderRef(folder.id),
        const AllSongsRef(),
      ],
      LibraryFilter.playlists => [
        const LikedRef(),
        for (final playlist in playlists) PlaylistRef(playlist.id),
      ],
      LibraryFilter.albums => [
        for (final folder in folders) FolderRef(folder.id),
      ],
    };
  }

  Widget _chip(String label, LibraryFilter filter) {
    final selected = _filter == filter;
    final palette = paletteOf(context);
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      labelStyle: Theme.of(context).textTheme.labelLarge?.copyWith(
        color: selected ? palette.onAccent : palette.ink,
      ),
      materialTapTargetSize: MaterialTapTargetSize.padded,
      onSelected: (_) => setState(() => _filter = filter),
    );
  }
}

class _LibraryRow extends StatelessWidget {
  const _LibraryRow({required this.services, required this.ref});

  final AppServices services;
  final CollectionRef ref;

  @override
  Widget build(BuildContext context) {
    final view = resolveCollection(services, ref);
    final theme = Theme.of(context);
    return Semantics(
      button: true,
      label: '${view.title}, ${view.subtitle}',
      excludeSemantics: true,
      child: InkWell(
        onTap: () => openCollection(context, services, ref),
        highlightColor: paletteOf(context).cardPressed,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              CoverArt(
                seed: ref.key,
                size: 64,
                icon: view.icon,
                color: view.color,
                image: view.image,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      view.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyLarge?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      view.subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// «Subir canciones»: sin hojas ni confirmaciones. Comprueba la red, elige uno o varios archivos (canciones
/// sueltas o ZIP con canciones), avisa de las que parecen estar ya en la biblioteca y los sube a la biblioteca común (convertidos a Opus, de uno en uno). Cada
/// canción tiene su fila en «Tu biblioteca» hasta que se publica, y las de un ZIP van agrupadas (ver UploadsPanel).
Future<void> uploadSongs(BuildContext context, AppServices services) async {
  final messenger = ScaffoldMessenger.of(context);
  final library = services.library;
  if (!await library.canUpload()) {
    messenger.showSnackBar(const SnackBar(content: Text(kOfflineMessage)));
    return;
  }
  final List<PickedAudioFile> files;
  try {
    files = await services.pickAudio();
  } catch (error) {
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          'No se pudieron elegir los archivos: ${describeError(error)}',
        ),
      ),
    );
    return;
  }
  if (files.isEmpty) return;
  try {
    await library.uploadShared(
      files,
      // Aviso de duplicados antes de ponerlas en la cola (ADR-0026).
      review: (songs) => context.mounted
          ? reviewUploadDuplicates(context, services, songs)
          : Future.value(const <int>{}),
    );
  } catch (error) {
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          error is AppException
              ? error.message
              : 'No se pudo subir: ${describeError(error)}',
        ),
      ),
    );
  }
}
