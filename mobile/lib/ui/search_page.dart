import 'package:flutter/material.dart';

import '../services.dart';
import '../theme.dart';
import 'cards.dart';
import 'collection_page.dart';
import 'collection_ref.dart';
import 'common.dart';
import 'song_row.dart';

/// Buscar: campo redondeado grande y, sin texto, «Explorar todo» con las colecciones en tiles de color.
class SearchPage extends StatefulWidget {
  const SearchPage({super.key, required this.services});

  final AppServices services;

  @override
  State<SearchPage> createState() => _SearchPageState();
}

class _SearchPageState extends State<SearchPage> {
  final TextEditingController _controller = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final services = widget.services;
    final library = services.library;
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: Listenable.merge([
        library,
        services.collections,
        services.covers,
      ]),
      builder: (context, _) {
        return CustomScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          slivers: [
            SliverSafeArea(
              bottom: false,
              sliver: SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  child: Semantics(
                    header: true,
                    child: Text(
                      'Buscar',
                      style: theme.textTheme.headlineMedium,
                    ),
                  ),
                ),
              ),
            ),
            // Sin cabecera fija: con el texto ampliado el campo crece y no debe recortarse.
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: _SearchField(
                  controller: _controller,
                  onChanged: (value) => setState(() => _query = value),
                  onClear: () {
                    _controller.clear();
                    setState(() => _query = '');
                  },
                ),
              ),
            ),
            ...(_query.trim().isEmpty ? _browse(context) : _results(context)),
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
          ],
        );
      },
    );
  }

  List<Widget> _browse(BuildContext context) {
    final services = widget.services;
    final library = services.library;
    final refs = <CollectionRef>[
      const AllSongsRef(),
      const RecentRef(),
      const LikedRef(),
      for (final folder in library.folders.where((f) => f.parentId == null))
        FolderRef(folder.id),
      if (library.localSongs.isNotEmpty) const LocalRef(),
    ];
    return [
      const SliverToBoxAdapter(child: SectionHeading('Explorar todo')),
      SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        sliver: SliverGrid(
          gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 240,
            mainAxisExtent: browseTileExtent(context),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
          ),
          delegate: SliverChildListDelegate([
            for (final ref in refs)
              Builder(
                builder: (context) {
                  final view = resolveCollection(services, ref);
                  return BrowseTile(
                    title: view.title,
                    color: view.color ?? coverColorFor(ref.key),
                    icon: view.icon,
                    onTap: () => openCollection(context, services, ref),
                  );
                },
              ),
          ]),
        ),
      ),
    ];
  }

  List<Widget> _results(BuildContext context) {
    final services = widget.services;
    final library = services.library;
    final songs = library.searchSongs(_query);
    final folders = library.searchFolders(_query);
    if (songs.isEmpty && folders.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: Semantics(
            liveRegion: true,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 32, 24, 0),
              child: Text(
                'No hay resultados para «${_query.trim()}».',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge,
              ),
            ),
          ),
        ),
      ];
    }
    return [
      SliverToBoxAdapter(
        child: Semantics(
          liveRegion: true,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(
              songs.length + folders.length == 1
                  ? '1 resultado'
                  : '${songs.length + folders.length} resultados',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ),
      ),
      for (final folder in folders)
        SliverToBoxAdapter(
          child: ListTile(
            leading: CoverArt(
              seed: FolderRef(folder.id).key,
              size: 40,
              icon: Icons.album_rounded,
              image: services.covers.imageFor(folder.cover),
            ),
            title: Text(folder.name),
            subtitle: Text(
              folder.artist.isEmpty ? 'Álbum' : 'Álbum · ${folder.artist}',
            ),
            onTap: () =>
                openCollection(context, services, FolderRef(folder.id)),
          ),
        ),
      SliverList.builder(
        itemCount: songs.length,
        itemBuilder: (context, i) => SongRow(
          song: songs[i],
          services: services,
          onTap: () => runWithNotice(
            context,
            () => services.playback.playAt(songs, i),
            failurePrefix: 'No se pudo reproducir «${songs[i].title}»',
          ),
        ),
      ),
    ];
  }
}

/// Campo de búsqueda blanco y redondeado, con texto negro (contraste 21:1).
class _SearchField extends StatelessWidget {
  const _SearchField({
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    const ink = Color(0xFF000000);
    const hint = Color(0xFF535353);
    return TextField(
      key: const Key('search-field'),
      controller: controller,
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      cursorColor: ink,
      style: theme.textTheme.bodyLarge?.copyWith(
        color: ink,
        fontWeight: FontWeight.w500,
      ),
      decoration: InputDecoration(
        filled: true,
        fillColor: Colors.white,
        hintText: '¿Qué te apetece escuchar?',
        hintStyle: theme.textTheme.bodyLarge?.copyWith(
          color: hint,
          fontWeight: FontWeight.w500,
        ),
        prefixIcon: const Icon(Icons.search_rounded, color: ink, size: 28),
        suffixIcon: ValueListenableBuilder<TextEditingValue>(
          valueListenable: controller,
          builder: (context, value, _) => value.text.isEmpty
              ? const SizedBox.shrink()
              : IconButton(
                  tooltip: 'Borrar la búsqueda',
                  icon: const Icon(Icons.close_rounded, color: ink),
                  onPressed: onClear,
                ),
        ),
        contentPadding: const EdgeInsets.symmetric(vertical: 16),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(28),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(28),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(28),
          borderSide: BorderSide(color: paletteOf(context).accent, width: 3),
        ),
      ),
    );
  }
}
