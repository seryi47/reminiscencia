import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../duplicates.dart';
import '../local_audio.dart';
import '../services.dart';
import '../spotify_transfer.dart';
import '../theme.dart';
import '../youtube_importer.dart';
import 'common.dart';

// «Transferir música» en la APK (ADR-0044): conectar Spotify (OAuth en un WebView que intercepta la vuelta) → ELEGIR de
// tu biblioteca (playlists + «Me gusta», como TuneMyMusic) o pegar un enlace → revisar coincidencias → transferir por el
// pipeline de subida que ya existe. Comparte motor y endpoints con la web.

class TransferirButton extends StatelessWidget {
  const TransferirButton({super.key, required this.services});
  final AppServices services;

  @override
  Widget build(BuildContext context) {
    final palette = paletteOf(context);
    final theme = Theme.of(context);
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        key: const Key('transferir'),
        borderRadius: BorderRadius.circular(24),
        onTap: () => openTransferirSheet(context, services),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            gradient: LinearGradient(colors: [palette.accent.withValues(alpha: 0.2), palette.card], begin: Alignment.topLeft, end: Alignment.bottomRight),
            border: Border.all(color: palette.accent.withValues(alpha: 0.24)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 17),
          child: Row(children: [
            Container(width: 52, height: 52, decoration: BoxDecoration(color: palette.accent, borderRadius: BorderRadius.circular(18)), child: Icon(Icons.swap_horiz_rounded, color: palette.onAccent, size: 27)),
            const SizedBox(width: 16),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Transferir música', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text('Desde Spotify (playlists y favoritas)', style: theme.textTheme.bodySmall),
            ])),
            Icon(Icons.arrow_forward_rounded, color: palette.ink, size: 19),
          ]),
        ),
      ),
    );
  }
}

Future<void> openTransferirSheet(BuildContext context, AppServices services) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useRootNavigator: true,
    builder: (_) => _TransferirSheet(services: services),
  );
}

class _TransferirSheet extends StatefulWidget {
  const _TransferirSheet({required this.services});
  final AppServices services;
  @override
  State<_TransferirSheet> createState() => _TransferirSheetState();
}

enum _Stage { loading, connect, browse, working, review, done }

class _Collection {
  _Collection({required this.name, required this.album, required this.results});
  final String name;
  final TransferAlbum? album;
  final List<TransferMatch> results;
}

class _TransferirSheetState extends State<_TransferirSheet> {
  late final http.Client _client = http.Client();
  late final SpotifyTransfer _spotify = widget.services.spotify ?? SpotifyTransfer(client: _client);
  final TextEditingController _link = TextEditingController();
  final TextEditingController _search = TextEditingController();

  _Stage _stage = _Stage.loading;
  String _message = '';
  String _error = '';
  SpotifyLibrary? _library;
  final Set<String> _selected = {}; // 'liked' | 'pl:<id>' | 'url:<url>'
  List<_Collection> _collections = [];
  final Set<int> _manualOpen = {}; // índices de filas con el buscador manual de YouTube abierto (como la web, oculto por defecto)

  // Auto-reanudar: el tope del conversor (YouTube) es externo; en vez de reintentar a mano, la transferencia reintenta sola
  // solo lo que falta hasta completar. `_cancel` permite pararlo; el set persistente de vídeos ya hechos evita duplicados.
  YoutubeImportCancellation? _cancel;
  static const Duration _autoResumeGap = Duration(minutes: 10);
  static const int _autoResumeMaxCycles = 24;
  static const String _doneVideosKey = 'transferir.done.videos';

  @override
  void initState() {
    super.initState();
    _spotify.isConnected().then((connected) {
      if (!mounted) return;
      if (connected) {
        _loadLibrary();
      } else {
        setState(() => _stage = _Stage.connect);
      }
    });
  }

  @override
  void dispose() {
    _cancel?.cancel();
    _client.close();
    _link.dispose();
    _search.dispose();
    super.dispose();
  }

  Future<Set<String>> _loadDoneVideos() async {
    final prefs = await SharedPreferences.getInstance();
    return (prefs.getStringList(_doneVideosKey) ?? const <String>[]).toSet();
  }

