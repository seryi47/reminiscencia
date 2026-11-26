import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_config.dart';
import 'app_error.dart';
import 'auth_store.dart';

/// Cliente de los endpoints del catálogo del Worker (ADR-0052).
///
/// Contratos:
///   GET  /api/catalogo/latest     → 200 { version, folders, songs, updated_at } + ETag `W/"v<n>"`,
///                                   304 si el cliente mandó `If-None-Match` igual al ETag actual,
///                                   503 si el catálogo no se ha migrado todavía.
///   POST /api/catalogo/edit       → 200 { ok, version, event }, 401 auth, 412 if_match, 423 Locked.
///   POST /api/buzon/publish       → 200 { ok, version, event }, 401 auth, 412, 423.
///   GET  /api/catalogo/historial  → 200 { ok, events[], limit }.
///
/// Los POST manejan los dos conflictos típicos:
///   412: la versión que mandamos ya no es la más nueva → refetch y reintento con la nueva (una vez).
///   423: alguien está escribiendo → espera `Retry-After` segundos y reintenta.
class WorkerCatalogClient {
  WorkerCatalogClient({
    required this.auth,
    http.Client? client,
    ApiRoutes? routes,
    Duration retryJitter = const Duration(milliseconds: 50),
    Future<void> Function(Duration)? delay,
    DateTime Function()? clock,
    // ignore: prefer_initializing_formals
  }) : _client = client ?? http.Client(),
       // ignore: prefer_initializing_formals
       _routes = routes,
       // ignore: prefer_initializing_formals
       _retryJitter = retryJitter,
       _delay = delay ?? Future<void>.delayed,
       _clock = clock ?? DateTime.now;

  final AuthStore auth;
  final http.Client _client;
  final ApiRoutes? _routes;
  final Duration _retryJitter;
  final Future<void> Function(Duration) _delay;
  final DateTime Function() _clock;

  ApiRoutes get _api => _routes ?? apiRoutes;

  /// Lee el catálogo con `If-None-Match` opcional. Devuelve null si el servidor dice 304
  /// (la caché del cliente sigue siendo válida).
  Future<CatalogLatest?> getLatest({String? ifNoneMatch}) async {
    final headers = <String, String>{};
    if (ifNoneMatch != null && ifNoneMatch.isNotEmpty) {
      headers['If-None-Match'] = ifNoneMatch;
    }
    final response = await _get('/api/catalogo/latest', headers: headers);
    if (response.statusCode == 304) return null;
    if (response.statusCode == 503) {
      throw const AppException(
        'El catálogo todavía no se ha migrado al Worker (503).',
      );
    }
    if (response.statusCode != 200) {
      throw AppException(
        'No se pudo leer el catálogo (HTTP ${response.statusCode}).',
      );
    }
    final body = jsonDecode(utf8.decode(response.bodyBytes));
    if (body is! Map) {
      throw const AppException('Catálogo con formato inesperado.');
    }
    final etag = response.headers['etag'] ?? '';
    return CatalogLatest(body: body.cast<String, Object?>(), etag: etag);
  }

  /// Envía una edición. Si el servidor responde 412 (if_match desactualizado) y hay versión
  /// más nueva en el cuerpo, releemos el catálogo y reintentamos UNA sola vez con la nueva
  /// versión; esto cubre la carrera normal entre dos editores.
  Future<CatalogWriteResult> edit({
    required String action,
    required Map<String, Object?> params,
    required int ifMatch,
  }) {
    return _lockedPost(
      path: '/api/catalogo/edit',
      initialBody: {
        'action': action,
        'params': params,
        'if_match': ifMatch,
      },
      withRefreshedVersion: (newVersion) => {
        'action': action,
        'params': params,
        'if_match': newVersion,
      },
    );
  }

  /// Publica canciones del buzón. Mismo patrón que [edit].
  Future<CatalogWriteResult> buzonPublish({
    required List<Map<String, Object?>> songs,
    required int ifMatch,
  }) {
    return _lockedPost(
      path: '/api/buzon/publish',
      initialBody: {
        'songs': songs,
        'if_match': ifMatch,
      },
      withRefreshedVersion: (newVersion) => {
        'songs': songs,
        'if_match': newVersion,
      },
    );
  }

  /// Últimos N eventos del historial.
  Future<List<Map<String, Object?>>> historial({int limit = 100}) async {
    final response = await _get('/api/catalogo/historial?limit=$limit');
    if (response.statusCode != 200) {
      throw AppException(
        'No se pudo leer el historial (HTTP ${response.statusCode}).',
      );
    }
    final body = jsonDecode(utf8.decode(response.bodyBytes));
    if (body is! Map) return const [];
    final events = (body['events'] as List?) ?? const [];
    return [
      for (final event in events)
        if (event is Map) event.cast<String, Object?>(),
    ];
  }

