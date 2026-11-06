import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'api_config.dart';
import 'app_error.dart';
import 'cover_index.dart';
import 'library_requests.dart';
import 'library_store.dart';

/// Respuesta de /api/editar a un cambio aceptado: el mensaje para la persona, el número de la incidencia que lo
/// aplicará (null en las portadas, que no abren incidencia) y, si la portada la guardó el Worker de Cloudflare
/// (ADR-0029), su fichero en R2 (`portadas/<id>-<hash>.jpg`), con el que se confirma en cuanto el índice la refleja.
@immutable
class EditReceipt {
  const EditReceipt({required this.message, this.issue, this.cover});

  final String message;
  final int? issue;
  final String? cover;
}

/// Guarda un cambio de la biblioteca común. Devuelve el recibo o lanza [AppException].
typedef EditSubmitter = Future<EditReceipt> Function(LibraryRequest request);

/// Guarda la portada (JPEG) de una canción o un álbum del catálogo.
typedef CoverSubmitter =
    Future<EditReceipt> Function(String id, Uint8List jpeg);

/// Estado de una edición enviada (ADR-0027): 'abierta', 'cerrada' o 'error'. Lanza si no se puede saber.
typedef EditStatusFetcher = Future<String> Function(int issue);

/// Estados que devuelve `GET /api/editar?incidencia=N`.
const Set<String> kEditStatuses = {'abierta', 'cerrada', 'error'};

/// Función de la web que valida y guarda los cambios (`/api/editar`, ADR-0022). La app no guarda ningún token. Con el
/// Worker configurado (lib/api_config.dart), la misma ruta va primero a él y, si no responde, a esta.
const String kEditPath = '/api/editar';
final Uri kEditEndpoint = Uri.parse('${kLibraryBase}api/editar');

const String kEditSavedText = 'Guardado. Llegará a todos en un par de minutos.';

/// Implementación real de [EditSubmitter].
Future<EditReceipt> submitLibraryEdit(
  LibraryRequest request, {
  http.Client? client,
  ApiRoutes? routes,
}) => _post(client, routes, {
  'Content-Type': 'application/json',
}, jsonEncode({'action': 'organize', 'payload': request.payload}));

/// Implementación real de [CoverSubmitter].
Future<EditReceipt> submitCatalogCover(
  String id,
  Uint8List jpeg, {
  http.Client? client,
  ApiRoutes? routes,
}) => _post(
  client,
  routes,
  {'Content-Type': 'image/jpeg', 'X-Portada-Id': id},
  jpeg,
  coverId: id,
);

Future<EditReceipt> _post(
  http.Client? client,
  ApiRoutes? routes,
  Map<String, String> headers,
  Object body, {
  String? coverId,
}) async {
  final http_ = client ?? http.Client();
  try {
    final response = await (routes ?? apiRoutes).send(
      http_,
      'POST',
      kEditPath,
      headers: headers,
      body: body,
    );
    Map<String, Object?> json = const {};
    try {
      json = (jsonDecode(utf8.decode(response.bodyBytes)) as Map)
          .cast<String, Object?>();
    } catch (_) {}
    if (response.statusCode >= 200 &&
        response.statusCode < 300 &&
        json['ok'] != false) {
      final issue = json['incidencia'];
      final cover = json['portada'];
      return EditReceipt(
        message: (json['mensaje'] as String?) ?? kEditSavedText,
        issue: issue is int && issue > 0 ? issue : null,
        cover: coverId != null && isCoverKey(cover, coverId)
            ? cover as String
            : null,
      );
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

/// Implementación real de [EditStatusFetcher]: `GET /api/editar?incidencia=N`, que consulta GitHub con el token del
/// servidor. Lanza si no hay conexión o la respuesta no vale.
Future<String> fetchEditStatus(
  int issue, {
  http.Client? client,
  ApiRoutes? routes,
}) async {
  if (issue <= 0) throw ArgumentError.value(issue, 'issue');
  final http_ = client ?? http.Client();
  try {
    final response = await (routes ?? apiRoutes).send(
      http_,
      'GET',
      '$kEditPath?incidencia=$issue',
      timeout: const Duration(seconds: 20),
    );
    if (response.statusCode != 200) {
      throw AppException(
        'Estado no disponible (código ${response.statusCode}).',
      );
    }
    final json = jsonDecode(utf8.decode(response.bodyBytes));
    final state = json is Map ? json['estado'] : null;
    if (state is! String || !kEditStatuses.contains(state)) {
      throw const AppException('Respuesta de estado no válida.');
    }
    return state;
  } finally {
    if (client == null) http_.close();
  }
}