  Future<void> _saveDoneVideos(Set<String> done) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_doneVideosKey, done.toList());
  }

  /// Espera `total` mostrando cuenta atrás; devuelve false si se cancela antes de terminar.
  Future<bool> _countdown(Duration total, int remaining) async {
    final end = DateTime.now().add(total);
    while (DateTime.now().isBefore(end)) {
      if (_cancel?.isCancelled ?? true) return false;
      final left = end.difference(DateTime.now());
      final m = left.inMinutes;
      final s = left.inSeconds % 60;
      if (mounted) {
        setState(() => _message =
            'Tope del conversor alcanzado. Reintento automático en $m:${s.toString().padLeft(2, '0')} — quedan ~$remaining canciones.');
      }
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    return !(_cancel?.isCancelled ?? true);
  }

  List<DuplicateCandidate> get _library0 => [
        for (final song in widget.services.library.catalogSongs)
          DuplicateCandidate(title: song.title, artist: song.artist, durationS: song.durationS),
      ];

  Future<void> _connect() async {
    try {
      final login = await _spotify.login();
      if (!mounted) return;
      final ok = await Navigator.of(context, rootNavigator: true).push<bool>(
        MaterialPageRoute(builder: (_) => _SpotifyLoginPage(spotify: _spotify, login: login)),
      );
      if (ok == true && mounted) { setState(() => _error = ''); _loadLibrary(); }
    } catch (error) {
      if (mounted) setState(() => _error = 'No se pudo iniciar sesión en Spotify: ${describeError(error)}');
    }
  }

  Future<void> _loadLibrary() async {
    setState(() { _stage = _Stage.loading; _error = ''; });
    try {
      final lib = await _spotify.mine();
      if (mounted) setState(() { _library = lib; _stage = _Stage.browse; });
    } on SpotifyNeedsAuth {
      if (mounted) setState(() { _stage = _Stage.connect; _error = 'Tu sesión de Spotify ha caducado. Conéctala de nuevo.'; });
    } catch (error) {
      if (mounted) setState(() { _stage = _Stage.connect; _error = 'No se pudo leer tu biblioteca: ${describeError(error)}'; });
    }
  }

  Future<void> _analyze({String? extraUrl}) async {
    final sources = <MapEntry<String, Map<String, dynamic>>>[];
    for (final key in _selected) {
      if (key == 'liked') {
        sources.add(MapEntry('Canciones favoritas', {'source': 'liked'}));
      } else if (key.startsWith('pl:')) {
        final id = key.substring(3);
        final name = _library?.playlists.firstWhere((p) => p.id == id, orElse: () => SpotifyPlaylistRef(id: id, name: id)).name ?? id;
        sources.add(MapEntry(name, {'ref': {'type': 'playlist', 'id': id}}));
      }
    }
    if (extraUrl != null && extraUrl.isNotEmpty) sources.add(MapEntry(extraUrl, {'url': extraUrl}));
    if (sources.isEmpty) { setState(() => _error = 'Elige al menos una playlist, «Me gusta» o pega un enlace.'); return; }

    setState(() { _stage = _Stage.working; _error = ''; _message = 'Analizando…'; });
    final collections = <_Collection>[];
    final done = await _loadDoneVideos(); // vídeos ya subidos (aunque aún no publicados): cuentan como «ya la tienes»
    try {
      for (final src in sources) {
        if (mounted) setState(() => _message = 'Analizando «${src.key}»…');
        final target = src.value;
        final res = target.containsKey('source')
            ? await _spotify.resolveSource(target['source'] as String, onPage: (l, t) { if (mounted) setState(() => _message = '«${src.key}»: $l${t > 0 ? ' de $t' : ''}…'); })
            : target.containsKey('ref')
                ? await _spotify.resolveRef((target['ref'] as Map).cast<String, dynamic>(), onPage: (l, t) { if (mounted) setState(() => _message = '«${src.key}»: $l${t > 0 ? ' de $t' : ''}…'); })
                : await _spotify.resolve(target['url'] as String, onPage: (l, t) { if (mounted) setState(() => _message = '«${src.key}»: $l${t > 0 ? ' de $t' : ''}…'); });
        markTransferDuplicates(res.results, _library0);
        for (final r in res.results) {
          // Además de lo publicado, lo recién subido (set `done`) también cuenta como «ya la tienes».
          if (!r.inLibrary && r.best != null) {
            final vid = YoutubeImporter.videoIdOf(r.best!.url);
            if (vid != null && done.contains(vid)) r.inLibrary = true;
          }
          // Incluida por defecto si hay coincidencia (alta o media, ya pre-elegida); baja sin candidato y duplicadas, fuera.
          r.excluded = r.inLibrary || r.best == null;
        }
        collections.add(_Collection(name: src.key, album: res.album, results: res.results));
      }
      if (mounted) setState(() { _collections = collections; _stage = _Stage.review; });
    } on SpotifyNeedsAuth {
      if (mounted) setState(() { _stage = _Stage.connect; _error = 'Tu sesión de Spotify ha caducado. Conéctala de nuevo.'; });
    } catch (error) {
      if (mounted) setState(() { _stage = _Stage.browse; _error = 'No se pudo analizar: ${describeError(error)}'; });
    }
  }

  /// Plan de transferencia: las elegidas de cada colección, sin repetir una misma canción (título+artista) entre listas
  /// ni dentro de la tanda.
  List<MapEntry<_Collection, List<YoutubeTrack>>> _buildPlan() {
    final seen = <String>{};
    final plan = <MapEntry<_Collection, List<YoutubeTrack>>>[];
    for (final c in _collections) {
      final tracks = <YoutubeTrack>[];
      for (final t in selectedTransferTracks(c.results, album: c.album)) {
        final key = '${normalizeDuplicateTitle(t.title)}|${normalizeDuplicateArtist(t.artist)}';
        if (seen.add(key)) tracks.add(t);
      }
      if (tracks.isNotEmpty) plan.add(MapEntry(c, tracks));
    }
    return plan;
  }

  int get _selectedCount => _buildPlan().fold(0, (n, e) => n + e.value.length);

  Future<void> _transfer() async {
    final plan = _buildPlan();
    final totalTracks = plan.fold(0, (n, e) => n + e.value.length);
    if (totalTracks == 0) { setState(() => _error = 'Elige al menos una canción.'); return; }
    final importer = widget.services.youtube;
    if (importer == null) { setState(() => _error = 'La conexión con YouTube no está disponible.'); return; }
    final cancel = YoutubeImportCancellation();
    _cancel = cancel;
    setState(() { _stage = _Stage.working; _error = ''; _message = 'Preparando $totalTracks canciones…'; });
    final done = await _loadDoneVideos(); // vídeos ya importados (anti-duplicados entre ciclos/arranques)
    var addedTotal = 0;
    var lastFailed = 0;
    List<YoutubeImportedAudio>? lastImported;
    try {
      var cycle = 0;
      while (!cancel.isCancelled) {
        cycle += 1;
        var failedCycle = 0;
        var base = 0;
        for (final entry in plan) {
          if (cancel.isCancelled) break;
          final tracks = entry.value;
          // Atacables este ciclo: las que no están ya hechas.
          final pending = tracks.where((t) {
            final v = YoutubeImporter.videoIdOf(t.url);
            return v == null || !done.contains(v);
          }).toList();
          if (pending.isEmpty) { base += tracks.length; continue; }
          final imported = await importer.importTracks(pending, cancellation: cancel, skipVideoIds: done, onProgress: (p) {
            final prefix = cycle > 1 ? 'Reintento $cycle' : 'Descargando';
            if (mounted) setState(() => _message = '$prefix: ${base + p.index + 1} de $totalTracks…');
          });
          lastImported = imported;
          await widget.services.library.uploadShared([
            for (final audio in imported)
              PickedAudioFile(name: audio.name, path: audio.path, artist: audio.track.artist, youtubePlaylistId: audio.track.playlistId, youtubePlaylistName: audio.track.playlistTitle),
          ]);
          await importer.cleanup(imported);
          lastImported = null;
          for (final audio in imported) {
            final v = YoutubeImporter.videoIdOf(audio.track.url);
            if (v != null) done.add(v);
          }
          await _saveDoneVideos(done);
          addedTotal += imported.length;
          failedCycle += pending.length - imported.length;
          base += tracks.length;
        }
        lastFailed = failedCycle;
        if (cancel.isCancelled) break;
        if (failedCycle == 0) break; // completado: ya no falla nada
        if (cycle >= _autoResumeMaxCycles) break;
        if (!await _countdown(_autoResumeGap, failedCycle)) break; // parado durante la espera
      }
      final complete = lastFailed == 0 && !cancel.isCancelled;
      if (mounted) {
        setState(() {
          _stage = _Stage.done;
          _message = complete
              ? '¡Listo! $addedTotal canciones añadidas. Se publicarán en un momento.'
              : '$addedTotal añadidas${lastFailed > 0 ? ' · quedan ~$lastFailed' : ''}. '
                  '${cancel.isCancelled ? 'Reintento detenido.' : 'Se alcanzó el límite de reintentos; prueba más tarde.'}';
        });
      }
    } on SpotifyNeedsAuth {
      if (mounted) setState(() { _stage = _Stage.connect; _error = 'Tu sesión de Spotify ha caducado.'; });
    } catch (error) {
      if (mounted) setState(() { _stage = _Stage.review; _error = 'No se pudo completar: ${describeError(error)}'; });
    } finally {
      if (lastImported != null) await importer.cleanup(lastImported);
      if (identical(_cancel, cancel)) _cancel = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(left: 20, right: 20, top: 8, bottom: MediaQuery.of(context).viewInsets.bottom + 20),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.85),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Transferir música', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(_error, key: const Key('transferir-error'), style: TextStyle(color: theme.colorScheme.error))),
          Flexible(child: _body(theme)),
        ]),
      ),
    );
  }

  Widget _body(ThemeData theme) {
    switch (_stage) {
      case _Stage.loading:
        return Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(_message.isEmpty ? 'Cargando…' : _message, key: const Key('transferir-progress'), textAlign: TextAlign.center),
        ])));
      case _Stage.working:
        return Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(_message.isEmpty ? 'Cargando…' : _message, key: const Key('transferir-progress'), textAlign: TextAlign.center),
          if (_cancel != null) ...[
            const SizedBox(height: 12),
            TextButton(key: const Key('transferir-stop'), onPressed: () => _cancel?.cancel(), child: const Text('Parar')),
          ],
        ])));
      case _Stage.connect:
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Text('Conecta tu cuenta de Spotify para elegir tus playlists y tus canciones favoritas.', style: theme.textTheme.bodyMedium),
          const SizedBox(height: 16),
          FilledButton.icon(key: const Key('transferir-connect'), onPressed: _connect, icon: const Icon(Icons.link_rounded), label: const Text('Conectar con Spotify')),
        ]);
      case _Stage.browse:
        return _browseBody(theme);
      case _Stage.review:
        return _reviewBody(theme);
      case _Stage.done:
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Text(_message, key: const Key('transferir-done'), style: theme.textTheme.bodyLarge),
          const SizedBox(height: 8),
          Text('Verás el progreso de publicación en «Tu biblioteca».', style: theme.textTheme.bodySmall),
          const SizedBox(height: 16),
          FilledButton(onPressed: () { setState(() { _selected.clear(); _collections = []; _stage = _Stage.browse; }); }, child: const Text('Transferir más')),
        ]);
    }
  }

  Widget _browseBody(ThemeData theme) {
    final lib = _library;
    if (lib == null) return const Center(child: CircularProgressIndicator());
    final query = _search.text.trim().toLowerCase();
    final playlists = lib.playlists.where((p) => query.isEmpty || p.name.toLowerCase().contains(query)).toList();
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Elige qué traer. Las playlists mantienen su nombre y su orden. (En modo desarrollo, Spotify solo da el contenido de tus propias listas.)', style: theme.textTheme.bodySmall),
      const SizedBox(height: 8),
      Flexible(child: ListView(shrinkWrap: true, children: [
        if (lib.liked > 0)
          CheckboxListTile(
            key: const Key('transferir-source-liked'),
            value: _selected.contains('liked'),
            onChanged: (v) => setState(() => v == true ? _selected.add('liked') : _selected.remove('liked')),
            title: const Text('Canciones favoritas'),
            subtitle: Text('${lib.liked} canciones'),
            secondary: const Icon(Icons.favorite_rounded),
          ),
        Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 4), child: Text('Tus playlists (${lib.playlists.length})', style: theme.textTheme.labelLarge)),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: TextField(controller: _search, decoration: const InputDecoration(isDense: true, prefixIcon: Icon(Icons.search), hintText: 'Buscar playlists'), onChanged: (_) => setState(() {}))),
        for (final p in playlists)
          CheckboxListTile(
            key: Key('transferir-source-pl-${p.id}'),
            value: _selected.contains('pl:${p.id}'),
            onChanged: (v) => setState(() => v == true ? _selected.add('pl:${p.id}') : _selected.remove('pl:${p.id}')),
            title: Text(p.name, maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: Text('${p.total} canciones'),
          ),
      ])),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(child: TextField(controller: _link, keyboardType: TextInputType.url, decoration: const InputDecoration(isDense: true, hintText: 'o pega un enlace (álbum/canción)'))),
        TextButton(onPressed: () { final u = _link.text.trim(); if (u.isNotEmpty) { _analyze(extraUrl: u); _link.clear(); } }, child: const Text('Analizar')),
      ]),
      const SizedBox(height: 8),
      FilledButton.icon(key: const Key('transferir-analyze'), onPressed: _selected.isEmpty ? null : () => _analyze(), icon: const Icon(Icons.search_rounded), label: Text('Analizar ${_selected.length} selección${_selected.length == 1 ? '' : 'es'}')),
      TextButton(onPressed: () async { await _spotify.disconnect(); if (mounted) setState(() { _library = null; _selected.clear(); _stage = _Stage.connect; }); }, child: const Text('Desconectar')),
    ]);
  }

  Widget _reviewBody(ThemeData theme) {
    final nonEmpty = _collections.where((c) => c.results.isNotEmpty).toList();
    if (nonEmpty.isEmpty) {
      return Column(mainAxisSize: MainAxisSize.min, children: [
        Text('No hay canciones accesibles en lo que elegiste. En modo desarrollo, Spotify solo da el contenido de tus propias listas; prueba con otra lista tuya, un álbum o una canción.', style: theme.textTheme.bodyMedium),
        const SizedBox(height: 16),
        FilledButton(onPressed: () => setState(() => _stage = _Stage.browse), child: const Text('Volver')),
      ]);
    }
    // Compara cada lista/álbum con TU biblioteca (inLibrary ya marcado) y resume qué es nuevo y qué ya tienes.
    final palette = paletteOf(context);
    final children = <Widget>[];
    var anyReview = false;
    var totalNew = 0;
    var totalHave = 0;
    for (final c in nonEmpty) {
      final dupes = c.results.where((r) => r.inLibrary).length;
      final review = c.results.where((r) => !r.inLibrary && r.tier != 'alta').toList();
      final sure = c.results.length - dupes - review.length;
      final nuevas = sure + review.length;
      totalNew += nuevas;
      totalHave += dupes;
      final done = nuevas == 0;
      final counts = done
          ? '✓ Ya la tienes entera ($dupes ${dupes == 1 ? 'canción' : 'canciones'})'
          : [if (sure > 0) '$sure se añaden solas', if (review.isNotEmpty) '${review.length} a revisar', if (dupes > 0) '$dupes ya las tienes'].join(' · ');
      children.add(Padding(
        padding: const EdgeInsets.fromLTRB(4, 12, 4, 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(c.name, style: theme.textTheme.labelLarge),
          Text(counts, style: theme.textTheme.bodySmall?.copyWith(color: done ? palette.accent : null, fontWeight: done ? FontWeight.w600 : null)),
        ]),
      ));
      for (final r in review) { anyReview = true; children.add(_row(r, theme)); }
    }

    // Ya lo tienes todo: nada nuevo que importar.
    if (totalNew == 0) {
      return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Ya tienes en tu biblioteca todas las canciones de lo que elegiste ($totalHave). No hay nada nuevo que importar.',
            key: const Key('transferir-nada-nuevo'), style: theme.textTheme.bodyMedium),
        const SizedBox(height: 8),
        Flexible(child: ListView(shrinkWrap: true, children: children)),
        const SizedBox(height: 12),
        FilledButton(onPressed: () => setState(() => _stage = _Stage.browse), child: const Text('Elegir otra cosa')),
      ]);
    }

    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Comparado con tu biblioteca: $totalNew ${totalNew == 1 ? 'canción nueva' : 'canciones nuevas'}${totalHave > 0 ? ', $totalHave ya las tienes' : ''}. '
          '${anyReview ? 'Abajo solo lo que conviene revisar (ya hay una versión elegida).' : 'Todo identificado automáticamente. Dale a «Transferir».'}',
          style: theme.textTheme.bodySmall),
      const SizedBox(height: 8),
      Flexible(child: ListView(shrinkWrap: true, children: children)),
      const SizedBox(height: 12),
      FilledButton.icon(key: const Key('transferir-go'), onPressed: _transfer, icon: const Icon(Icons.download_rounded), label: Text('Transferir $_selectedCount canciones')),
      TextButton(onPressed: () => setState(() => _stage = _Stage.browse), child: const Text('Elegir otra cosa')),
    ]);
  }

  Widget _row(TransferMatch result, ThemeData theme) {
    final dupe = result.inLibrary;
    final chosen = result.chosen;
    final options = _options(result);
    final needsChoice = result.tier != 'alta' || options.length > 1 || chosen == null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Checkbox(
            key: Key('transferir-include-${result.index}'),
            value: !result.excluded && !dupe,
            onChanged: dupe ? null : (v) => setState(() => result.excluded = !(v ?? false)),
          ),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(result.track.title, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis),
            Text('${result.track.artist} · ${_fmt(result.track.durationS)}', style: theme.textTheme.bodySmall),
          ])),
          _tierChip(result, dupe, theme),
        ]),
        if (!dupe && needsChoice) Padding(
          padding: const EdgeInsets.only(left: 48, top: 4),
          child: DropdownButton<String>(
            key: Key('transferir-alt-${result.index}'),
            isExpanded: true,
            value: chosen?.url,
            hint: const Text('Elige una versión'),
            items: [for (final c in options) DropdownMenuItem(value: c.url, child: Text('${c.title} · ${_fmt(c.durationS)} · ${_sourceLabel(c.source)}', overflow: TextOverflow.ellipsis))],
            onChanged: (url) => setState(() { result.override = options.firstWhere((c) => c.url == url); result.excluded = false; }),
          ),
        ),
        if (!dupe && needsChoice) Padding(
          padding: const EdgeInsets.only(left: 40),
          child: Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              key: Key('transferir-manual-toggle-${result.index}'),
              style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), visualDensity: VisualDensity.compact),
              onPressed: () => setState(() => _manualOpen.contains(result.index) ? _manualOpen.remove(result.index) : _manualOpen.add(result.index)),
              child: Text(_manualOpen.contains(result.index) ? 'Ocultar búsqueda' : 'Buscar otra en YouTube', style: theme.textTheme.labelMedium),
            ),
          ),
        ),
        if (!dupe && needsChoice && _manualOpen.contains(result.index)) Padding(
          padding: const EdgeInsets.only(left: 48),
          child: _ManualSearch(spotify: _spotify, onPicked: (candidate) => setState(() { result.alternatives = [candidate, ...result.alternatives]; result.override = candidate; result.excluded = false; })),
        ),
      ]),
    );
  }

  List<TransferCandidate> _options(TransferMatch result) {
    final seen = <String>{};
    final out = <TransferCandidate>[];
    for (final c in [if (result.best != null) result.best!, ...result.alternatives]) {
      if (c.url.isEmpty || !seen.add(c.url)) continue;
      out.add(c);
    }
    return out;
  }

  Widget _tierChip(TransferMatch result, bool dupe, ThemeData theme) {
    final label = dupe ? 'Ya en tu biblioteca' : switch (result.tier) { 'alta' => 'Segura', 'media' => 'Revisar', _ => 'Elige' };
    final palette = paletteOf(context);
    final color = dupe ? theme.disabledColor : (result.tier == 'alta' ? palette.accent : theme.colorScheme.secondary);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(10)),
      child: Text(label, style: theme.textTheme.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w600)),
    );
  }
}

