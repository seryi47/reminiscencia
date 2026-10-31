import 'package:audio_service/audio_service.dart';
import 'package:flutter/material.dart';

import 'library_store.dart';
import 'song.dart';
import 'sonidos_audio_handler.dart';

late final SonidosAudioHandler audioHandler;
final LibraryStore libraryStore = LibraryStore();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  audioHandler = await AudioService.init(
    builder: () => SonidosAudioHandler(libraryStore),
    config: const AudioServiceConfig(
      androidNotificationChannelId: 'es.orbitalabs.reminiscencia.audio',
      androidNotificationChannelName: 'Reproducción',
      androidNotificationOngoing: true,
    ),
  );
  runApp(const ReminiscenciaApp());
}

const _accent = Color(0xFFE0B26A);

class ReminiscenciaApp extends StatelessWidget {
  const ReminiscenciaApp({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(seedColor: _accent, brightness: Brightness.dark).copyWith(
      surface: const Color(0xFF0E0F12),
      surfaceContainerHighest: const Color(0xFF1B1E26),
      surfaceContainerHigh: const Color(0xFF14161C),
    );
    return MaterialApp(
      title: 'Reminiscencia',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: scheme,
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF0E0F12),
        visualDensity: VisualDensity.compact,
        appBarTheme: const AppBarTheme(backgroundColor: Color(0xFF0E0F12), elevation: 0, scrolledUnderElevation: 0),
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
  List<Folder> _folders = const [];
  String? _folder; // null = todas
  String _status = 'Cargando…';
  bool _online = false;
  bool _busy = false;
  String _progress = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _status = 'Cargando la biblioteca…');
    LibraryData data;
    try {
      data = await libraryStore.load();
    } catch (error) {
      debugPrint('biblioteca: no se pudo leer el catálogo: $error');
      if (!mounted) return;
      setState(() => _status = 'No se pudo cargar la biblioteca. Revisa la conexión.');
      return;
    }
    if (!mounted) return;
    setState(() {
      _songs = data.songs;
      _folders = data.folders;
      _online = data.fromNetwork;
      _status = data.fromNetwork
          ? '${data.songs.length} canciones · en línea'
          : '${data.songs.length} canciones · sin conexión (copia guardada)';
    });
    try {
      await audioHandler.loadSongs(data.songs);
    } catch (error) {
      debugPrint('biblioteca: no se pudo preparar el audio: $error');
      if (mounted) setState(() => _status = '${data.songs.length} canciones · el audio no está disponible ahora');
    }
  }

  Future<void> _downloadForOffline() async {
    setState(() {
      _busy = true;
      _progress = 'Preparando…';
    });
    try {
      final done = await libraryStore.downloadAll(_songs, (n, total) {
        if (mounted) setState(() => _progress = '$n de $total');
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(done == 0 ? 'Ya estaba todo guardado.' : 'Guardadas $done canciones para escuchar sin conexión.'),
      ));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error al descargar: $error')));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _progress = '';
        });
      }
    }
  }

  List<Song> get _visible => _folder == null
      ? _songs
      : _folder == 'none'
          ? _songs.where((s) => s.folderId == null).toList()
          : _songs.where((s) => s.folderId == _folder).toList();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final visible = _visible;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Reminiscencia', style: TextStyle(fontWeight: FontWeight.w700)),
        actions: [
          if (_busy)
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Center(child: Text(_progress, style: theme.textTheme.labelMedium)),
            )
          else
            IconButton(
              tooltip: 'Guardar para escuchar sin conexión',
              icon: const Icon(Icons.download_for_offline_outlined),
              onPressed: _songs.isEmpty ? null : _downloadForOffline,
            ),
          IconButton(tooltip: 'Actualizar', icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Row(
                children: [
                  Container(
                    width: 7,
                    height: 7,
                    decoration: BoxDecoration(
                      color: _online ? const Color(0xFF86D3A2) : theme.colorScheme.outline,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(child: Text(_status, style: theme.textTheme.bodySmall, overflow: TextOverflow.ellipsis)),
                ],
              ),
            ),
            if (_folders.isNotEmpty || _songs.isNotEmpty)
              SizedBox(
                height: 40,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: [
                    _chip('Todas', null),
                    _chip('Sin carpeta', 'none'),
                    for (final f in _folders.where((f) => f.parentId == null)) _chip(f.name, f.id),
                  ],
                ),
              ),
            const SizedBox(height: 4),
            Expanded(
              child: visible.isEmpty
                  ? Center(child: Text(_songs.isEmpty ? 'Sin canciones todavía.' : 'No hay canciones en esta carpeta.'))
                  : ListView.builder(
                      padding: const EdgeInsets.only(bottom: 8),
                      itemCount: visible.length,
                      itemBuilder: (context, i) => _SongRow(
                        song: visible[i],
                        index: i + 1,
                        onTap: () => audioHandler.skipToQueueItem(_songs.indexOf(visible[i])),
                      ),
                    ),
            ),
            _NowPlayingBar(),
          ],
        ),
      ),
    );
  }

  Widget _chip(String label, String? key) {
    final selected = _folder == key;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => setState(() => _folder = key),
        visualDensity: VisualDensity.compact,
      ),
    );
  }
}

class _SongRow extends StatelessWidget {
  const _SongRow({required this.song, required this.index, required this.onTap});

  final Song song;
  final int index;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return StreamBuilder<MediaItem?>(
      stream: audioHandler.mediaItem,
      builder: (context, snapshot) {
        final playing = snapshot.data?.id == song.id;
        return ListTile(
          dense: true,
          onTap: onTap,
          leading: SizedBox(
            width: 28,
            child: Text('$index', textAlign: TextAlign.center, style: theme.textTheme.bodySmall),
          ),
          title: Text(
            song.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontWeight: FontWeight.w600, color: playing ? theme.colorScheme.primary : null),
          ),
          subtitle: Text(
            [if (song.artist.isNotEmpty) song.artist, if (song.year != null) '${song.year}'].join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          trailing: Text(_fmt(song.durationS), style: theme.textTheme.bodySmall),
        );
      },
    );
  }
}

class _NowPlayingBar extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return StreamBuilder<MediaItem?>(
      stream: audioHandler.mediaItem,
      builder: (context, itemSnap) {
        return StreamBuilder<PlaybackState>(
          stream: audioHandler.playbackState,
          builder: (context, stateSnap) {
            final item = itemSnap.data;
            final playing = stateSnap.data?.playing ?? false;
            return Container(
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHigh,
                border: Border(top: BorderSide(color: theme.colorScheme.outlineVariant)),
              ),
              padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(item?.title ?? 'Elige una canción', maxLines: 1, overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.titleSmall),
                        Text(item?.artist ?? ' ', maxLines: 1, overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ),
                  IconButton(icon: const Icon(Icons.skip_previous), onPressed: audioHandler.skipToPrevious),
                  IconButton.filled(
                    icon: Icon(playing ? Icons.pause : Icons.play_arrow),
                    onPressed: playing ? audioHandler.pause : audioHandler.play,
                  ),
                  IconButton(icon: const Icon(Icons.skip_next), onPressed: audioHandler.skipToNext),
                ],
              ),
            );
          },
        );
      },
    );
  }
}

String _fmt(double seconds) {
  final total = seconds.round();
  return '${total ~/ 60}:${(total % 60).toString().padLeft(2, '0')}';
}
