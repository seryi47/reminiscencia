// Lógica de «Transferir música» en la APK (ADR-0044): el mismo motor y los mismos endpoints que la web (el servidor hace
// OAuth, lee Spotify y resuelve a YouTube), aquí solo se conduce. Espejo de frontend/web/js/spotify-transfer.js: sesión,
// resolución por páginas con refresco de token, dedup (regla común de duplicates.dart) y selección. Sin UI: la pantalla
// (ui/spotify_transfer_page.dart) pinta esto y entrega las aceptadas al pipeline de subida que ya existe.

// Los campos privados _client/_pageLimit se asignan desde parámetros con nombre (que no pueden empezar por «_», así que no
// pueden ser formales de inicialización); el resto del constructor usa valores por defecto con ??.
// ignore_for_file: prefer_initializing_formals
import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'api_config.dart';
import 'app_error.dart';
import 'duplicates.dart';
import 'youtube_importer.dart';

const _sessionKey = 'reminiscencia.spotify.session';
const _refreshMarginMs = 60000;

class SpotifySession {
  const SpotifySession({this.accessToken, this.refreshToken, this.scope = '', this.expiresAt = 0});
  final String? accessToken;
  final String? refreshToken;
  final String scope;
  final int expiresAt;

  bool get hasTokens => (accessToken != null && accessToken!.isNotEmpty) || (refreshToken != null && refreshToken!.isNotEmpty);

  factory SpotifySession.fromJson(Map<String, dynamic> json) => SpotifySession(
        accessToken: json['accessToken'] as String?,
        refreshToken: json['refreshToken'] as String?,
        scope: (json['scope'] as String?) ?? '',
        expiresAt: (json['expiresAt'] as num?)?.toInt() ?? 0,
      );
  Map<String, dynamic> toJson() => {'accessToken': accessToken, 'refreshToken': refreshToken, 'scope': scope, 'expiresAt': expiresAt};
}

/// Guardado de la sesión. Por defecto en SharedPreferences; en pruebas, en memoria.
abstract class SpotifyStore {
  Future<SpotifySession?> read();
  Future<void> write(SpotifySession session);
  Future<void> clear();
}

class PrefsSpotifyStore implements SpotifyStore {
  @override
  Future<SpotifySession?> read() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_sessionKey);
    if (raw == null) return null;
    try {
      return SpotifySession.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(SpotifySession session) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_sessionKey, jsonEncode(session.toJson()));
  }

  @override
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_sessionKey);
  }
}

class SpotifyLogin {
  const SpotifyLogin({required this.url, required this.verifier, required this.state});
  final String url;
  final String verifier;
  final String state;
}

/// Metadatos de una pista de Spotify (los que da /resolve).
class SpotifyTrackMeta {
  const SpotifyTrackMeta({required this.title, this.artists = const [], this.durationMs, this.album});
  final String title;
  final List<String> artists;
  final int? durationMs;
  final String? album;
  String get artist => artists.isNotEmpty ? artists.first : '';
  double? get durationS => durationMs == null ? null : durationMs! / 1000;

  factory SpotifyTrackMeta.fromJson(Map<String, dynamic> json) => SpotifyTrackMeta(
        title: (json['title'] as String?) ?? '',
        artists: ((json['artists'] as List?) ?? const []).whereType<String>().toList(),
        durationMs: (json['durationMs'] as num?)?.toInt(),
        album: json['album'] as String?,
      );
}

/// Un candidato de YouTube para una pista.
class TransferCandidate {
  const TransferCandidate({required this.url, required this.title, this.durationS, this.source = 'search', this.id});
  final String url;
  final String title;
  final double? durationS;
  final String source;
  final String? id;

  factory TransferCandidate.fromJson(Map<String, dynamic> json) => TransferCandidate(
        url: (json['url'] as String?) ?? '',
        title: (json['title'] as String?) ?? '',
        durationS: (json['durationS'] as num?)?.toDouble(),
        source: (json['source'] as String?) ?? 'search',
        id: json['id'] as String?,
      );
}

TransferCandidate? _entryCandidate(Object? entry) {
  if (entry is! Map) return null;
  final candidate = entry['candidate'];
  if (candidate is! Map) return null;
  return TransferCandidate.fromJson(candidate.cast<String, dynamic>());
}

/// Una coincidencia resuelta de una pista.
class TransferMatch {
  TransferMatch({
    required this.index,
    required this.track,
    required this.tier,
    this.best,
    this.alternatives = const [],
    this.inLibrary = false,
    this.override,
  });
  final int index;
  final SpotifyTrackMeta track;
  String tier; // 'alta' | 'media' | 'baja'
  TransferCandidate? best;
  List<TransferCandidate> alternatives;
  bool inLibrary;
  TransferCandidate? override; // elección del usuario (alternativa o búsqueda manual)
  bool excluded = false;

  /// El candidato elegido: el override, o la mejor coincidencia si la hay (alta O media, ya pre-elegida). Las de confianza
  /// baja no traen `best`, así que quedan sin elegir hasta que el usuario pique una versión.
  TransferCandidate? get chosen => override ?? best;

