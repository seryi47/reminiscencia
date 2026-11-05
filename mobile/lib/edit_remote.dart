import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'app_error.dart';
import 'library_requests.dart';
import 'library_store.dart';

/// Guarda un cambio de la biblioteca común. Devuelve el mensaje de confirmación o lanza [AppException].
typedef EditSubmitter = Future<String> Function(LibraryRequest request);

/// Guarda la portada (JPEG) de una canción o un álbum del catálogo.
typedef CoverSubmitter = Future<String> Function(String id, Uint8List jpeg);

/// Función de la web que valida y guarda los cambios (`/api/editar`, ADR-0022). La app no guarda ningún token.
final Uri kEditEndpoint = Uri.parse('${kLibraryBase}api/editar');

const String kEditSavedText =
    'Guardado. Llegará a todos en un par de minutos.';

/// Implementación real de [EditSubmitter].
Future<String> submitLibraryEdit(
  LibraryRequest request, {
  http.Client? client,
}) => _post(
  client,
  {'Content-Type': 'application/json'},
  jsonEncode({'action': 'organize', 'payload': request.payload}),
);

/// Implementación real de [CoverSubmitter].
Future<String> submitCatalogCover(
  String id,
  Uint8List jpeg, {
  http.Client? client,
}) => _post(client, {
  'Content-Type': 'image/jpeg',
  'X-Portada-Id': id,
}, jpeg);

Future<String> _post(
  http.Client? client,
  Map<String, String> headers,
  Object body,
) async {
  final http_ = client ?? http.Client();
  try {
    final response = await http_
        .post(kEditEndpoint, headers: headers, body: body)
        .timeout(const Duration(seconds: 60));
    Map<String, Object?> json = const {};
    try {
      json = (jsonDecode(utf8.decode(response.bodyBytes)) as Map)
          .cast<String, Object?>();
    } catch (_) {}
    if (response.statusCode >= 200 &&
        response.statusCode < 300 &&
        json['ok'] != false) {
      return (json['mensaje'] as String?) ?? kEditSavedText;
    }
    throw AppException(
      (json['error'] as String?) ??
          'No se pudo guardar (código ${response.statusCode}).',
    );
  } on AppException {
    rethrow;
  } catch (_) {
    throw const AppException(
      'No se ha podido conectar. Revisa la conexión y vuelve a intentarlo.',
    );
  } finally {
    if (client == null) http_.close();
  }
}