String _fmt(double? seconds) {
  if (seconds == null || !seconds.isFinite) return '';
  final m = seconds ~/ 60;
  final s = (seconds % 60).round().toString().padLeft(2, '0');
  return '$m:$s';
}

String _sourceLabel(String source) => switch (source) { 'topic' => 'Oficial', 'official' => 'Canal oficial', _ => 'YouTube' };

/// Buscador manual de YouTube para una pista sin buena coincidencia.
class _ManualSearch extends StatefulWidget {
  const _ManualSearch({required this.spotify, required this.onPicked});
  final SpotifyTransfer spotify;
  final void Function(TransferCandidate) onPicked;
  @override
  State<_ManualSearch> createState() => _ManualSearchState();
}

class _ManualSearchState extends State<_ManualSearch> {
  final TextEditingController _query = TextEditingController();
  bool _busy = false;

  @override
  void dispose() { _query.dispose(); super.dispose(); }

  Future<void> _run() async {
    final q = _query.text.trim();
    if (q.isEmpty) return;
    setState(() => _busy = true);
    try {
      final results = await widget.spotify.searchYoutube(q);
      if (!mounted) return;
      if (results.isEmpty) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Sin resultados en YouTube.'))); return; }
      final picked = await showModalBottomSheet<TransferCandidate>(
        context: context,
        builder: (_) => ListView(children: [
          for (final c in results) ListTile(title: Text(c.title, maxLines: 2, overflow: TextOverflow.ellipsis), subtitle: Text('${_fmt(c.durationS)} · ${_sourceLabel(c.source)}'), onTap: () => Navigator.of(context).pop(c)),
        ]),
      );
      if (picked != null) widget.onPicked(picked);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No se pudo buscar en YouTube.')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Expanded(child: TextField(controller: _query, decoration: const InputDecoration(isDense: true, hintText: 'Buscar en YouTube…'), onSubmitted: (_) => _run())),
      TextButton(onPressed: _busy ? null : _run, child: const Text('Buscar')),
    ]);
  }
}

