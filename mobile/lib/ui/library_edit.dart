import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../app_error.dart';
import '../fuzzy_search.dart' show searchRank, songSearchFields;
import '../library_requests.dart';
import '../playlist_covers.dart';
import '../services.dart';
import '../song.dart';
import '../theme.dart';
import 'collection_ref.dart';
import 'common.dart';

// Edición de la biblioteca común desde la app, igual que en la web: no hay usuarios, así que cada cambio se envía
// a /api/editar (ADR-0022), que lo valida y lo guarda con el token del servidor. Sin pasar por GitHub.

/// True si la canción es del catálogo común (las subidas a este teléfono no se editan).
bool isEditableSong(Song song) => !song.local && isCatalogSongId(song.id);

/// Guarda el cambio de [request] y avisa del resultado. Queda pendiente (se ve ya con la marca «Pendiente») hasta que
/// llega al catálogo; si ya hay uno igual pendiente, no se reenvía (ADR-0027).
Future<void> openLibraryRequest(
  BuildContext context,
  AppServices services,
  LibraryRequest request,
) => _save(
  context,
  () => services.library.edits.submit(request, services.submitEdit),
);

Future<void> _save(
  BuildContext context,
  Future<String> Function() action,
) async {
  final messenger = ScaffoldMessenger.of(context);
  messenger.showSnackBar(const SnackBar(content: Text('Guardando…')));
  String text;
  try {
    text = await action();
  } on AppException catch (error) {
    text = error.message;
  } catch (_) {
    text = 'No se pudo guardar. Inténtalo de nuevo.';
  }
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));
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
          maxLength: kMaxSongArtistLength,
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

/// «Quitar de este álbum» (desde la página del álbum): pide confirmación y deja la canción sin álbum.
/// Nunca la borra: sigue en la biblioteca común.
Future<void> removeSongFromAlbumFlow(
  BuildContext context,
  AppServices services,
  Song song, {
  required String albumName,
}) async {
  final album = albumName.trim().isEmpty
      ? 'este álbum'
      : '«${albumName.trim()}»';
  final confirmed = await showConfirmDialog(
    context,
    title: 'Quitar de este álbum',
    message:
        '¿Quitar «${song.title}» de $album? La canción sigue en la biblioteca; solo deja de estar en este álbum.',
    confirmLabel: 'Quitar',
  );
  if (!confirmed || !context.mounted) return;
  await openLibraryRequest(
    context,
    services,
    LibraryRequest.moveSong(songId: song.id, folderId: null),
  );
}

/// Selección de un álbum › «Quitar del álbum»: pide confirmación y deja sin álbum todas las elegidas con UNA petición
/// «move_songs» (folder_id null). Devuelve true si se envió. Las canciones siguen en la biblioteca.
Future<bool> removeSongsFromAlbumFlow(
  BuildContext context,
  AppServices services,
  Folder folder,
  List<String> songIds,
) async {
  final LibraryRequest request;
  try {
    request = LibraryRequest.moveSongs(songIds: songIds, folderId: null);
  } on AppException catch (error) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(error.message)));
    return false;
  }
  final count = songIds.length;
  final what = count == 1 ? '1 canción' : '$count canciones';
  final confirmed = await showConfirmDialog(
    context,
    title: 'Quitar del álbum',
    message:
        '¿Quitar $what de «${folder.name}»? Siguen en la biblioteca; solo dejan de estar en este álbum.',
    confirmLabel: 'Quitar',
  );
  if (!confirmed || !context.mounted) return false;
  await openLibraryRequest(context, services, request);
  return true;
}