  factory TransferMatch.fromJson(Map<String, dynamic> json) => TransferMatch(
        index: (json['index'] as num?)?.toInt() ?? 0,
        track: SpotifyTrackMeta.fromJson(((json['track'] as Map?) ?? const {}).cast<String, dynamic>()),
        tier: (json['tier'] as String?) ?? 'baja',
        best: _entryCandidate(json['best']),
        alternatives: ((json['alternatives'] as List?) ?? const []).map(_entryCandidate).whereType<TransferCandidate>().toList(),
      );
}

class TransferAlbum {
  const TransferAlbum({required this.id, required this.name, this.cover, this.artist});
  final String id;
  final String name;
  final String? cover;
  final String? artist;
  factory TransferAlbum.fromJson(Map<String, dynamic> json) => TransferAlbum(
        id: (json['id'] as String?) ?? '',
        name: (json['name'] as String?) ?? '',
        cover: json['cover'] as String?,
        artist: json['artist'] as String?,
      );
}

class TransferResolution {
  TransferResolution({required this.results, this.album, this.total = 0});
  final List<TransferMatch> results;
  final TransferAlbum? album;
  final int total;
}

/// Una playlist del usuario para elegir en la lista (no sus pistas todavía).
class SpotifyPlaylistRef {
  const SpotifyPlaylistRef({required this.id, required this.name, this.total = 0, this.image});
  final String id;
  final String name;
  final int total;
  final String? image;
  factory SpotifyPlaylistRef.fromJson(Map<String, dynamic> json) => SpotifyPlaylistRef(
        id: (json['id'] as String?) ?? '',
        name: (json['name'] as String?) ?? '',
        total: (json['total'] as num?)?.toInt() ?? 0,
        image: json['image'] as String?,
      );
}

/// La biblioteca del usuario: sus playlists y cuántas canciones tiene en «Me gusta».
class SpotifyLibrary {
  const SpotifyLibrary({this.playlists = const [], this.liked = 0});
  final List<SpotifyPlaylistRef> playlists;
  final int liked;
  factory SpotifyLibrary.fromJson(Map<String, dynamic> json) => SpotifyLibrary(
        playlists: ((json['playlists'] as List?) ?? const [])
            .map((p) => SpotifyPlaylistRef.fromJson((p as Map).cast<String, dynamic>()))
            .toList(),
        liked: (json['liked'] as num?)?.toInt() ?? 0,
      );
}

/// Marca las pistas que ya están en la biblioteca (misma regla de duplicados: título + duración).
void markTransferDuplicates(List<TransferMatch> results, List<DuplicateCandidate> library) {
  for (final result in results) {
    final probe = DuplicateCandidate(title: result.track.title, artist: result.track.artist, durationS: result.track.durationS);
    result.inLibrary = library.any((song) => isPossibleDuplicate(probe, song));
  }
}

/// Las pistas que se transfieren, como YoutubeTrack para el importador: se saltan las excluidas y las de biblioteca; una
/// confianza ALTA entra sola; MEDIA/BAJA solo con elección (override); el override manda.
List<YoutubeTrack> selectedTransferTracks(List<TransferMatch> results, {TransferAlbum? album}) {
  final chosen = <YoutubeTrack>[];
  for (final result in results) {
    if (result.excluded || result.inLibrary) continue;
    final pick = result.chosen;
    if (pick == null || pick.url.isEmpty) continue;
    chosen.add(YoutubeTrack(
      url: pick.url,
      title: result.track.title,
      artist: result.track.artist,
      playlistId: album?.id,
      playlistTitle: album?.name,
    ));
  }
  return chosen;
}

class SpotifyTransfer {
  SpotifyTransfer({required http.Client client, SpotifyStore? store, Uri? base, DateTime Function()? clock, int pageLimit = 25})
      : _client = client,
        _store = store ?? PrefsSpotifyStore(),
        _base = base ?? Uri.parse(kWorkerApiBase),
        _clock = clock ?? DateTime.now,
        _pageLimit = pageLimit;

  final http.Client _client;
  final SpotifyStore _store;
  final Uri _base;
  final DateTime Function() _clock;
  final int _pageLimit;

  Future<bool> isConnected() async => (await _store.read())?.hasTokens ?? false;
  Future<void> disconnect() => _store.clear();