  Future<CatalogWriteResult> _lockedPost({
    required String path,
    required Map<String, Object?> initialBody,
    required Map<String, Object?> Function(int newVersion) withRefreshedVersion,
  }) async {
    var body = initialBody;
    var retriedConflict = false;
    var retriedLock = 0;
    const maxLockRetries = 3;
    while (true) {
      final headers = await auth.withAuth({'Content-Type': 'application/json'});
      final response = await _post(path, headers: headers, body: body);
      if (response.statusCode == 200) {
        final json = jsonDecode(utf8.decode(response.bodyBytes));
        return CatalogWriteResult.fromJson(json is Map ? json.cast<String, Object?>() : const {});
      }
      if (response.statusCode == 401) {
        await auth.clear();
        throw const AuthRequiredException();
      }
      if (response.statusCode == 412 && !retriedConflict) {
        retriedConflict = true;
        final json = jsonDecode(utf8.decode(response.bodyBytes));
        final newVersion = json is Map && json['current_version'] is int
            ? json['current_version'] as int
            : await _readCurrentVersion();
        body = withRefreshedVersion(newVersion);
        continue;
      }
      if (response.statusCode == 423 && retriedLock < maxLockRetries) {
        retriedLock++;
        final retryAfter = _retryAfter(response.headers['retry-after']);
        await _delay(retryAfter + _retryJitter);
        continue;
      }
      if (response.statusCode == 409) {
        // El buzón lo tira cuando una canción ya está en el catálogo por sha256 (ADR-0052).
        throw BuzonDuplicateException(_errorMessage(response));
      }
      throw AppException(_errorMessage(response));
    }
  }

  Duration _retryAfter(String? header) {
    if (header == null) return const Duration(seconds: 1);
    final seconds = int.tryParse(header.trim());
    if (seconds != null && seconds > 0) {
      return Duration(seconds: seconds.clamp(1, 30));
    }
    return const Duration(seconds: 1);
  }

  Future<int> _readCurrentVersion() async {
    final latest = await getLatest();
    if (latest == null) return 0;
    final version = latest.body['version'];
    return version is int ? version : 0;
  }

  String _errorMessage(http.Response response) {
    try {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json is Map && json['error'] is String) return json['error'] as String;
    } catch (_) {
      // texto plano
    }
    return 'Error del Worker (HTTP ${response.statusCode}).';
  }

  Future<http.Response> _get(String path, {Map<String, String>? headers}) {
    final uri = _api.base.isNotEmpty
        ? _api.workerUri(path)
        : _api.vercelUri(path);
    return _client
        .get(uri, headers: headers)
        .timeout(const Duration(seconds: 15));
  }

  Future<http.Response> _post(
    String path, {
    required Map<String, String> headers,
    required Object body,
  }) {
    final uri = _api.base.isNotEmpty
        ? _api.workerUri(path)
        : _api.vercelUri(path);
    return _client
        .post(uri, headers: headers, body: jsonEncode(body))
        .timeout(const Duration(seconds: 15));
  }

  /// Aviso de tiempo para el cursor del reloj (lo usan pruebas sin red real).
  DateTime now() => _clock();

  /// Long-poll de `/api/catalogo/wait?if_version=<v>&timeout=<s>`.
  /// Devuelve el catálogo nuevo (200), null (204 sin cambios), o 503 lanza.
  Future<CatalogLatest?> waitForUpdate({
    required int currentVersion,
    int timeoutSeconds = 25,
    void Function(http.StreamedResponse)? onResponseStart,
  }) async {
    final uri = _api.base.isNotEmpty
        ? _api.workerUri('/api/catalogo/wait?if_version=$currentVersion&timeout=$timeoutSeconds')
        : _api.vercelUri('/api/catalogo/wait?if_version=$currentVersion&timeout=$timeoutSeconds');
    final request = http.Request('GET', uri);
    // Timeout = timeoutSeconds + 10 s margen para que el Worker nos responda 204 antes de que nosotros matemos la conexión.
    final streamed = await _client
        .send(request)
        .timeout(Duration(seconds: timeoutSeconds + 10));
    if (onResponseStart != null) onResponseStart(streamed);
    if (streamed.statusCode == 204) {
      // Drenamos el stream por si acaso.
      await streamed.stream.drain<void>();
      return null;
    }
    if (streamed.statusCode == 503) {
      await streamed.stream.drain<void>();
      throw const AppException(
        'El catálogo todavía no se ha migrado al Worker (503).',
      );
    }
    final response = await http.Response.fromStream(streamed);
    if (response.statusCode != 200) {
      throw AppException(
        'No se pudo leer el catálogo en tiempo real (HTTP ${response.statusCode}).',
      );
    }
    final body = jsonDecode(utf8.decode(response.bodyBytes));
    if (body is! Map) {
      throw const AppException('Catálogo con formato inesperado.');
    }
    final etag = response.headers['etag'] ?? '';
    return CatalogLatest(body: body.cast<String, Object?>(), etag: etag);
  }
}