/// Selección de un álbum › «Mover a otro álbum»: elige el álbum de destino y pasa todas las elegidas con UNA petición
/// «move_songs». Devuelve true si se envió.
Future<bool> moveSongsToAlbumFlow(
  BuildContext context,
  AppServices services,
  Folder folder,
  List<String> songIds,
) async {
  final targets = services.library.folders
      .where((item) => item.id != folder.id && isCatalogFolderId(item.id))
      .toList();
  final count = songIds.length;
  final what = count == 1 ? '1 canción' : '$count canciones';
  final picked = await showDialog<Folder>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text('Mover $what a otro álbum'),
      content: SizedBox(
        width: double.maxFinite,
        child: ListView(
          shrinkWrap: true,
          children: [
            const _WriteAccessNote(),
            if (targets.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text(
                  'No hay otros álbumes. Crea uno con «Crear álbum».',
                ),
              ),
            for (final target in targets)
              ListTile(
                key: ValueKey('album-move-target-${target.id}'),
                leading: CoverArt(
                  seed: FolderRef(target.id).key,
                  size: 40,
                  icon: Icons.album_rounded,
                  image: services.covers.imageFor(target.cover),
                ),
                title: Text(
                  target.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: target.artist.isEmpty ? null : Text(target.artist),
                onTap: () => Navigator.of(dialogContext).pop(target),
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
  if (picked == null || !context.mounted) return false;
  final LibraryRequest request;
  try {
    request = LibraryRequest.moveSongs(
      songIds: songIds,
      folderId: picked.id,
      albumName: picked.name,
    );
  } on AppException catch (error) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(error.message)));
    return false;
  }
  await openLibraryRequest(context, services, request);
  return true;
}

/// «Ordenar canciones» de un álbum (ADR-0026): lista que se reordena arrastrando o con «Subir» y «Bajar»; «Guardar
/// orden» envía UNA petición «order_album» con la lista completa de las canciones del álbum en el orden nuevo.
Future<void> orderAlbumFlow(
  BuildContext context,
  AppServices services,
  Folder folder,
) async {
  final songs = services.library
      .songsInFolder(folder.id)
      .where(isEditableSong)
      .toList();
  final request = await Navigator.of(context).push<LibraryRequest>(
    MaterialPageRoute(
      builder: (_) =>
          OrderAlbumPage(services: services, folder: folder, songs: songs),
    ),
  );
  if (request == null || !context.mounted) return;
  await openLibraryRequest(context, services, request);
}

/// Mensaje de un álbum con más canciones de las que caben en una petición «order_album».
const String kOrderAlbumTooLong =
    'Este álbum tiene más de $kMaxOrderSongs canciones: no se puede ordenar desde aquí.';

/// Pantalla «Ordenar canciones». Devuelve la petición «order_album» al guardar, o null si se vuelve atrás.
class OrderAlbumPage extends StatefulWidget {
  const OrderAlbumPage({
    super.key,
    required this.services,
    required this.folder,
    required this.songs,
  });

  final AppServices services;
  final Folder folder;

  /// Canciones del álbum en su orden actual.
  final List<Song> songs;

  @override
  State<OrderAlbumPage> createState() => _OrderAlbumPageState();
}

class _OrderAlbumPageState extends State<OrderAlbumPage> {
  late List<Song> _order = List.of(widget.songs);
  String _announcement = '';
  String? _error;

  bool get _tooLong => widget.songs.length > kMaxOrderSongs;

  bool get _changed {
    for (var i = 0; i < _order.length; i++) {
      if (_order[i].id != widget.songs[i].id) return true;
    }
    return false;
  }

  void _move(int from, int to) {
    if (from == to || to < 0 || to >= _order.length) return;
    setState(() {
      final next = List.of(_order);
      final song = next.removeAt(from);
      next.insert(to, song);
      _order = next;
      _error = null;
      _announcement =
          '«${song.title}» ahora es la ${to + 1} de ${_order.length}.';
    });
  }

  void _save() {
    try {
      Navigator.of(context).pop(
        LibraryRequest.orderAlbum(
          folderId: widget.folder.id,
          songIds: [for (final song in _order) song.id],
          albumName: widget.folder.name,
        ),
      );
    } on AppException catch (error) {
      setState(() => _error = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = paletteOf(context);
    final canSave = !_tooLong && _changed;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ordenar canciones'),
        leading: IconButton(
          tooltip: 'Volver sin guardar',
          icon: const Icon(Icons.close_rounded),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Text(
              _tooLong
                  ? kOrderAlbumTooLong
                  : 'Mantén pulsada una canción y arrástrala, o usa las flechas. El orden se guarda para todos.',
              key: const ValueKey('order-album-help'),
              style: theme.textTheme.bodyMedium,
            ),
          ),
          Semantics(
            liveRegion: true,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Text(
                _error ?? _announcement,
                key: const ValueKey('order-album-status'),
                style: _error == null
                    ? theme.textTheme.bodySmall
                    : TextStyle(color: palette.error),
              ),
            ),
          ),
          Expanded(
            child: _tooLong
                ? const SizedBox.shrink()
                : ReorderableListView.builder(
                    key: const ValueKey('order-album-list'),
                    buildDefaultDragHandles: false,
                    itemCount: _order.length,
                    onReorderItem: _move,
                    itemBuilder: (context, i) {
                      final song = _order[i];
                      return ReorderableDelayedDragStartListener(
                        key: ValueKey('order-song-${song.id}'),
                        index: i,
                        child: ListTile(
                          leading: const Icon(
                            Icons.drag_handle_rounded,
                            semanticLabel: 'Mantén pulsado para arrastrar',
                          ),
                          title: Text(
                            '${i + 1}. ${song.title}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: song.artist.isEmpty
                              ? null
                              : Text(
                                  song.artist,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                key: ValueKey('order-up-${song.id}'),
                                tooltip: 'Subir «${song.title}»',
                                icon: const Icon(Icons.arrow_upward_rounded),
                                onPressed: i == 0
                                    ? null
                                    : () => _move(i, i - 1),
                              ),
                              IconButton(
                                key: ValueKey('order-down-${song.id}'),
                                tooltip: 'Bajar «${song.title}»',
                                icon: const Icon(Icons.arrow_downward_rounded),
                                onPressed: i == _order.length - 1
                                    ? null
                                    : () => _move(i, i + 1),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
          const Divider(height: 1),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: Row(
                children: [
                  const Expanded(child: _WriteAccessNote()),
                  const SizedBox(width: 8),
                  FilledButton(
                    key: const ValueKey('order-album-save'),
                    onPressed: canSave ? _save : null,
                    child: const Text('Guardar orden'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Filtro del buscador de «Añadir canciones a este álbum»: la regla común de búsqueda (ADR-0028, lib/fuzzy_search.dart)
/// por título, artista, nombre del álbum en el que está ahora la canción ([albumName]), año y etiquetas, de más a
/// menos relevantes. Sin texto devuelve todas, en su orden.
List<Song> filterSongsForAlbumPicker(
  List<Song> songs,
  String query, {
  required String Function(Song song) albumName,
}) =>
    searchRank(songs, query, (song) => songSearchFields(song, albumName(song)));

/// Desde un álbum: busca y marca varias canciones del catálogo y las pasa a este álbum con una sola petición.
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
    builder: (sheetContext) =>
        _AddSongsSheet(services: services, folder: folder, songs: songs),
  );
  if (request == null || !context.mounted) return;
  await openLibraryRequest(context, services, request);
}

class _AddSongsSheet extends StatefulWidget {
  const _AddSongsSheet({
    required this.services,
    required this.folder,
    required this.songs,
  });

  final AppServices services;
  final Folder folder;

  /// Canciones editables que no están ya en el álbum.
  final List<Song> songs;

  @override
  State<_AddSongsSheet> createState() => _AddSongsSheetState();
}

class _AddSongsSheetState extends State<_AddSongsSheet> {
  final TextEditingController _search = TextEditingController();
  String _query = '';

  /// IDs marcados; se mantienen al cambiar la búsqueda.
  final Set<String> _selected = {};
  String? _error;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  String _albumOf(Song song) {
    final id = song.folderId;
    if (id == null) return '';
    return widget.services.library.folderOrNull(id)?.name ?? '';
  }

  void _toggle(Song song, bool select) {
    setState(() {
      _error = null;
      if (select) {
        if (_selected.length < kMaxMoveSongs) _selected.add(song.id);
      } else {
        _selected.remove(song.id);
      }
    });
  }

  void _submit() {
    // En el orden del catálogo, para que la petición no dependa del orden en que se marcaron.
    final ids = [
      for (final song in widget.songs)
        if (_selected.contains(song.id)) song.id,
    ];
    try {
      Navigator.of(context).pop(
        LibraryRequest.moveSongs(
          songIds: ids,
          folderId: widget.folder.id,
          albumName: widget.folder.name,
        ),
      );
    } on AppException catch (error) {
      setState(() => _error = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = paletteOf(context);
    // Con el teclado abierto la hoja se encoge y sube, para que no tape la lista ni el botón.
    final screen = MediaQuery.sizeOf(context).height;
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    final available = screen - keyboard;
    final height = available < screen * 0.8 ? available * 0.95 : screen * 0.8;
    final visible = filterSongsForAlbumPicker(
      widget.songs,
      _query,
      albumName: _albumOf,
    );
    final count = _selected.length;
    final full = count >= kMaxMoveSongs;
    return Padding(
      padding: EdgeInsets.only(bottom: keyboard),
      child: SizedBox(
        height: height,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
              child: Semantics(
                header: true,
                child: Text(
                  'Añadir a «${widget.folder.name}»',
                  style: theme.textTheme.titleLarge,
                ),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 4, 16, 0),
              child: _WriteAccessNote(),
            ),
            if (widget.songs.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: TextField(
                  key: const ValueKey('add-songs-search'),
                  controller: _search,
                  autofocus: true,
                  onChanged: (value) => setState(() => _query = value),
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    hintText: 'Buscar por título, artista o álbum',
                    prefixIcon: const Icon(Icons.search_rounded),
                    suffixIcon: _query.isEmpty
                        ? null
                        : IconButton(
                            key: const ValueKey('add-songs-search-clear'),
                            tooltip: 'Borrar la búsqueda',
                            icon: const Icon(Icons.close_rounded),
                            onPressed: () {
                              _search.clear();
                              setState(() => _query = '');
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
            Expanded(
              child: widget.songs.isEmpty
                  ? const MessagePanel(
                      icon: Icons.library_music_outlined,
                      message:
                          'No quedan canciones de la biblioteca común fuera de este álbum.',
                    )
                  : visible.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        'Ninguna canción coincide con «${_query.trim()}».',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodyLarge?.copyWith(
                          color: palette.inkMuted,
                        ),
                      ),
                    )
                  : ListView.builder(
                      key: const ValueKey('add-songs-list'),
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      itemCount: visible.length,
                      itemBuilder: (context, i) {
                        final song = visible[i];
                        final checked = _selected.contains(song.id);
                        final album = _albumOf(song);
                        final details = [
                          if (song.artist.isNotEmpty) song.artist,
                          if (album.isNotEmpty) 'En «$album»',
                        ].join(' · ');
                        return CheckboxListTile(
                          key: ValueKey('add-song-${song.id}'),
                          value: checked,
                          onChanged: !checked && full
                              ? null
                              : (value) => _toggle(song, value ?? false),
                          controlAffinity: ListTileControlAffinity.trailing,
                          secondary: CatalogCover(
                            covers: widget.services.covers,
                            cover: song.cover,
                            seed: song.id,
                            size: 40,
                          ),
                          title: Text(
                            song.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: details.isEmpty
                              ? null
                              : Text(
                                  details,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                        );
                      },
                    ),
            ),
            if (_error != null)
              Semantics(
                liveRegion: true,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                  child: Text(_error!, style: TextStyle(color: palette.error)),
                ),
              ),
            const Divider(height: 1),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Semantics(
                        liveRegion: true,
                        child: Text(
                          full
                              ? '$count seleccionadas (máximo $kMaxMoveSongs)'
                              : count == 1
                              ? '1 seleccionada'
                              : '$count seleccionadas',
                          key: const ValueKey('add-songs-count'),
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Cancelar'),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      key: const ValueKey('add-songs-submit'),
                      onPressed: count == 0 ? null : _submit,
                      child: Text('Añadir ($count)'),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// «Cambiar portada»: se elige la imagen, se recorta a cuadrado (640 px) y se envía a /api/editar.
Future<void> changeCatalogCoverFlow(
  BuildContext context,
  AppServices services, {
  required String id,
  required String what,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  if (!canChangeCatalogCover(id)) {
    messenger.showSnackBar(
      const SnackBar(
        content: Text('Este elemento no admite cambiar la portada.'),
      ),
    );
    return;
  }
  final Uint8List? picked;
  try {
    picked = await services.pickImage();
  } catch (_) {
    messenger.showSnackBar(
      const SnackBar(content: Text('No se pudo leer la imagen elegida.')),
    );
    return;
  }
  if (picked == null || !context.mounted) return;
  final Uint8List image = picked;
  await _save(
    context,
    () => services.library.edits.submitCover(
      id,
      resizeCoverImage(image),
      services.submitCover,
    ),
  );
}

/// Menú de un álbum: editar, añadir canciones, crear otro álbum, cambiar la portada y ordenar las canciones.
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
              if (services.library
                      .songsInFolder(folder.id)
                      .where(isEditableSong)
                      .length >=
                  2)
                ListTile(
                  key: const ValueKey('album-menu-order'),
                  leading: const Icon(Icons.swap_vert_rounded),
                  title: const Text('Ordenar canciones'),
                  onTap: () {
                    close();
                    orderAlbumFlow(context, services, folder);
                  },
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
          'Biblioteca común (se guarda para todos)',
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

/// Formulario de una petición: campos de una línea, el aviso y «Guardar».
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
        FilledButton(onPressed: _submit, child: const Text('Guardar')),
      ],
    );
  }
}
