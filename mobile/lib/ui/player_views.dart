import 'package:flutter/material.dart';

import '../layout.dart';
import '../playback.dart';
import 'common.dart';

/// Barra inferior del teléfono: canción actual y los tres botones de siempre.
class MiniPlayerBar extends StatelessWidget {
  const MiniPlayerBar({super.key, required this.playback});

  final PlaybackPort playback;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHigh,
        border: Border(
          top: BorderSide(color: theme.colorScheme.outlineVariant),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
        child: ValueListenableBuilder<NowPlaying>(
          valueListenable: playback.nowPlaying,
          builder: (context, now, _) => Row(
            children: [
              Expanded(
                child: _TrackText(
                  playback: playback,
                  now: now,
                  large: false,
                  centered: false,
                ),
              ),
              _Transport(
                playback: playback,
                now: now,
                buttonSize: 40,
                iconSize: 26,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Columna lateral de la tableta: portada, canción y botones.
class PlayerPanel extends StatelessWidget {
  const PlayerPanel({super.key, required this.playback});

  final PlaybackPort playback;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<NowPlaying>(
      valueListenable: playback.nowPlaying,
      builder: (context, now, _) => Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const _Artwork(size: 200),
              const SizedBox(height: 24),
              _TrackText(
                playback: playback,
                now: now,
                large: true,
                centered: true,
              ),
              const SizedBox(height: 16),
              _Transport(
                playback: playback,
                now: now,
                buttonSize: 56,
                iconSize: 30,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Reproductor del modo paciente: icono grande, título grande y tres botones de al menos 64 dp.
/// Sin carpetas ni acciones secundarias.
class PatientPlayer extends StatelessWidget {
  const PatientPlayer({
    super.key,
    required this.playback,
    this.artworkSize = 180,
  });

  final PlaybackPort playback;
  final double artworkSize;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<NowPlaying>(
      valueListenable: playback.nowPlaying,
      builder: (context, now, _) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _Artwork(size: artworkSize),
          const SizedBox(height: 12),
          _TrackText(playback: playback, now: now, large: true, centered: true),
          const SizedBox(height: 12),
          _Transport(
            playback: playback,
            now: now,
            buttonSize: kPatientButtonSize,
            iconSize: 40,
          ),
        ],
      ),
    );
  }
}

/// Icono de portada: la app no tiene imágenes de álbum.
class _Artwork extends StatelessWidget {
  const _Artwork({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.primary;
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.14),
          borderRadius: BorderRadius.circular(size * 0.14),
        ),
        child: Icon(Icons.music_note_rounded, size: size * 0.5, color: color),
      ),
    );
  }
}

/// Título, artista, estado de carga y último error de reproducción.
class _TrackText extends StatelessWidget {
  const _TrackText({
    required this.playback,
    required this.now,
    required this.large,
    required this.centered,
  });

  final PlaybackPort playback;
  final NowPlaying now;
  final bool large;
  final bool centered;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final align = centered ? TextAlign.center : TextAlign.start;
    return Column(
      crossAxisAlignment: centered
          ? CrossAxisAlignment.center
          : CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          now.songId == null ? 'Elige una canción' : now.title,
          maxLines: large ? 3 : 1,
          overflow: TextOverflow.ellipsis,
          textAlign: align,
          style: large
              ? theme.textTheme.headlineSmall
              : theme.textTheme.titleSmall,
        ),
        if (now.artist.isNotEmpty)
          Text(
            now.artist,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: align,
            style: large
                ? theme.textTheme.titleMedium
                : theme.textTheme.bodySmall,
          ),
        if (now.buffering)
          Text(
            'Cargando audio…',
            textAlign: align,
            style: theme.textTheme.bodySmall,
          ),
        ValueListenableBuilder<String?>(
          valueListenable: playback.playbackError,
          builder: (context, error, _) {
            if (error == null) return const SizedBox.shrink();
            return Semantics(
              liveRegion: true,
              child: Text(
                'Error de reproducción: $error',
                textAlign: align,
                style: TextStyle(color: theme.colorScheme.error),
              ),
            );
          },
        ),
      ],
    );
  }
}

/// Botones anterior, reproducir o pausar, y siguiente. Desactivados si no hay ninguna canción cargada.
class _Transport extends StatelessWidget {
  const _Transport({
    required this.playback,
    required this.now,
    required this.buttonSize,
    required this.iconSize,
  });

  final PlaybackPort playback;
  final NowPlaying now;
  final double buttonSize;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    final hasTrack = now.songId != null;
    final style = IconButton.styleFrom(
      minimumSize: Size.square(buttonSize),
      iconSize: iconSize,
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          key: const Key('transport-previous'),
          tooltip: 'Canción anterior',
          style: style,
          onPressed: hasTrack
              ? () => _run(context, playback.playPrevious)
              : null,
          icon: const Icon(Icons.skip_previous_rounded),
        ),
        IconButton.filled(
          key: const Key('transport-play'),
          tooltip: now.playing ? 'Pausar' : 'Reproducir',
          style: style,
          onPressed: hasTrack
              ? () => _run(context, playback.togglePlayPause)
              : null,
          icon: Icon(
            now.playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
          ),
        ),
        IconButton(
          key: const Key('transport-next'),
          tooltip: 'Canción siguiente',
          style: style,
          onPressed: hasTrack ? () => _run(context, playback.playNext) : null,
          icon: const Icon(Icons.skip_next_rounded),
        ),
      ],
    );
  }

  Future<bool> _run(BuildContext context, Future<void> Function() action) {
    return runWithNotice(
      context,
      action,
      failurePrefix: 'No se pudo reproducir',
    );
  }
}