/// Watcher del catálogo (ADR-0052): bucle que llama a `/api/catalogo/wait` y publica cada actualización por
/// `onUpdate`. Se pausa cuando la app pasa a background y se reanuda al volver. Si falla, backoff
/// exponencial con tope de 30 s.
class CatalogWatcher {
  CatalogWatcher({
    required this.client,
    required this.getVersion,
    required this.onUpdate,
    this.onError,
    this.waitTimeoutSeconds = 25,
    Future<void> Function(Duration)? sleep,
  }) : _sleep = sleep ?? Future<void>.delayed;

  final WorkerCatalogClient client;
  final int Function() getVersion;
  final Future<void> Function(CatalogLatest catalog) onUpdate;
  final void Function(Object error)? onError;
  final int waitTimeoutSeconds;
  final Future<void> Function(Duration) _sleep;

  bool _stopped = false;
  bool _paused = false;
  Completer<void>? _wake;
  int _failures = 0;
  Future<void>? _loop;

  /// Arranca el bucle en background. Idempotente: si ya estaba corriendo, no arranca uno nuevo.
  void start() {
    if (_loop != null) return;
    _stopped = false;
    _loop = _run();
  }

  /// Pausa el bucle (p.ej. cuando la app pasa a background). Reanudar con [resume].
  void pause() {
    _paused = true;
  }

  /// Reanuda tras pause().
  void resume() {
    if (!_paused) return;
    _paused = false;
    final wake = _wake;
    _wake = null;
    wake?.complete();
  }

  /// Detiene el bucle definitivamente.
  Future<void> stop() async {
    _stopped = true;
    final wake = _wake;
    _wake = null;
    wake?.complete();
    final loop = _loop;
    _loop = null;
    if (loop != null) {
      try { await loop; } catch (_) { /* el bucle absorbe sus propios errores */ }
    }
  }

  Future<void> _run() async {
    while (!_stopped) {
      // Yield real al event loop en cada iteración: evita monopolizar CPU cuando el sleep y el send
      // inyectados resuelven inmediato (tests), y permite que stop() se atienda.
      await Future<void>.delayed(Duration.zero);
      if (_stopped) break;
      if (_paused) {
        _wake = Completer<void>();
        await _wake!.future;
        continue;
      }
      try {
        final version = getVersion();
        final catalog = await client.waitForUpdate(
          currentVersion: version,
          timeoutSeconds: waitTimeoutSeconds,
        );
        if (_stopped) break;
        if (catalog != null) {
          _failures = 0;
          try { await onUpdate(catalog); } catch (e) { onError?.call(e); }
        }
      } catch (e) {
        if (_stopped) break;
        _failures++;
        onError?.call(e);
        final seconds = (1 << (_failures - 1).clamp(0, 5)).clamp(1, 30);
        await _sleep(Duration(seconds: seconds));
      }
    }
  }
}

class CatalogLatest {
  const CatalogLatest({required this.body, required this.etag});
  final Map<String, Object?> body;
  final String etag;

  int get version => (body['version'] as num?)?.toInt() ?? 0;
}

/// Se lanza cuando el Worker rechaza una canción del buzón con 409 por sha256 duplicado (ADR-0052).
class BuzonDuplicateException implements Exception {
  const BuzonDuplicateException([this.message = 'La canción ya estaba en la biblioteca.']);
  final String message;
  @override
  String toString() => 'BuzonDuplicateException: $message';
}

class CatalogWriteResult {
  const CatalogWriteResult({required this.version, required this.event});

  final int version;
  final Map<String, Object?> event;

  factory CatalogWriteResult.fromJson(Map<String, Object?> json) {
    return CatalogWriteResult(
      version: (json['version'] as num?)?.toInt() ?? 0,
      event: (json['event'] is Map)
          ? (json['event'] as Map).cast<String, Object?>()
          : const {},
    );
  }
}
