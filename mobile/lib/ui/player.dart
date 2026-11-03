import 'dart:async';

import 'package:flutter/material.dart';

import '../layout.dart';
import '../playback.dart';
import '../services.dart';
import '../theme.dart';
import 'common.dart';

/// Reconstruye [builder] con la posición actual. Solo hay temporizador mientras suena, la app está
/// en primer plano y el widget está a la vista (TickerMode): fuera de eso, cero trabajo.
class ProgressBuilder extends StatefulWidget {
  const ProgressBuilder({
    super.key,
    required this.playback,
    required this.builder,
    this.interval = const Duration(milliseconds: 500),
    this.clock = DateTime.now,
  });

  final PlaybackPort playback;
  final Widget Function(
    BuildContext context,
    Duration position,
    Duration duration,
  )
  builder;
  final Duration interval;
  final DateTime Function() clock;

  @override
  State<ProgressBuilder> createState() => _ProgressBuilderState();
}

class _ProgressBuilderState extends State<ProgressBuilder>
    with WidgetsBindingObserver {
  Timer? _timer;
  bool _foreground = true;
  bool _visible = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final state = WidgetsBinding.instance.lifecycleState;
    _foreground = state == null || state == AppLifecycleState.resumed;
    widget.playback.progress.addListener(_onProgress);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _visible = TickerMode.valuesOf(context).enabled;
    _schedule();
  }

  @override
  void didUpdateWidget(ProgressBuilder oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.playback != widget.playback) {
      oldWidget.playback.progress.removeListener(_onProgress);
      widget.playback.progress.addListener(_onProgress);
    }
    _schedule();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _schedule();
  }

  void _onProgress() {
    if (!mounted) return;
    setState(() {});
    _schedule();
  }

  void _schedule() {
    final wanted =
        _foreground && _visible && widget.playback.progress.value.playing;
    if (wanted && _timer == null) {
      _timer = Timer.periodic(widget.interval, (_) {
        if (mounted) setState(() {});
      });
    } else if (!wanted && _timer != null) {
      _timer!.cancel();
      _timer = null;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    widget.playback.progress.removeListener(_onProgress);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final progress = widget.playback.progress.value;
    return widget.builder(
      context,
      progress.positionAt(widget.clock()),
      progress.duration,
    );
  }
}

/// Color del minirreproductor: el de la portada, oscurecido para que el texto cumpla AA.
Color miniPlayerColor(String songId) =>
    Color.lerp(coverColorFor(songId), Colors.black, 0.5)!;

