import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:webview_flutter/webview_flutter.dart';

import '../duplicates.dart';
import '../local_audio.dart';
import '../services.dart';
import '../spotify_transfer.dart';
import '../theme.dart';
import '../youtube_importer.dart';
import 'common.dart';

// «Transferir música» en la APK (ADR-0044): conectar Spotify (OAuth en un WebView que intercepta la vuelta) → pegar un
// enlace → analizar → revisar coincidencias → transferir por el pipeline de subida que ya existe. Comparte motor y
// endpoints con la web.

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
            gradient: LinearGradient(
              colors: [palette.accent.withValues(alpha: 0.2), palette.card],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            border: Border.all(color: palette.accent.withValues(alpha: 0.24)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 17),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(color: palette.accent, borderRadius: BorderRadius.circular(18)),
                child: Icon(Icons.swap_horiz_rounded, color: palette.onAccent, size: 27),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Transferir música', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Text('Desde Spotify (canciones, álbumes y playlists)', style: theme.textTheme.bodySmall),
                  ],
                ),
              ),
              Icon(Icons.arrow_forward_rounded, color: palette.ink, size: 19),
            ],
          ),
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

enum _Stage { loading, connect, input, analyzing, review, transferring, done }

class _TransferirSheetState extends State<_TransferirSheet> {
  late final http.Client _client = http.Client();
  late final SpotifyTransfer _spotify = widget.services.spotify ?? SpotifyTransfer(client: _client);
  final TextEditingController _link = TextEditingController();

  _Stage _stage = _Stage.loading;
  String _message = '';
  String _error = '';
  TransferResolution? _resolution;

  @override
  void initState() {
    super.initState();
    _spotify.isConnected().then((connected) {
      if (mounted) setState(() => _stage = connected ? _Stage.input : _Stage.connect);
    });
  }

  @override
  void dispose() {
    _client.close();
    _link.dispose();
    super.dispose();
  }

