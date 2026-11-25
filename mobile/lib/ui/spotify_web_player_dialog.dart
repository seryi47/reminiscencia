// Diálogo que ejecuta el fallback «Web Player» de Spotify en la APK (ADR-0044 ampliado 2026-11-25). Equivalente
// al flujo que la web hace de forma transparente: si la playlist tiene más de 100 pistas y Spotify la capa por
// Dev Mode, pedimos un token al reproductor web público (`open.spotify.com/get_access_token`) y leemos la lista
// entera. El WebView es necesario porque el token sale de un endpoint que exige cookies de sesión del usuario
// (sin las cookies devuelve un token anónimo capado igual que el nuestro).
//
// UX: se muestra un diálogo con el WebView por si hay que loguearse. Si el usuario ya está logueado en Spotify en
// este WebView (persiste entre aperturas), el flujo es instantáneo y el diálogo se cierra solo.

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../spotify_transfer.dart';
import '../spotify_webplayer.dart';

/// Lanza el diálogo. Devuelve los `TransferMatch` NUEVOS (ya matcheados con YouTube), con `index` global; o
/// null si el usuario cerró el diálogo sin completar.
Future<List<TransferMatch>?> runWebPlayerRescue(
  BuildContext context, {
  required SpotifyTransfer spotify,
  required String playlistId,
  required Map<String, dynamic> albumRef,
  required String? name,
  required int alreadyLoaded,
  required int reportedTotal,
  int pageLimit = 25,
}) {
  return showDialog<List<TransferMatch>?>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => _WebPlayerDialog(
      spotify: spotify,
      playlistId: playlistId,
      albumRef: albumRef,
      name: name,
      alreadyLoaded: alreadyLoaded,
      reportedTotal: reportedTotal,
      pageLimit: pageLimit,
    ),
  );
}

class _WebPlayerDialog extends StatefulWidget {
  const _WebPlayerDialog({
    required this.spotify,
    required this.playlistId,
    required this.albumRef,
    required this.name,
    required this.alreadyLoaded,
    required this.reportedTotal,
    required this.pageLimit,
  });
  final SpotifyTransfer spotify;
  final String playlistId;
  final Map<String, dynamic> albumRef;
  final String? name;
  final int alreadyLoaded;
  final int reportedTotal;
  final int pageLimit;
  @override
  State<_WebPlayerDialog> createState() => _WebPlayerDialogState();
}

class _WebPlayerDialogState extends State<_WebPlayerDialog> {
  late final WebViewController _controller;
  String _status = 'Pidiendo token a Spotify…';
  bool _needsLogin = false;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent);
    scheduleMicrotask(_run);
  }

  Future<void> _run() async {
    try {
      try {
        await fetchWebPlayerToken(_controller);
      } on SpotifyWebPlayerNeedsLogin {
        if (!mounted) return;
        setState(() { _needsLogin = true; _status = 'Entra en Spotify para continuar.'; });
        await loginInWebView(_controller);
        if (!mounted) return;
        setState(() { _needsLogin = false; _status = 'Pidiendo token tras el login…'; });
        await fetchWebPlayerToken(_controller);
      }
      if (!mounted) return;
      setState(() => _status = 'Leyendo la playlist completa…');
      final rawItems = await fetchPlaylistTracksFromWebPlayer(
        controller: _controller, playlistId: widget.playlistId,
      );
      if (rawItems == null) throw const SpotifyWebPlayerException('no se pudo leer la playlist');
      // Solo las que faltan (ya tenemos las primeras `alreadyLoaded`).
      final extraRaw = rawItems
          .skip(widget.alreadyLoaded)
          .map((e) => e['track'])
          .whereType<Map>()
          .where((t) => (t['type'] ?? 'track') == 'track' && t['is_local'] != true)
          .toList();
      final matches = <TransferMatch>[];
      for (var i = 0; i < extraRaw.length; i += widget.pageLimit) {
        final window = extraRaw
            .sublist(i, (i + widget.pageLimit).clamp(0, extraRaw.length))
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        if (!mounted) return;
        setState(() => _status = 'Matcheando ${widget.alreadyLoaded + i + 1}–${widget.alreadyLoaded + i + window.length}…');
        final res = await widget.spotify.resolveTracks(
          rawTracks: window,
          albumRef: widget.albumRef,
          name: widget.name,
          indexOffset: widget.alreadyLoaded + i,
        );
        matches.addAll(res.results);
        // Dejamos a Flutter repintar el progreso.
        await Future.delayed(Duration.zero);
      }
      if (!mounted) return;
      _done = true;
      Navigator.of(context).pop(matches);
    } catch (error) {
      if (!mounted) return;
      setState(() => _status = 'No se pudo completar: $error');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      insetPadding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    widget.name != null ? '«${widget.name}» tiene ${widget.reportedTotal} canciones' : 'Importando la lista completa',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(_status, textAlign: TextAlign.center),
                ],
              ),
            ),
            // El WebView solo se muestra si hace falta loguearse. Si está invisible, lo hacemos minúsculo para
            // que la carga igual ocurra en segundo plano.
            SizedBox(
              height: _needsLogin ? 420 : 1,
              child: WebViewWidget(controller: _controller),
            ),
            Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: _done ? null : () => Navigator.of(context).pop(null),
                    child: const Text('Cancelar'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Decodifica un token de SpotifyWebPlayerToken desde JSON (no se usa en producción; se expone para los tests).
SpotifyWebPlayerToken? tokenFromRaw(String raw) {
  try {
    final data = jsonDecode(raw);
    if (data is! Map) return null;
    final at = data['accessToken'];
    final exp = data['accessTokenExpirationTimestampMs'];
    if (at is! String || at.isEmpty) return null;
    return SpotifyWebPlayerToken(
      at,
      exp is int ? DateTime.fromMillisecondsSinceEpoch(exp) : DateTime.now().add(const Duration(minutes: 55)),
    );
  } catch (_) { return null; }
}
