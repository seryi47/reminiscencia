import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../app_error.dart';
import '../library_requests.dart';
import '../services.dart';
import '../song.dart';
import '../theme.dart';
import 'collection_ref.dart';
import 'common.dart';

// Edición de la biblioteca común desde la app, igual que en la web: no hay usuarios ni API, así que cada cambio
// se pide con una incidencia de GitHub (o, las portadas, con la página de subida) que se abre en el navegador.

/// True si la canción es del catálogo común (las subidas a este teléfono no se editan por GitHub).
bool isEditableSong(Song song) => !song.local && isCatalogSongId(song.id);

/// Abre en el navegador la incidencia de [request]. Si no se puede, dice la dirección en un aviso.
Future<void> openLibraryRequest(
  BuildContext context,
  AppServices services,
  LibraryRequest request,
) => _open(context, services, request.issueUri);

Future<void> _open(BuildContext context, AppServices services, Uri uri) async {
  final messenger = ScaffoldMessenger.of(context);
  final opened = await services.openUrl(uri);
  if (!opened) {
    messenger.showSnackBar(
      SnackBar(
        content: Text('No se pudo abrir el navegador. Abre a mano: $uri'),
      ),
    );
  }
}

/// «Editar detalles» de una canción: título y artista.
Future<void> editSongDetailsFlow(
  BuildContext context,
  AppServices services,
  Song song,
) async {
  final request = await showDialog<LibraryRequest>(
    context: context,
    builder: (_) => RequestFormDialog(
      title: 'Editar detalles',
      fields: [
        RequestField(
          label: 'Título',
          initial: song.title,
          maxLength: kMaxSongTitleLength,
        ),
        RequestField(
          label: 'Artista',
          initial: song.artist,
          maxLength: kMaxArtistLength,
        ),
      ],
      build: (values) => LibraryRequest.editSong(
        songId: song.id,
        title: values[0],
        artist: values[1],
      ),
    ),
  );
  if (request == null || !context.mounted) return;
  await openLibraryRequest(context, services, request);
}

/// «Crear álbum»: nombre y artista.
Future<void> createAlbumFlow(BuildContext context, AppServices services) async {
  final request = await showDialog<LibraryRequest>(
    context: context,
    builder: (_) => RequestFormDialog(
      title: 'Crear álbum',
      fields: const [
        RequestField(label: 'Nombre del álbum', maxLength: kMaxAlbumNameLength),
        RequestField(label: 'Artista', maxLength: kMaxArtistLength),
      ],
      build: (values) =>
          LibraryRequest.createAlbum(name: values[0], artist: values[1]),
    ),
  );
  if (request == null || !context.mounted) return;
  await openLibraryRequest(context, services, request);
}

/// «Editar detalles» de un álbum: nombre y artista.
Future<void> editAlbumFlow(
  BuildContext context,
  AppServices services,
  Folder folder,
) async {
  final request = await showDialog<LibraryRequest>(
    context: context,
    builder: (_) => RequestFormDialog(
      title: 'Editar detalles',
      fields: [
        RequestField(
          label: 'Nombre del álbum',
          initial: folder.name,
          maxLength: kMaxAlbumNameLength,
        ),
        RequestField(
          label: 'Artista',
          initial: folder.artist,
          maxLength: kMaxArtistLength,
        ),
      ],
      build: (values) => LibraryRequest.editAlbum(
        folderId: folder.id,
        name: values[0],
        artist: values[1],
      ),
    ),
  );
  if (request == null || !context.mounted) return;
  await openLibraryRequest(context, services, request);
}

