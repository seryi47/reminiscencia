import 'dart:convert';

import 'package:audio_service/audio_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'song.dart';
import 'sonidos_audio_handler.dart';

late final SonidosAudioHandler audioHandler;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  audioHandler = await AudioService.init(
    builder: SonidosAudioHandler.new,
    config: const AudioServiceConfig(
      androidNotificationChannelId: 'es.orbitalabs.reminiscencia.audio',
      androidNotificationChannelName: 'Reproducción',
      androidNotificationOngoing: true,
    ),
  );
  runApp(const SonidosApp());
}

class SonidosApp extends StatelessWidget {
  const SonidosApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Reminiscencia',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF7A3E12)),
        useMaterial3: true,
      ),
      home: const LibraryPage(),
    );
  }
}

class LibraryPage extends StatefulWidget {
  const LibraryPage({super.key});

  @override
  State<LibraryPage> createState() => _LibraryPageState();
}

class _LibraryPageState extends State<LibraryPage> {
  List<Song> _songs = const [];
  String _status = 'Cargando la biblioteca…';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final raw = await rootBundle.loadString('assets/data/songs.json');
      final songs = (jsonDecode(raw) as List)
          .map((item) => Song.fromJson(item as Map<String, dynamic>))
          .toList();
      await audioHandler.loadSongs(songs);
      setState(() {
        _songs = songs;
        _status = songs.isEmpty
            ? 'La biblioteca está vacía.'
            : '${songs.length} canciones disponibles.';
      });
    } catch (error) {
      setState(() => _status = 'No se pudo cargar la biblioteca.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reminiscencia')),
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.all(16),
              sliver: SliverToBoxAdapter(
                child: Text(_status, style: Theme.of(context).textTheme.bodyLarge),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              sliver: SliverToBoxAdapter(child: _PlayerCard(songs: _songs)),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
              sliver: SliverToBoxAdapter(
                child: Text('Biblioteca', style: Theme.of(context).textTheme.titleLarge),
              ),
            ),
            SliverList.builder(
              itemCount: _songs.length,
              itemBuilder: (context, index) => Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: _SongTile(index: index, song: _songs[index]),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
          ],
        ),
      ),
    );
  }
}

class _PlayerCard extends StatelessWidget {
  const _PlayerCard({required this.songs});

  final List<Song> songs;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<MediaItem?>(
      stream: audioHandler.mediaItem,
      builder: (context, itemSnapshot) {
        final item = itemSnapshot.data;
        return StreamBuilder<PlaybackState>(
          stream: audioHandler.playbackState,
          builder: (context, stateSnapshot) {
            final playing = stateSnapshot.data?.playing ?? false;
            final index = item == null
                ? -1
                : songs.indexWhere((song) => song.assetPath == item.id);
            final theme = Theme.of(context);
            return Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    Text(
                      index < 0 ? 'Elige una canción' : 'Canción ${index + 1} de ${songs.length}',
                      style: theme.textTheme.labelLarge,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      item?.title ?? ' ',
                      style: theme.textTheme.headlineSmall,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 20),
                    Row(
                      children: [
                        Expanded(
                          child: _ControlButton(
                            label: 'Anterior',
                            icon: Icons.skip_previous,
                            semantics: 'Canción anterior',
                            onPressed: () => audioHandler.skipToPrevious(),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          flex: 2,
                          child: _ControlButton(
                            label: playing ? 'Pausar' : 'Reproducir',
                            icon: playing ? Icons.pause : Icons.play_arrow,
                            semantics: playing ? 'Pausar' : 'Reproducir',
                            primary: true,
                            onPressed: () => playing ? audioHandler.pause() : audioHandler.play(),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _ControlButton(
                            label: 'Siguiente',
                            icon: Icons.skip_next,
                            semantics: 'Canción siguiente',
                            onPressed: () => audioHandler.skipToNext(),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
}

class _ControlButton extends StatelessWidget {
  const _ControlButton({
    required this.label,
    required this.icon,
    required this.semantics,
    required this.onPressed,
    this.primary = false,
  });

  final String label;
  final IconData icon;
  final String semantics;
  final VoidCallback onPressed;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    const padding = EdgeInsets.symmetric(horizontal: 4, vertical: 8);
    final style = primary
        ? FilledButton.styleFrom(minimumSize: const Size.fromHeight(76), padding: padding)
        : OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(76), padding: padding);
    final child = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 32),
        const SizedBox(height: 4),
        FittedBox(fit: BoxFit.scaleDown, child: Text(label, maxLines: 1)),
      ],
    );
    return Semantics(
      label: semantics,
      button: true,
      child: primary
          ? FilledButton(style: style, onPressed: onPressed, child: child)
          : OutlinedButton(style: style, onPressed: onPressed, child: child),
    );
  }
}

class _SongTile extends StatelessWidget {
  const _SongTile({required this.index, required this.song});

  final int index;
  final Song song;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<MediaItem?>(
      stream: audioHandler.mediaItem,
      builder: (context, snapshot) {
        final selected = snapshot.data?.id == song.assetPath;
        return Card(
          color: selected ? Theme.of(context).colorScheme.primaryContainer : null,
          child: ListTile(
            minVerticalPadding: 16,
            title: Text(song.title, style: Theme.of(context).textTheme.titleMedium),
            trailing: Text(_formatDuration(song.durationS)),
            onTap: () => audioHandler.skipToQueueItem(index),
          ),
        );
      },
    );
  }
}

String _formatDuration(double seconds) {
  final total = seconds.round();
  final minutes = total ~/ 60;
  final rest = (total % 60).toString().padLeft(2, '0');
  return '$minutes:$rest';
}
