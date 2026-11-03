import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../library_controller.dart';
import '../local_audio.dart';
import '../services.dart';
import '../theme.dart';
import '../url_opener.dart';
import 'collection_page.dart';
import 'collection_ref.dart';
import 'common.dart';
import 'playlist_flows.dart';

/// Filtro de Tu biblioteca.
enum LibraryFilter { all, playlists, folders }

/// Tu biblioteca: «Canciones que te gustan», tus listas, las carpetas del catálogo y lo subido en este teléfono.
/// Arriba, «Subir canciones» (solo en este teléfono o para todos) y crear una lista.
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
      listenable: Listenable.merge([library, collections]),
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
                child: Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    FilledButton.icon(
                      key: const Key('upload-songs'),
                      onPressed: library.importing
                          ? null
                          : () => showUploadSheet(context, services),
                      icon: const Icon(Icons.upload_rounded),
                      label: const Text('Subir canciones'),
                    ),
                    if (library.importing)
                      Semantics(
                        liveRegion: true,
                        child: Text(
                          library.importProgress,
                          style: theme.textTheme.bodySmall,
                        ),
                      ),
                  ],
                ),
              ),
            ),
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
                    _chip('Carpetas', LibraryFilter.folders),
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
                    _filter == LibraryFilter.folders
                        ? 'El catálogo todavía no tiene carpetas.'
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
      LibraryFilter.folders => [
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

/// Hoja «Subir canciones»: «Solo en este teléfono» (subida local, ADR-0013) o «Para todos» (GitHub).
Future<void> showUploadSheet(BuildContext context, AppServices services) {
  return showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheetContext) {
      final theme = Theme.of(sheetContext);
      return SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Semantics(
                  header: true,
                  child: Text(
                    'Subir canciones',
                    style: theme.textTheme.titleLarge,
                  ),
                ),
              ),
              ListTile(
                key: const Key('upload-local'),
                leading: const Icon(Icons.phone_android_rounded),
                title: const Text('Solo en este teléfono'),
                subtitle: const Text(
                  'WAV, MP3, M4A, FLAC u OGG. Se convierten a Opus y se quedan en este teléfono, sin publicarse.',
                ),
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  pickAndAddLocal(context, services.library);
                },
              ),
              ListTile(
                key: const Key('upload-shared'),
                leading: const Icon(Icons.public_rounded),
                title: const Text('Para todos'),
                subtitle: const Text(
                  'Se suben a la biblioteca común desde GitHub, en el navegador.',
                ),
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  showSharedUploadDialog(context, services);
                },
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      );
    },
  );
}

/// Explica la subida «Para todos» y abre la página de GitHub en el navegador.
Future<void> showSharedUploadDialog(
  BuildContext context,
  AppServices services,
) async {
  final open = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Subir para todos'),
      content: const SingleChildScrollView(
        child: Text(
          'Se abrirá en el navegador la página de GitHub para subir archivos a la carpeta '
          'audio-library/buzon del repositorio de la biblioteca.\n\n'
          'Hace falta una cuenta de GitHub con permiso de escritura en el repositorio.\n\n'
          'En el mensaje del commit escribe «Licencia: …» con la licencia de las canciones '
          '(por ejemplo, «Licencia: dominio público»). Sin ella, las canciones quedan privadas '
          'y no se publican para nadie.',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: const Text('Abrir GitHub'),
        ),
      ],
    ),
  );
  if (open != true || !context.mounted) return;
  final messenger = ScaffoldMessenger.of(context);
  final opened = await services.openUrl(kSharedUploadUri);
  if (!opened) {
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          'No se pudo abrir el navegador. Abre a mano: $kSharedUploadUri',
        ),
      ),
    );
  }
}

/// Elige archivos de audio del teléfono y los convierte (subida local).
Future<void> pickAndAddLocal(
  BuildContext context,
  LibraryController library,
) async {
  final messenger = ScaffoldMessenger.of(context);
  // Sin allowMultiple: pickFiles ya admite varios archivos (el parámetro está obsoleto).
  final picked = await FilePicker.pickFiles(
    type: FileType.custom,
    allowedExtensions: kLocalAudioExtensions,
  );
  if (picked.isEmpty) return;
  final files = [
    for (final file in picked)
      if (file.path != null) PickedAudioFile(name: file.name, path: file.path!),
  ];
  if (files.isEmpty) {
    messenger.showSnackBar(
      const SnackBar(content: Text('No se pudo leer ninguno de los archivos.')),
    );
    return;
  }
  try {
    final result = await library.addLocalFiles(files);
    messenger.showSnackBar(SnackBar(content: Text(describeAddResult(result))));
  } catch (error) {
    messenger.showSnackBar(
      SnackBar(
        content: Text('No se pudo añadir el audio: ${describeError(error)}'),
      ),
    );
  }
}