/// «Añadir a un álbum»: elige el álbum de la canción (o ninguno).
Future<void> addSongToAlbumFlow(
  BuildContext context,
  AppServices services,
  Song song,
) async {
  final folders = services.library.folders;
  final request = await showDialog<LibraryRequest>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Añadir a un álbum'),
      content: SizedBox(
        width: double.maxFinite,
        child: ListView(
          shrinkWrap: true,
          children: [
            const _WriteAccessNote(),
            if (folders.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text(
                  'Todavía no hay álbumes. Crea uno con «Crear álbum».',
                ),
              ),
            for (final folder in folders)
              ListTile(
                leading: CoverArt(
                  seed: FolderRef(folder.id).key,
                  size: 40,
                  icon: Icons.album_rounded,
                  image: services.covers.imageFor(folder.cover),
                ),
                title: Text(
                  folder.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: folder.artist.isEmpty ? null : Text(folder.artist),
                trailing: song.folderId == folder.id
                    ? Icon(
                        Icons.check_circle_rounded,
                        color: Theme.of(dialogContext).colorScheme.primary,
                        semanticLabel: 'Ya está en este álbum',
                      )
                    : null,
                onTap: () => Navigator.of(dialogContext).pop(
                  LibraryRequest.moveSong(
                    songId: song.id,
                    folderId: folder.id,
                    albumName: folder.name,
                  ),
                ),
              ),
            if (song.folderId != null)
              ListTile(
                leading: const Icon(Icons.remove_circle_outline_rounded),
                title: const Text('Sacar del álbum'),
                onTap: () => Navigator.of(
                  dialogContext,
                ).pop(LibraryRequest.moveSong(songId: song.id, folderId: null)),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(),
          child: const Text('Cancelar'),
        ),
      ],
    ),
  );
  if (request == null || !context.mounted) return;
  await openLibraryRequest(context, services, request);
}

/// Desde un álbum: elige una canción del catálogo para pasarla a este álbum (una petición por canción).
Future<void> addSongsToAlbumFlow(
  BuildContext context,
  AppServices services,
  Folder folder,
) async {
  final songs = services.library.catalogSongs
      .where((song) => isEditableSong(song) && song.folderId != folder.id)
      .toList();
  final request = await showModalBottomSheet<LibraryRequest>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheetContext) => SizedBox(
      height: MediaQuery.sizeOf(sheetContext).height * 0.8,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
            child: Semantics(
              header: true,
              child: Text(
                'Añadir a «${folder.name}»',
                style: Theme.of(sheetContext).textTheme.titleLarge,
              ),
            ),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 4, 16, 0),
            child: _WriteAccessNote(),
          ),
          Expanded(
            child: songs.isEmpty
                ? const MessagePanel(
                    icon: Icons.library_music_outlined,
                    message:
                        'No quedan canciones de la biblioteca común fuera de este álbum.',
                  )
                : ListView.builder(
                    itemCount: songs.length,
                    itemBuilder: (context, i) {
                      final song = songs[i];
                      return ListTile(
                        leading: CatalogCover(
                          covers: services.covers,
                          cover: song.cover,
                          seed: song.id,
                          size: 40,
                        ),
                        title: Text(
                          song.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: song.artist.isEmpty
                            ? null
                            : Text(song.artist, maxLines: 1),
                        onTap: () => Navigator.of(sheetContext).pop(
                          LibraryRequest.moveSong(
                            songId: song.id,
                            folderId: folder.id,
                            albumName: folder.name,
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    ),
  );
  if (request == null || !context.mounted) return;
  await openLibraryRequest(context, services, request);
}

/// «Cambiar portada»: la imagen se sube al buzón de portadas desde la página de GitHub, con el ID como nombre.
Future<void> changeCatalogCoverFlow(
  BuildContext context,
  AppServices services, {
  required String id,
  required String what,
}) async {
  if (!canChangeCatalogCover(id)) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Este elemento no admite cambiar la portada desde el buzón.',
        ),
      ),
    );
    return;
  }
  final open = await showDialog<bool>(
    context: context,
    builder: (_) => ChangeCoverDialog(id: id, what: what),
  );
  if (open != true || !context.mounted) return;
  await _open(context, services, kCoverUploadUri);
}

/// Diálogo de «Cambiar portada»: instrucciones, el ID con un botón para copiarlo y «Abrir GitHub».
class ChangeCoverDialog extends StatelessWidget {
  const ChangeCoverDialog({super.key, required this.id, required this.what});

  /// Identificador que debe llevar el archivo.
  final String id;

  /// «la canción» o «el álbum».
  final String what;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = paletteOf(context);
    return AlertDialog(
      title: const Text('Cambiar portada'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Se abrirá en el navegador la página de GitHub para subir la imagen a '
              'audio-library/buzon/portadas. Ponle al archivo como nombre el ID de $what, '
              'con su extensión (por ejemplo, $id.jpg):',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 12),
            Container(
              decoration: BoxDecoration(
                color: palette.elevated,
                borderRadius: BorderRadius.circular(8),
              ),
              padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
              child: Row(
                children: [
                  Expanded(
                    child: SelectableText(
                      id,
                      key: const Key('cover-id'),
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ),
                  IconButton(
                    key: const Key('copy-cover-id'),
                    tooltip: 'Copiar el ID',
                    icon: const Icon(Icons.copy_rounded),
                    onPressed: () async {
                      final messenger = ScaffoldMessenger.of(context);
                      await Clipboard.setData(ClipboardData(text: id));
                      messenger.showSnackBar(
                        SnackBar(content: Text('ID copiado: $id')),
                      );
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Hace falta una cuenta de GitHub con permiso de escritura en el repositorio de la biblioteca. '
              'La portada nueva se verá en la app después de que se procese; si ya tenías la anterior '
              'guardada, desliza hacia abajo en Inicio para actualizarla.',
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Abrir GitHub'),
        ),
      ],
    );
  }
}

/// Menú de un álbum: editar, añadir canciones, crear otro álbum y cambiar la portada.
Future<void> showAlbumMenu(
  BuildContext context,
  AppServices services,
  Folder folder,
) {
  return showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheetContext) {
      final theme = Theme.of(sheetContext);
      void close() => Navigator.of(sheetContext).pop();
      return SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Row(
                  children: [
                    CoverArt(
                      seed: FolderRef(folder.id).key,
                      size: 48,
                      icon: Icons.album_rounded,
                      image: services.covers.imageFor(folder.cover),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            folder.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.titleMedium,
                          ),
                          Text(
                            folder.artist.isEmpty
                                ? 'Álbum'
                                : 'Álbum · ${folder.artist}',
                            style: theme.textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              ...libraryEditTiles(
                hostContext: context,
                services: services,
                close: close,
                editDetails: () => editAlbumFlow(context, services, folder),
                addToAlbumLabel: 'Añadir canciones a este álbum',
                addToAlbum: () =>
                    addSongsToAlbumFlow(context, services, folder),
                coverId: folder.id,
                coverWhat: 'el álbum',
              ),
            ],
          ),
        ),
      );
    },
  );
}

