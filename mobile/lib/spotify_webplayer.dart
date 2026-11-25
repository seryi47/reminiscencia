// Fallback «Web Player» de Spotify para la APK (ADR-0044 ampliado 2026-11-25). Equivalente al módulo
// `spotify-webplayer.js` de la web. En Development Mode sin Extended Quota, Spotify topa a 100 pistas la lectura de
// playlists AJENAS con el token de nuestra app. Para saltarlo, pedimos un token al reproductor web público
// (`open.spotify.com/get_access_token`), que emite tokens con el client_id del Web Player y cuota completa.
//
// En la APK no hay navegador compartido con cookies: usamos un `WebViewController` oculto que navega a
// `open.spotify.com/get_access_token` y leemos el JSON con `runJavaScriptReturningResult('document.body.innerText')`.
// Si el token viene como `isAnonymous: true` (sesión no iniciada), abrimos `accounts.spotify.com/login` en el MISMO
// WebView (visible), dejamos que el usuario se loguee una sola vez, y repetimos. Las cookies de Spotify quedan en
// el WebView para futuras sesiones. Con el token conseguido, paginamos `api.spotify.com/v1/playlists/<id>/tracks`
// desde Dart (http normal: el Bearer basta, no necesita cookies).

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:webview_flutter/webview_flutter.dart';

const String _tokenUrl =
    'https://open.spotify.com/get_access_token?reason=transport&productType=web-player';
const String _loginUrl =
    'https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F';
const String _api = 'https://api.spotify.com';
const int _limit = 100;
const int _maxPages = 100;

class SpotifyWebPlayerToken {
  SpotifyWebPlayerToken(this.accessToken, this.expiresAt);
  final String accessToken;
  final DateTime expiresAt;
  bool get isValid =>
      DateTime.now().isBefore(expiresAt.subtract(const Duration(seconds: 30)));
}

SpotifyWebPlayerToken? _cachedToken;

/// Pide un token al reproductor web público. Devuelve el token cacheado si sigue válido.
/// Si viene anónimo (sin sesión), lanza [SpotifyWebPlayerNeedsLogin] para que la UI abra el login.
Future<SpotifyWebPlayerToken> fetchWebPlayerToken(
  WebViewController controller,
) async {
  if (_cachedToken?.isValid == true) return _cachedToken!;
  await controller.loadRequest(Uri.parse(_tokenUrl));
  final data = await _waitForJsonBody(controller);
  final accessToken = data['accessToken'];
  final isAnonymous = data['isAnonymous'] == true;
  final expiresMs = data['accessTokenExpirationTimestampMs'];
  if (accessToken is! String || accessToken.isEmpty) {
    throw const SpotifyWebPlayerException('respuesta sin token');
  }
  if (isAnonymous) throw const SpotifyWebPlayerNeedsLogin();
  final expiresAt = expiresMs is int
      ? DateTime.fromMillisecondsSinceEpoch(expiresMs)
      : DateTime.now().add(const Duration(minutes: 55));
  _cachedToken = SpotifyWebPlayerToken(accessToken, expiresAt);
  return _cachedToken!;
}

/// Hace login en Spotify dentro de un WebView visible (devuelve cuando la URL vuelve a `open.spotify.com`).
Future<void> loginInWebView(WebViewController controller) async {
  final completer = Completer<void>();
  await controller.setNavigationDelegate(NavigationDelegate(
    onPageFinished: (url) {
      if (completer.isCompleted) return;
      final u = Uri.tryParse(url);
      if (u != null && u.host == 'open.spotify.com') completer.complete();
    },
  ));
  await controller.loadRequest(Uri.parse(_loginUrl));
  await completer.future
      .timeout(const Duration(minutes: 3), onTimeout: () => Future.value());
}

/// Lee la playlist entera usando el token del Web Player. Devuelve las entradas CRUDAS de
/// `/v1/playlists/<id>/tracks` (cada una lleva su `track`). Null si no se pudo.
Future<List<Map<String, dynamic>>?> fetchPlaylistTracksFromWebPlayer({
  required WebViewController controller,
  required String playlistId,
  http.Client? httpClient,
}) async {
  final SpotifyWebPlayerToken token;
  try {
    token = await fetchWebPlayerToken(controller);
  } catch (_) {
    return null;
  }
  final client = httpClient ?? http.Client();
  final items = <Map<String, dynamic>>[];
  try {
    for (var page = 0, offset = 0; page < _maxPages; page += 1, offset += _limit) {
      final url = Uri.parse(
        '$_api/v1/playlists/${Uri.encodeComponent(playlistId)}/tracks?offset=$offset&limit=$_limit',
      );
      final res = await client.get(
        url,
        headers: {'Authorization': 'Bearer ${token.accessToken}'},
      );
      if (res.statusCode == 401) {
        _cachedToken = null;
        break;
      }
      if (res.statusCode != 200) break;
      final data = jsonDecode(res.body);
      if (data is! Map || data['items'] is! List) break;
      final pageItems = (data['items'] as List).whereType<Map>().toList();
      if (pageItems.isEmpty) break;
      items.addAll(pageItems.map((e) => Map<String, dynamic>.from(e)));
      if (pageItems.length < _limit) break;
    }
  } finally {
    if (httpClient == null) client.close();
  }
  return items;
}

Future<Map<String, dynamic>> _waitForJsonBody(
  WebViewController controller,
) async {
  final ready = Completer<void>();
  await controller.setNavigationDelegate(NavigationDelegate(
    onPageFinished: (_) {
      if (!ready.isCompleted) ready.complete();
    },
  ));
  await ready.future
      .timeout(const Duration(seconds: 15), onTimeout: () => Future.value());
  final raw = await controller
      .runJavaScriptReturningResult('document.body ? document.body.innerText : ""');
  final text = raw is String ? raw : raw.toString();
  // runJavaScriptReturningResult envuelve el string entre comillas en Android; lo decodificamos.
  final unwrapped = _unwrapJsString(text);
  final parsed = jsonDecode(unwrapped);
  if (parsed is! Map) throw const SpotifyWebPlayerException('respuesta no es JSON');
  return Map<String, dynamic>.from(parsed);
}

String _unwrapJsString(String raw) {
  var s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.substring(1, s.length - 1);
    s = s.replaceAll(r'\"', '"').replaceAll(r'\\', r'\');
  }
  return s;
}

class SpotifyWebPlayerException implements Exception {
  const SpotifyWebPlayerException(this.message);
  final String message;
  @override
  String toString() => 'SpotifyWebPlayerException: $message';
}

class SpotifyWebPlayerNeedsLogin implements Exception {
  const SpotifyWebPlayerNeedsLogin();
}

/// Solo para las pruebas: olvida el token cacheado para que cada caso arranque limpio.
void resetWebPlayerTokenCache() {
  _cachedToken = null;
}