/// Minirreproductor de 56 px redondeado, encima de la barra inferior, con una línea fina de progreso.
/// Al tocarlo se abre el reproductor a pantalla completa.
class MiniPlayer extends StatelessWidget {
  const MiniPlayer({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    final playback = services.playback;
    final theme = Theme.of(context);
    final palette = paletteOf(context);
    return ValueListenableBuilder<NowPlaying>(
      valueListenable: playback.nowPlaying,
      builder: (context, now, _) {
        final songId = now.songId;
        if (songId == null) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.fromLTRB(8, 0, 8, 4),
          child: Material(
            color: miniPlayerColor(songId),
            borderRadius: BorderRadius.circular(6),
            clipBehavior: Clip.antiAlias,
            // Mide 56 dp con el texto normal y crece si se amplía, para no recortar el título.
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: kMiniPlayerHeight),
              child: Stack(
                children: [
                  IntrinsicHeight(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Expanded(
                          child: Semantics(
                            button: true,
                            label:
                                'Abrir el reproductor: ${now.title}${now.artist.isEmpty ? '' : ', ${now.artist}'}',
                            excludeSemantics: true,
                            child: InkWell(
                              key: const Key('mini-player-open'),
                              onTap: () => openFullPlayer(context, services),
                              child: Padding(
                                padding: const EdgeInsets.fromLTRB(8, 8, 4, 8),
                                child: Row(
                                  children: [
                                    CatalogCover(
                                      covers: services.covers,
                                      cover: services.library
                                          .songOrNull(songId)
                                          ?.cover,
                                      seed: songId,
                                      size: 40,
                                    ),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Column(
                                        mainAxisAlignment:
                                            MainAxisAlignment.center,
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            now.title,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: theme.textTheme.titleSmall,
                                          ),
                                          if (now.artist.isNotEmpty)
                                            Text(
                                              now.artist,
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
                          ),
                        ),
                        LikeButton(services: services, songId: songId),
                        IconButton(
                          key: const Key('mini-play'),
                          tooltip: now.playing ? 'Pausar' : 'Reproducir',
                          iconSize: 32,
                          onPressed: () => runWithNotice(
                            context,
                            playback.togglePlayPause,
                            failurePrefix: 'No se pudo reproducir',
                          ),
                          icon: Icon(
                            now.playing
                                ? Icons.pause_rounded
                                : Icons.play_arrow_rounded,
                          ),
                        ),
                        const SizedBox(width: 4),
                      ],
                    ),
                  ),
                  Positioned(
                    left: 8,
                    right: 8,
                    bottom: 0,
                    child: ExcludeSemantics(
                      child: ProgressBuilder(
                        playback: playback,
                        builder: (context, position, duration) {
                          final fraction = duration <= Duration.zero
                              ? 0.0
                              : (position.inMilliseconds /
                                        duration.inMilliseconds)
                                    .clamp(0.0, 1.0);
                          return ClipRRect(
                            borderRadius: BorderRadius.circular(1),
                            child: LinearProgressIndicator(
                              key: const Key('mini-progress'),
                              value: fraction,
                              minHeight: 2,
                              color: palette.ink,
                              backgroundColor: palette.ink.withValues(
                                alpha: 0.3,
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Botón «Me gusta» de la canción que suena. Si [liked] cambia, se guarda solo en este teléfono.
class LikeButton extends StatelessWidget {
  const LikeButton({
    super.key,
    required this.services,
    required this.songId,
    this.size = 24,
  });

  final AppServices services;
  final String songId;
  final double size;

  @override
  Widget build(BuildContext context) {
    final palette = paletteOf(context);
    return ListenableBuilder(
      listenable: services.collections,
      builder: (context, _) {
        final liked = services.collections.isFavorite(songId);
        return IconButton(
          tooltip: liked ? 'Quitar de Me gusta' : 'Añadir a Me gusta',
          isSelected: liked,
          iconSize: size,
          onPressed: () => runWithNotice(context, () async {
            await services.collections.toggleFavorite(songId);
          }, failurePrefix: 'No se pudo cambiar «Me gusta»'),
          icon: Icon(
            liked ? Icons.favorite_rounded : Icons.favorite_border_rounded,
            color: liked ? palette.accent : palette.ink,
          ),
        );
      },
    );
  }
}

/// Abre el reproductor a pantalla completa por encima de todo (también de la barra inferior).
Future<void> openFullPlayer(BuildContext context, AppServices services) {
  return Navigator.of(context, rootNavigator: true).push(
    MaterialPageRoute<void>(
      fullscreenDialog: true,
      builder: (_) => FullPlayerPage(services: services),
    ),
  );
}

/// Reproductor a pantalla completa: portada grande, título, artista, «Me gusta», barra de progreso
/// y los controles aleatorio, anterior, reproducir, siguiente y repetir.
class FullPlayerPage extends StatelessWidget {
  const FullPlayerPage({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    final playback = services.playback;
    final theme = Theme.of(context);
    final palette = paletteOf(context);
    return ValueListenableBuilder<NowPlaying>(
      valueListenable: playback.nowPlaying,
      builder: (context, now, _) {
        final songId = now.songId;
        final top = songId == null
            ? palette.elevated
            : Color.lerp(coverColorFor(songId), Colors.black, 0.25)!;
        return Scaffold(
          backgroundColor: palette.background,
          body: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [top, palette.background],
                stops: const [0, 0.85],
              ),
            ),
            child: SafeArea(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final side = (constraints.maxWidth - 48).clamp(120.0, 420.0);
                  final artwork = side
                      .clamp(120.0, constraints.maxHeight * 0.45)
                      .toDouble();
                  return SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
                    child: Column(
                      children: [
                        Row(
                          children: [
                            IconButton(
                              tooltip: 'Cerrar el reproductor',
                              icon: const Icon(
                                Icons.keyboard_arrow_down_rounded,
                              ),
                              iconSize: 32,
                              onPressed: () => Navigator.of(context).pop(),
                            ),
                            Expanded(
                              child: Text(
                                'Reproduciendo',
                                textAlign: TextAlign.center,
                                style: theme.textTheme.labelMedium,
                              ),
                            ),
                            const SizedBox(width: kMinTouchTarget),
                          ],
                        ),
                        const SizedBox(height: 24),
                        if (songId == null)
                          Icon(
                            Icons.music_note_rounded,
                            size: artwork * 0.4,
                            color: palette.inkMuted,
                          )
                        else
                          CatalogCover(
                            key: const Key('player-artwork'),
                            covers: services.covers,
                            cover: services.library.songOrNull(songId)?.cover,
                            seed: songId,
                            size: artwork,
                          ),
                        const SizedBox(height: 32),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Semantics(
                                    header: true,
                                    child: Text(
                                      songId == null
                                          ? 'Elige una canción'
                                          : now.title,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: theme.textTheme.headlineSmall,
                                    ),
                                  ),
                                  if (now.artist.isNotEmpty)
                                    Text(
                                      now.artist,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: theme.textTheme.bodyLarge
                                          ?.copyWith(color: palette.inkMuted),
                                    ),
                                ],
                              ),
                            ),
                            if (songId != null)
                              LikeButton(
                                services: services,
                                songId: songId,
                                size: 28,
                              ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        _SeekBar(playback: playback, enabled: songId != null),
                        const SizedBox(height: 8),
                        _Transport(playback: playback, now: now),
                        const SizedBox(height: 16),
                        if (now.buffering)
                          Text(
                            'Cargando audio…',
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
                                textAlign: TextAlign.center,
                                style: TextStyle(color: palette.error),
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Barra de progreso con los tiempos. Se puede arrastrar para saltar a otro punto.
class _SeekBar extends StatefulWidget {
  const _SeekBar({required this.playback, required this.enabled});

  final PlaybackPort playback;
  final bool enabled;

  @override
  State<_SeekBar> createState() => _SeekBarState();
}

class _SeekBarState extends State<_SeekBar> {
  double? _dragging;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ProgressBuilder(
      playback: widget.playback,
      builder: (context, position, duration) {
        final total = duration.inMilliseconds.toDouble();
        final current = (_dragging ?? position.inMilliseconds.toDouble())
            .clamp(0.0, total <= 0 ? 0.0 : total)
            .toDouble();
        final shown = Duration(milliseconds: current.round());
        return Column(
          children: [
            SliderTheme(
              data: SliderTheme.of(context).copyWith(
                trackHeight: 4,
                thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
                overlayShape: const RoundSliderOverlayShape(overlayRadius: 20),
              ),
              child: Slider(
                key: const Key('player-seek'),
                min: 0,
                max: total <= 0 ? 1 : total,
                value: total <= 0 ? 0 : current,
                semanticFormatterCallback: (value) =>
                    '${formatDuration(value / 1000)} de ${formatDuration(total / 1000)}',
                onChanged: widget.enabled && total > 0
                    ? (value) => setState(() => _dragging = value)
                    : null,
                onChangeEnd: widget.enabled && total > 0
                    ? (value) {
                        setState(() => _dragging = null);
                        runWithNotice(
                          context,
                          () => widget.playback.seek(
                            Duration(milliseconds: value.round()),
                          ),
                          failurePrefix: 'No se pudo saltar',
                        );
                      }
                    : null,
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: ExcludeSemantics(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      formatDuration(shown.inMilliseconds / 1000),
                      style: theme.textTheme.bodySmall,
                    ),
                    Text(
                      formatDuration(duration.inMilliseconds / 1000),
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Aleatorio, anterior, reproducir (círculo blanco grande), siguiente y repetir.
class _Transport extends StatelessWidget {
  const _Transport({required this.playback, required this.now});

  final PlaybackPort playback;
  final NowPlaying now;

  @override
  Widget build(BuildContext context) {
    final palette = paletteOf(context);
    final hasTrack = now.songId != null;
    Future<bool> run(Future<void> Function() action) =>
        runWithNotice(context, action, failurePrefix: 'No se pudo reproducir');
    final repeatLabel = switch (now.repeat) {
      LoopSetting.off => 'Repetir: desactivado',
      LoopSetting.all => 'Repetir: toda la lista',
      LoopSetting.one => 'Repetir: esta canción',
    };
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        _ModeButton(
          key: const Key('transport-shuffle'),
          tooltip: now.shuffle
              ? 'Aleatorio: activado'
              : 'Aleatorio: desactivado',
          active: now.shuffle,
          icon: Icons.shuffle_rounded,
          onPressed: hasTrack
              ? () => run(() => playback.setShuffle(!now.shuffle))
              : null,
        ),
        IconButton(
          key: const Key('transport-previous'),
          tooltip: 'Canción anterior',
          iconSize: 40,
          style: IconButton.styleFrom(minimumSize: const Size.square(56)),
          onPressed: hasTrack ? () => run(playback.playPrevious) : null,
          icon: const Icon(Icons.skip_previous_rounded),
        ),
        SizedBox.square(
          dimension: 72,
          child: IconButton(
            key: const Key('transport-play'),
            tooltip: now.playing ? 'Pausar' : 'Reproducir',
            iconSize: 40,
            style: IconButton.styleFrom(
              backgroundColor: palette.ink,
              foregroundColor: palette.black,
              disabledBackgroundColor: palette.inkMuted,
              disabledForegroundColor: palette.black,
              minimumSize: const Size.square(72),
              shape: const CircleBorder(),
            ),
            onPressed: hasTrack ? () => run(playback.togglePlayPause) : null,
            icon: Icon(
              now.playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
            ),
          ),
        ),
        IconButton(
          key: const Key('transport-next'),
          tooltip: 'Canción siguiente',
          iconSize: 40,
          style: IconButton.styleFrom(minimumSize: const Size.square(56)),
          onPressed: hasTrack ? () => run(playback.playNext) : null,
          icon: const Icon(Icons.skip_next_rounded),
        ),
        _ModeButton(
          key: const Key('transport-repeat'),
          tooltip: repeatLabel,
          active: now.repeat != LoopSetting.off,
          icon: now.repeat == LoopSetting.one
              ? Icons.repeat_one_rounded
              : Icons.repeat_rounded,
          onPressed: hasTrack
              ? () => run(() => playback.setRepeat(nextRepeatMode(now.repeat)))
              : null,
        ),
      ],
    );
  }
}

/// Botón de modo (aleatorio, repetir): verde con un punto debajo cuando está activo.
class _ModeButton extends StatelessWidget {
  const _ModeButton({
    super.key,
    required this.tooltip,
    required this.active,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final bool active;
  final IconData icon;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final palette = paletteOf(context);
    return Semantics(
      toggled: active,
      child: IconButton(
        tooltip: tooltip,
        isSelected: active,
        onPressed: onPressed,
        iconSize: 26,
        icon: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: active ? palette.accent : palette.ink),
            const SizedBox(height: 2),
            Container(
              width: 4,
              height: 4,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: active ? palette.accent : Colors.transparent,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