/// Las cuatro acciones de edición de la biblioteca común, con su encabezado. Las usan el menú de canción y el de álbum.
List<Widget> libraryEditTiles({
  required BuildContext hostContext,
  required AppServices services,
  required VoidCallback close,
  required VoidCallback editDetails,
  required VoidCallback addToAlbum,
  required String coverId,
  required String coverWhat,
  String addToAlbumLabel = 'Añadir a un álbum',
}) {
  return [
    const _EditHeading(),
    ListTile(
      leading: const Icon(Icons.edit_outlined),
      title: const Text('Editar detalles'),
      onTap: () {
        close();
        editDetails();
      },
    ),
    ListTile(
      leading: const Icon(Icons.album_outlined),
      title: Text(addToAlbumLabel),
      onTap: () {
        close();
        addToAlbum();
      },
    ),
    ListTile(
      leading: const Icon(Icons.create_new_folder_outlined),
      title: const Text('Crear álbum'),
      onTap: () {
        close();
        createAlbumFlow(hostContext, services);
      },
    ),
    if (canChangeCatalogCover(coverId))
      ListTile(
        leading: const Icon(Icons.image_outlined),
        title: const Text('Cambiar portada'),
        onTap: () {
          close();
          changeCatalogCoverFlow(
            hostContext,
            services,
            id: coverId,
            what: coverWhat,
          );
        },
      ),
  ];
}

class _EditHeading extends StatelessWidget {
  const _EditHeading();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Semantics(
        header: true,
        child: Text(
          'Biblioteca común (se pide en GitHub)',
          style: theme.textTheme.labelLarge?.copyWith(
            color: paletteOf(context).inkMuted,
          ),
        ),
      ),
    );
  }
}

class _WriteAccessNote extends StatelessWidget {
  const _WriteAccessNote();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        kWriteAccessNote,
        style: Theme.of(context).textTheme.bodySmall,
      ),
    );
  }
}

/// Un campo de texto de una línea del formulario de una petición.
class RequestField {
  const RequestField({
    required this.label,
    required this.maxLength,
    this.initial = '',
  });

  final String label;
  final int maxLength;
  final String initial;
}

/// Formulario de una petición: campos de una línea, el aviso de permisos y «Abrir GitHub».
/// Valida con [build] (las mismas reglas que se envían) y devuelve la petición, o null si se cancela.
class RequestFormDialog extends StatefulWidget {
  const RequestFormDialog({
    super.key,
    required this.title,
    required this.fields,
    required this.build,
  });

  final String title;
  final List<RequestField> fields;
  final LibraryRequest Function(List<String> values) build;

  @override
  State<RequestFormDialog> createState() => _RequestFormDialogState();
}

class _RequestFormDialogState extends State<RequestFormDialog> {
  late final List<TextEditingController> _controllers = [
    for (final field in widget.fields)
      TextEditingController(text: field.initial),
  ];
  String? _error;

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  void _submit() {
    try {
      final request = widget.build([
        for (final controller in _controllers) controller.text,
      ]);
      Navigator.of(context).pop(request);
    } on AppException catch (error) {
      setState(() => _error = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var i = 0; i < widget.fields.length; i++)
              TextField(
                key: Key('request-field-$i'),
                controller: _controllers[i],
                autofocus: i == 0,
                maxLength: widget.fields[i].maxLength,
                maxLines: 1,
                textInputAction: i == widget.fields.length - 1
                    ? TextInputAction.done
                    : TextInputAction.next,
                onSubmitted: i == widget.fields.length - 1
                    ? (_) => _submit()
                    : null,
                decoration: InputDecoration(labelText: widget.fields[i].label),
              ),
            if (_error != null)
              Semantics(
                liveRegion: true,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    _error!,
                    key: const Key('request-error'),
                    style: TextStyle(color: paletteOf(context).error),
                  ),
                ),
              ),
            const _WriteAccessNote(),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(onPressed: _submit, child: const Text('Abrir GitHub')),
      ],
    );
  }
}
