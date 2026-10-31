import 'package:flutter/material.dart';

import '../library_controller.dart';
import '../services.dart';
import '../song.dart';
import '../theme.dart';
import 'common.dart';
import 'player_views.dart';
import 'playlists_page.dart';
import 'song_tile.dart';

/// Pantalla «Escuchar»: estado de la biblioteca, carpetas, canciones y avisos.
/// Los errores se muestran aquí mismo, con su motivo y un botón para volver a intentarlo.
class LibraryPage extends StatelessWidget {
  const LibraryPage({
    super.key,
    required this.services,
    required this.patient,
    required this.inlinePlayer,
  });

  final AppServices services;

  /// Modo paciente: sin carpetas ni acciones secundarias.
  final bool patient;

  /// Teléfono en modo paciente: el reproductor grande va encima de la lista.
  final bool inlinePlayer;

  @override
  Widget build(BuildContext context) {
    final library = services.library;
    final collections = services.collections;
    return ListenableBuilder(
      listenable: Listenable.merge([library, collections]),
      builder: (context, _) {
        final notice = library.audioNotice;
        return Column(
          children: [
            _StatusLine(text: library.status, online: library.online),
            if (notice != null)
              InlineBanner(
                icon: Icons.volume_off_outlined,
                message: notice,
                actionLabel: 'Reintentar',
                onAction: () => library.retryAudio(),
              ),
            if (!patient && library.folders.isNotEmpty)
              _FolderChips(library: library),
            Expanded(child: _body(context)),
          ],
        );
      },
    );
  }

  Widget _body(BuildContext context) {
    final library = services.library;
    final loadError = library.loadError;
    if (library.loading && library.songs.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (loadError != null && library.songs.isEmpty) {
      return MessagePanel(
        icon: Icons.cloud_off_outlined,
        message: loadError,
        actionLabel: 'Reintentar',
        onAction: () => library.load(),
      );
    }
    if (library.songs.isEmpty) {
      return const MessagePanel(
        icon: Icons.library_music_outlined,
        message: 'Sin canciones todavía.',
      );
    }
    final visible = library.visibleSongs;
    if (visible.isEmpty) {
      return const MessagePanel(
        icon: Icons.folder_open_outlined,
        message: 'No hay canciones en esta carpeta.',
      );
    }
    // En el teléfono con modo paciente, el reproductor grande es la primera fila de la lista:
    // así nunca se sale de la pantalla aunque el texto esté muy ampliado.
    final header = inlinePlayer ? 1 : 0;
    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 8),
      itemCount: visible.length + header,
      itemBuilder: (context, index) {
        if (index < header) {
          return Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: PatientPlayer(playback: services.playback, artworkSize: 120),
          );
        }
        final i = index - header;
        final song = visible[i];
        return SongTile(
          song: song,
          playback: services.playback,
          position: i + 1,
          large: patient,
          onTap: () => runWithNotice(
            context,
            () => library.playSong(song),
            failurePrefix: 'No se pudo reproducir «${song.title}»',
          ),
          trailing: patient ? const [] : _secondaryActions(context, song),
        );
      },
    );
  }

  List<Widget> _secondaryActions(BuildContext context, Song song) {
    final collections = services.collections;
    final favorite = collections.isFavorite(song.id);
    return [
      IconButton(
        tooltip: favorite ? 'Quitar de favoritos' : 'Añadir a favoritos',
        icon: Icon(favorite ? Icons.star : Icons.star_border),
        onPressed: () => runWithNotice(context, () async {
          await collections.toggleFavorite(song.id);
        }, failurePrefix: 'No se pudo cambiar el favorito'),
      ),
      IconButton(
        tooltip: 'Añadir a una lista',
        icon: const Icon(Icons.playlist_add),
        onPressed: () => showAddToPlaylistDialog(context, services, song),
      ),
    ];
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.text, required this.online});

  final String text;
  final bool online;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dotColor = online
        ? paletteOf(context).online
        : theme.colorScheme.outline;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Row(
        children: [
          ExcludeSemantics(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: dotColor,
                shape: BoxShape.circle,
              ),
              child: const SizedBox(width: 8, height: 8),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodySmall,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _FolderChips extends StatelessWidget {
  const _FolderChips({required this.library});

  final LibraryController library;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        children: [
          _chip('Todas', null),
          _chip('Sin carpeta', LibraryController.noFolderKey),
          for (final folder in library.folders.where(
            (folder) => folder.parentId == null,
          ))
            _chip(folder.name, folder.id),
        ],
      ),
    );
  }

  Widget _chip(String label, String? key) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: library.folderKey == key,
        onSelected: (_) => library.selectFolder(key),
      ),
    );
  }
}