/// Login de Spotify en un WebView: intercepta la vuelta al callback (https) y cambia el código por el token, sin salir de
/// la app ni necesitar un esquema propio.
class _SpotifyLoginPage extends StatefulWidget {
  const _SpotifyLoginPage({required this.spotify, required this.login});
  final SpotifyTransfer spotify;
  final SpotifyLogin login;
  @override
  State<_SpotifyLoginPage> createState() => _SpotifyLoginPageState();
}

class _SpotifyLoginPageState extends State<_SpotifyLoginPage> {
  late final WebViewController _controller;
  bool _handling = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(onNavigationRequest: _onNavigation))
      ..loadRequest(Uri.parse(widget.login.url));
  }

  Future<NavigationDecision> _onNavigation(NavigationRequest request) async {
    final uri = Uri.tryParse(request.url);
    final isCallback = uri != null && (uri.path == '/api/spotify/callback' || request.url.startsWith('reminiscencia://'));
    if (!isCallback || _handling) return NavigationDecision.navigate;
    _handling = true;
    final code = uri.queryParameters['code'];
    final state = uri.queryParameters['state'];
    final error = uri.queryParameters['error'];
    if (error != null || code == null || code.isEmpty) {
      if (mounted) setState(() { _error = 'Spotify no autorizó la conexión.'; });
      _handling = false;
      return NavigationDecision.prevent;
    }
    if (state != widget.login.state) {
      if (mounted) setState(() { _error = 'La respuesta de Spotify no coincide (seguridad).'; });
      _handling = false;
      return NavigationDecision.prevent;
    }
    try {
      await widget.spotify.completeLogin(code: code, verifier: widget.login.verifier);
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) setState(() { _error = 'No se pudo completar el inicio de sesión.'; _handling = false; });
    }
    return NavigationDecision.prevent;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Conectar con Spotify')),
      body: _error != null
          ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)))
          : WebViewWidget(controller: _controller),
    );
  }
}
