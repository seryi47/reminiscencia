import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'library_store.dart' show kLibraryBase;

// Dirección del API (ADR-0029), igual que la web (frontend/web/js/api-config.js). Las peticiones a /api/subir,
// /api/editar y /api/portadas van al Worker de Cloudflare «reminiscencia-api» si [kWorkerApiBase] tiene su dirección,
// y si no (o si el Worker no responde) a las funciones de Vercel, como antes.

/// ÚNICO SITIO QUE HAY QUE CAMBIAR al desplegar el Worker: su dirección, sin barra final, por ejemplo
/// `https://reminiscencia-api.SUBDOMINIO.workers.dev`. Vacía = todo por Vercel.
const String kWorkerApiBase = 'https://reminiscencia-api.reminiscencia-app.workers.dev';

/// Trozo de /api/subir: 4 MB en Vercel (admite 4,5 MB por petición) y 32 MB en el Worker. Los mismos valores que
/// VERCEL_CHUNK_BYTES y WORKER_CHUNK_BYTES de la web (lo comprueba test/api_config_test.dart).
const int kVercelChunkBytes = 4 * 1024 * 1024;
const int kWorkerChunkBytes = 32 * 1024 * 1024;

/// Cabecera que el Worker pone en todas sus respuestas: sin ella, la respuesta no es suya (página de error, etc.).
const String kWorkerHeader = 'x-reminiscencia-api';

/// Tiempo para preguntar a /api/salud antes de subir.
const Duration kWorkerProbeTimeout = Duration(seconds: 4);

/// Tras un fallo del Worker, cuánto tiempo se va directamente a Vercel antes de volver a probarlo.
const Duration kRetryWorkerAfter = Duration(minutes: 5);

/// Base válida del Worker (https, o http local; sin barra final ni ruta), o '' si no hay.
String normalizeApiBase(String value) {
  var text = value.trim();
  while (text.endsWith('/')) {
    text = text.substring(0, text.length - 1);
  }
  if (text.isEmpty) return '';
  final uri = Uri.tryParse(text);
  if (uri == null || !uri.hasAuthority || uri.host.isEmpty) return '';
  final local = uri.host == 'localhost' || uri.host == '127.0.0.1';
  if (uri.scheme != 'https' && !(local && uri.scheme == 'http')) return '';
  if (uri.path.isNotEmpty || uri.hasQuery || uri.hasFragment) return '';
  return uri.origin;
}

/// Destino de la subida de un archivo entero (los trozos de 32 MB del Worker no caben en Vercel).
class UploadRoute {
  const UploadRoute({
    required this.endpoint,
    required this.chunkBytes,
    required this.worker,
  });

  final Uri endpoint;
  final int chunkBytes;
  final bool worker;

  static final UploadRoute vercel = UploadRoute(
    endpoint: Uri.parse('${kLibraryBase}api/subir'),
    chunkBytes: kVercelChunkBytes,
    worker: false,
  );
}

/// Rutas del API con respaldo en Vercel.
class ApiRoutes {
  ApiRoutes({
    String base = kWorkerApiBase,
    DateTime Function()? clock,
    this.probeTimeout = kWorkerProbeTimeout,
  }) : base = normalizeApiBase(base),
       _clock = clock ?? DateTime.now;

  /// Dirección del Worker ('' si no hay).
  final String base;
  final Duration probeTimeout;
  final DateTime Function() _clock;
  DateTime? _downUntil;

  /// True si ahora mismo se usaría el Worker.
  bool get usesWorker =>
      base.isNotEmpty &&
      (_downUntil == null || !_clock().isBefore(_downUntil!));

  void _markDown() => _downUntil = _clock().add(kRetryWorkerAfter);

  /// [path] ('/api/…') en Vercel.
  Uri vercelUri(String path) => Uri.parse(
    '$kLibraryBase${path.startsWith('/') ? path.substring(1) : path}',
  );

  /// [path] ('/api/…') en el Worker.
  Uri workerUri(String path) => Uri.parse('$base$path');

  static bool isWorkerResponse(http.Response response) =>
      response.headers.containsKey(kWorkerHeader);

  static Future<http.Response> _request(
    http.Client client,
    String method,
    Uri uri, {
    Map<String, String>? headers,
    Object? body,
    required Duration timeout,
  }) {
    final Future<http.Response> future = method == 'GET'
        ? client.get(uri, headers: headers)
        : client.post(uri, headers: headers, body: body);
    return future.timeout(timeout);
  }

  /// Solo el Worker: lanza si no está configurado, no responde o la respuesta no es suya (y lo marca caído).
  Future<http.Response> workerOnly(
    http.Client client,
    String method,
    String path, {
    Map<String, String>? headers,
    Object? body,
    Duration timeout = const Duration(seconds: 20),
  }) async {
    if (!usesWorker) throw StateError('Sin Worker.');
    try {
      final response = await _request(
        client,
        method,
        workerUri(path),
        headers: headers,
        body: body,
        timeout: timeout,
      );
      if (!isWorkerResponse(response)) {
        throw StateError('La respuesta no es del Worker.');
      }
      return response;
    } catch (_) {
      _markDown();
      rethrow;
    }
  }

  /// Envía por el Worker y, si no responde (red, tiempo agotado o una respuesta que no es suya), repite en Vercel; y
  /// durante [kRetryWorkerAfter] va directamente a Vercel. Un error del propio Worker (con su cabecera) se respeta.
  Future<http.Response> send(
    http.Client client,
    String method,
    String path, {
    Map<String, String>? headers,
    Object? body,
    Duration timeout = const Duration(seconds: 60),
  }) async {
    if (usesWorker) {
      try {
        return await workerOnly(
          client,
          method,
          path,
          headers: headers,
          body: body,
          timeout: timeout,
        );
      } catch (_) {
        // Se repite en Vercel.
      }
    }
    return _request(
      client,
      method,
      vercelUri(path),
      headers: headers,
      body: body,
      timeout: timeout,
    );
  }

  /// Dónde subir el próximo archivo: el Worker si responde a /api/salud, si no Vercel.
  Future<UploadRoute> uploadRoute(http.Client client) async {
    if (!usesWorker) return UploadRoute.vercel;
    try {
      final response = await workerOnly(
        client,
        'GET',
        '/api/salud',
        timeout: probeTimeout,
      );
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (response.statusCode == 200 && json is Map && json['ok'] == true) {
        return UploadRoute(
          endpoint: workerUri('/api/subir'),
          chunkBytes: kWorkerChunkBytes,
          worker: true,
        );
      }
      _markDown();
    } catch (_) {
      // Worker caído o lento: Vercel.
    }
    return UploadRoute.vercel;
  }
}

/// Rutas comunes de la app (con [kWorkerApiBase]). No es final solo para las pruebas: test/flutter_test_config.dart la
/// cambia por unas sin Worker, para que ninguna prueba hable con el Worker real.
ApiRoutes apiRoutes = ApiRoutes();
