import 'package:flutter/material.dart';

import '../layout.dart';
import '../playback.dart';
import '../song.dart';
import 'common.dart';

/// Fila de una canción. Marca la que está sonando. En modo paciente (large) la fila es más alta;
/// las acciones secundarias las pone quien usa la fila (en modo paciente no se pasan).
class SongTile extends StatelessWidget {
  const SongTile({
    super.key,
    required this.song,
    required this.playback,
    this.position,
    this.large = false,
    this.onTap,
    this.trailing = const [],
  });

  final Song song;
  final PlaybackPort playback;
  final int? position;
  final bool large;
  final VoidCallback? onTap;
  final List<Widget> trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ValueListenableBuilder<NowPlaying>(
      valueListenable: playback.nowPlaying,
      builder: (context, now, _) {
        final current = now.songId == song.id;
        final details = [
          if (song.artist.isNotEmpty) song.artist,
          if (song.year != null) '${song.year}',
        ].join(' · ');
        final leadingIcon = now.playing ? Icons.graphic_eq : Icons.pause;
        return ListTile(
          selected: current,
          selectedColor: theme.colorScheme.primary,
          selectedTileColor: theme.colorScheme.primary.withValues(alpha: 0.12),
          minTileHeight: large ? kPatientTargetSize + 8 : null,
          onTap: onTap,
          leading: SizedBox(
            width: 32,
            child: Center(
              child: current
                  ? Icon(leadingIcon, color: theme.colorScheme.primary)
                  : Text(
                      '${position ?? ''}',
                      style: theme.textTheme.bodyMedium,
                    ),
            ),
          ),
          title: Text(
            song.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: large
                ? theme.textTheme.titleLarge
                : theme.textTheme.titleSmall,
          ),
          subtitle: details.isEmpty
              ? null
              : Text(
                  details,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall,
                ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                formatDuration(song.durationS),
                style: theme.textTheme.bodySmall,
              ),
              ...trailing,
            ],
          ),
        );
      },
    );
  }
}