  List<DuplicateCandidate> get _library => [
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
      if (ok == true && mounted) setState(() { _stage = _Stage.input; _error = ''; });
    } catch (error) {
      if (mounted) setState(() => _error = 'No se pudo iniciar sesión en Spotify: ${describeError(error)}');
    }
  }

  Future<void> _analyze() async {
    final url = _link.text.trim();
    if (url.isEmpty) { setState(() => _error = 'Pega un enlace de Spotify.'); return; }
    setState(() { _stage = _Stage.analyzing; _error = ''; _message = 'Analizando…'; });
    try {
      final resolution = await _spotify.resolve(url, onPage: (loaded, total) {
        if (mounted) setState(() => _message = 'Analizando $loaded${total > 0 ? ' de $total' : ''} canciones…');
      });
      markTransferDuplicates(resolution.results, _library);
      for (final r in resolution.results) {
        r.excluded = r.inLibrary || (r.tier != 'alta');
      }
      if (mounted) setState(() { _resolution = resolution; _stage = _Stage.review; });
    } on SpotifyNeedsAuth {
      if (mounted) setState(() { _stage = _Stage.connect; _error = 'Tu sesión de Spotify ha caducado. Conéctala de nuevo.'; });
    } catch (error) {
      if (mounted) setState(() { _stage = _Stage.input; _error = 'No se pudo analizar: ${describeError(error)}'; });
    }
  }

  int get _selectedCount => _resolution == null ? 0 : selectedTransferTracks(_resolution!.results, album: _resolution!.album).length;

  Future<void> _transfer() async {
    final resolution = _resolution;
    if (resolution == null) return;
    final tracks = selectedTransferTracks(resolution.results, album: resolution.album);
    if (tracks.isEmpty) { setState(() => _error = 'Elige al menos una canción.'); return; }
    final importer = widget.services.youtube;
    if (importer == null) { setState(() => _error = 'La conexión con YouTube no está disponible.'); return; }
    setState(() { _stage = _Stage.transferring; _error = ''; _message = 'Preparando ${tracks.length} canciones…'; });
    List<YoutubeImportedAudio>? imported;
    try {
      imported = await importer.importTracks(tracks, onProgress: (p) {
        if (mounted) setState(() => _message = 'Descargando ${p.index + 1} de ${p.total}: ${p.title}…');
      });
      await widget.services.library.uploadShared([
        for (final audio in imported)
          PickedAudioFile(
            name: audio.name,
            path: audio.path,
            artist: audio.track.artist,
            youtubePlaylistId: audio.track.playlistId,
            youtubePlaylistName: audio.track.playlistTitle,
          ),
      ]);
      if (mounted) setState(() { _stage = _Stage.done; _message = '${tracks.length} canciones añadidas. Se publicarán en un momento.'; });
    } on SpotifyNeedsAuth {
      if (mounted) setState(() { _stage = _Stage.connect; _error = 'Tu sesión de Spotify ha caducado.'; });
    } catch (error) {
      if (mounted) setState(() { _stage = _Stage.review; _error = 'No se pudo completar: ${describeError(error)}'; });
    } finally {
      if (imported != null) await importer.cleanup(imported);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(
        left: 20, right: 20, top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.85),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Transferir música', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            if (_error.isNotEmpty) Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(_error, key: const Key('transferir-error'), style: TextStyle(color: theme.colorScheme.error)),
            ),
            Flexible(child: _body(theme)),
          ],
        ),
      ),
    );
  }

  Widget _body(ThemeData theme) {
    switch (_stage) {
      case _Stage.loading:
        return const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()));
      case _Stage.connect:
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Text('Conecta tu cuenta de Spotify para traer tus canciones, álbumes y playlists. Se identifican en YouTube y se añaden a tu biblioteca.',
              style: theme.textTheme.bodyMedium),
          const SizedBox(height: 16),
          FilledButton.icon(
            key: const Key('transferir-connect'),
            onPressed: _connect,
            icon: const Icon(Icons.link_rounded),
            label: const Text('Conectar con Spotify'),
          ),
        ]);
      case _Stage.input:
        return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Pega el enlace de una canción, un álbum o una playlist de Spotify. Un álbum o una playlist mantienen su nombre y su orden.',
              style: theme.textTheme.bodyMedium),
          const SizedBox(height: 12),
          TextField(
            key: const Key('transferir-input'),
            controller: _link,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(hintText: 'https://open.spotify.com/…', border: OutlineInputBorder()),
            onSubmitted: (_) => _analyze(),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(key: const Key('transferir-analyze'), onPressed: _analyze, icon: const Icon(Icons.search_rounded), label: const Text('Analizar')),
          const SizedBox(height: 8),
          TextButton(onPressed: () async { await _spotify.disconnect(); if (mounted) setState(() => _stage = _Stage.connect); }, child: const Text('Desconectar')),
        ]);
      case _Stage.analyzing:
      case _Stage.transferring:
        return Center(child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(_message, key: const Key('transferir-progress'), textAlign: TextAlign.center),
          ]),
        ));
      case _Stage.review:
        return _reviewBody(theme);
      case _Stage.done:
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Text(_message, key: const Key('transferir-done'), style: theme.textTheme.bodyLarge),
          const SizedBox(height: 8),
          Text('Verás el progreso de publicación en «Tu biblioteca».', style: theme.textTheme.bodySmall),
          const SizedBox(height: 16),
          FilledButton(onPressed: () { _link.clear(); setState(() { _resolution = null; _stage = _Stage.input; }); }, child: const Text('Transferir más')),
        ]);
    }
  }

  Widget _reviewBody(ThemeData theme) {
    final resolution = _resolution!;
    if (resolution.results.isEmpty) {
      return Column(mainAxisSize: MainAxisSize.min, children: [
        Text('No hay canciones accesibles aquí. En modo desarrollo, Spotify solo da el contenido de tus propias listas; '
            'prueba con un álbum, una canción suelta o una lista tuya.', style: theme.textTheme.bodyMedium),
        const SizedBox(height: 16),
        FilledButton(onPressed: () { _link.clear(); setState(() { _resolution = null; _stage = _Stage.input; }); }, child: const Text('Otro enlace')),
      ]);
    }
    final already = resolution.results.where((r) => r.inLibrary).length;
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('${resolution.album != null ? '«${resolution.album!.name}» · ' : ''}${resolution.results.length} canciones'
          '${already > 0 ? ' · $already ya en tu biblioteca' : ''}',
          key: const Key('transferir-summary'), style: theme.textTheme.bodyMedium),
      const SizedBox(height: 8),
      Flexible(child: ListView.separated(
        shrinkWrap: true,
        itemCount: resolution.results.length,
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (_, i) => _row(resolution.results[i], theme),
      )),
      const SizedBox(height: 12),
      FilledButton.icon(
        key: const Key('transferir-go'),
        onPressed: _transfer,
        icon: const Icon(Icons.download_rounded),
        label: Text('Transferir $_selectedCount canciones'),
      ),
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
            Text(result.track.title, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
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
            onChanged: (url) => setState(() {
              final pick = options.firstWhere((c) => c.url == url);
              result.override = pick;
              result.excluded = false;
            }),
          ),
        ),
        if (!dupe && needsChoice) Padding(
          padding: const EdgeInsets.only(left: 48),
          child: _ManualSearch(spotify: _spotify, onPicked: (candidate) => setState(() {
            result.alternatives = [candidate, ...result.alternatives];
            result.override = candidate;
            result.excluded = false;
          })),
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
    final label = dupe ? 'Ya en tu biblioteca' : switch (result.tier) { 'alta' => 'Segura', 'media' => 'Elige', _ => 'Revisa' };
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

  Future<void> _search() async {
    final q = _query.text.trim();
    if (q.isEmpty) return;
    setState(() => _busy = true);
    try {
      final results = await widget.spotify.searchYoutube(q);
      if (!mounted) return;
      if (results.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Sin resultados en YouTube.')));
        return;
      }
      final picked = await showModalBottomSheet<TransferCandidate>(
        context: context,
        builder: (_) => ListView(children: [
          for (final c in results) ListTile(
            title: Text(c.title, maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: Text('${_fmt(c.durationS)} · ${_sourceLabel(c.source)}'),
            onTap: () => Navigator.of(context).pop(c),
          ),
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
      Expanded(child: TextField(
        controller: _query,
        decoration: const InputDecoration(isDense: true, hintText: 'Buscar en YouTube…'),
        onSubmitted: (_) => _search(),
      )),
      TextButton(onPressed: _busy ? null : _search, child: const Text('Buscar')),
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
      if (mounted) setState(() => _error = 'Spotify no autorizó la conexión.');
      _handling = false;
      return NavigationDecision.prevent;
    }
    if (state != widget.login.state) {
      if (mounted) setState(() => _error = 'La respuesta de Spotify no coincide (seguridad).');
      _handling = false;
      return NavigationDecision.prevent;
    }
    try {
      await widget.spotify.completeLogin(code: code, verifier: widget.login.verifier);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
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