  Future<Map<String, dynamic>> _post(String path, [Map<String, dynamic>? body]) async {
    final response = await _client.post(
      _base.replace(path: path),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body ?? const {}),
    );
    Map<String, dynamic> data;
    try {
      data = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      data = const {};
    }
    if (response.statusCode == 401 || data['needsAuth'] == true) {
      throw const SpotifyNeedsAuth();
    }
    if (response.statusCode >= 400) {
      throw AppException((data['error'] as String?) ?? 'Error de Spotify (${response.statusCode}).');
    }
    return data;
  }

  /// Arranca el login: pide la URL de autorización y el verifier/state (que la pantalla guarda hasta el callback).
  Future<SpotifyLogin> login() async {
    final data = await _post('/api/spotify/login');
    return SpotifyLogin(url: data['url'] as String, verifier: data['verifier'] as String, state: data['state'] as String);
  }

  /// Cierra el login: cambia el código por un token y guarda la sesión.
  Future<void> completeLogin({required String code, required String verifier}) async {
    final data = await _post('/api/spotify/token', {'code': code, 'verifier': verifier});
    await _store.write(SpotifySession.fromJson(data));
  }

  bool _needsRefresh(SpotifySession s) => s.expiresAt <= 0 || s.expiresAt - _clock().millisecondsSinceEpoch <= _refreshMarginMs;

  Future<String> _refresh(SpotifySession session) async {
    final refreshToken = session.refreshToken;
    if (refreshToken == null || refreshToken.isEmpty) throw const SpotifyNeedsAuth();
    Map<String, dynamic> data;
    try {
      data = await _post('/api/spotify/refresh', {'refreshToken': refreshToken});
    } catch (_) {
      await _store.clear();
      throw const SpotifyNeedsAuth();
    }
    final refreshed = SpotifySession.fromJson(data);
    // Spotify puede no devolver refresh_token nuevo: se conserva el anterior.
    final merged = refreshed.refreshToken == null ? SpotifySession(accessToken: refreshed.accessToken, refreshToken: refreshToken, scope: refreshed.scope, expiresAt: refreshed.expiresAt) : refreshed;
    await _store.write(merged);
    return merged.accessToken!;
  }

  Future<String> _freshAccessToken() async {
    final session = await _store.read();
    if (session == null || !session.hasTokens) throw const SpotifyNeedsAuth();
    if (!_needsRefresh(session)) return session.accessToken!;
    return _refresh(session);
  }

  /// Lista la biblioteca del usuario (playlists + «Me gusta») para elegir qué transferir.
  Future<SpotifyLibrary> mine() async {
    var token = await _freshAccessToken();
    Map<String, dynamic> data;
    try {
      data = await _post('/api/spotify/mine', {'accessToken': token});
    } on SpotifyNeedsAuth {
      token = await _refresh((await _store.read())!);
      data = await _post('/api/spotify/mine', {'accessToken': token});
    }
    return SpotifyLibrary.fromJson(data);
  }

  /// Resuelve una colección por enlace, por «Me gusta» (source) o por referencia.
  Future<TransferResolution> resolve(String url, {void Function(int loaded, int total)? onPage}) =>
      _resolve({'url': url}, onPage: onPage);
  Future<TransferResolution> resolveSource(String source, {void Function(int, int)? onPage}) =>
      _resolve({'source': source}, onPage: onPage);
  Future<TransferResolution> resolveRef(Map<String, dynamic> ref, {void Function(int, int)? onPage}) =>
      _resolve({'ref': ref}, onPage: onPage);

  Future<TransferResolution> _resolve(Map<String, dynamic> target, {void Function(int loaded, int total)? onPage}) async {
    var accessToken = await _freshAccessToken();
    final results = <TransferMatch>[];
    TransferAlbum? album;
    var total = 0;
    var offset = 0;
    while (true) {
      Map<String, dynamic> page;
      final body = {...target, 'accessToken': accessToken, 'offset': offset, 'limit': _pageLimit};
      try {
        page = await _post('/api/spotify/resolve', body);
      } on SpotifyNeedsAuth {
        accessToken = await _refresh((await _store.read())!); // token caducado a mitad: refresca y reintenta la página
        page = await _post('/api/spotify/resolve', {...body, 'accessToken': accessToken});
      }
      final albumJson = page['album'];
      if (albumJson is Map) album = TransferAlbum.fromJson(albumJson.cast<String, dynamic>());
      total = (page['total'] as num?)?.toInt() ?? results.length;
      for (final entry in (page['results'] as List? ?? const [])) {
        results.add(TransferMatch.fromJson((entry as Map).cast<String, dynamic>()));
      }
      onPage?.call(results.length, total);
      if (page['hasMore'] != true) break;
      offset += _pageLimit;
    }
    return TransferResolution(results: results, album: album, total: total);
  }

  /// Búsqueda manual en YouTube para una pista sin buena coincidencia.
  Future<List<TransferCandidate>> searchYoutube(String query) async {
    final response = await _client.get(_base.replace(path: '/api/youtube/search', queryParameters: {'q': query}));
    if (response.statusCode >= 400) throw AppException('No se pudo buscar en YouTube.');
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return ((data['items'] as List?) ?? const [])
        .map((it) => TransferCandidate.fromJson((it as Map).cast<String, dynamic>()))
        .toList();
  }
}

/// La sesión de Spotify ha caducado o no existe: hay que volver a conectar.
class SpotifyNeedsAuth implements Exception {
  const SpotifyNeedsAuth();
  @override
  String toString() => 'Conecta tu cuenta de Spotify.';
}
