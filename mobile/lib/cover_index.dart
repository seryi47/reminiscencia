import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_config.dart';

// Índice de portadas en R2 (ADR-0029), igual que la web (frontend/web/js/cover-index.js). Una portada cambiada por el
// Worker se guarda al momento en el bucket público como portadas/<id>-<hash>.jpg y el índice portadas/indice.json
// ({ id: fichero }) dice cuál vale. La app lo lee sin caché y lo superpone al campo «cover» del catálogo (el índice
// manda): la portada nueva se ve en segundos sin pasar por GitHub.

const String kCoverIndexKey = 'portadas/indice.json';

/// Fichero de una portada en el bucket: `portadas/<S|F + 16 hex>-<16 hex del SHA-256>.jpg`.
final RegExp kCoverKeyPattern = RegExp(
  r'^portadas/([SF][0-9a-f]{16})-[0-9a-f]{16}\.jpg$',
);
final RegExp _coverId = RegExp(r'^[SF][0-9a-f]{16}$');
const int kMaxCoverIndexEntries = 50000;

/// True si [key] es un fichero de portada válido y, si se da [id], de ese id.
bool isCoverKey(Object? key, [String? id]) {
  if (key is! String) return false;
  final match = kCoverKeyPattern.firstMatch(key);
  return match != null && (id == null || match.group(1) == id);
}

/// True si la ruta de portada [path] es de [id]: `covers/<id>.jpg` o `portadas/<id>-<hash>.jpg`.
bool coverPathIsFor(String? path, String? id) {
  if (path == null || id == null) return false;
  return path == 'covers/$id.jpg' || isCoverKey(path, id);
}

/// Índice leído como id → fichero. Lo que no vale se descarta; un índice roto es un índice vacío. Nunca lanza.
Map<String, String> parseCoverIndex(String? body) {
  if (body == null) return const {};
  Object? data;
  try {
    data = jsonDecode(body);
  } catch (_) {
    return const {};
  }
  if (data is! Map) return const {};
  final index = <String, String>{};
  for (final entry in data.entries) {
    if (index.length >= kMaxCoverIndexEntries) break;
    final id = entry.key;
    if (id is String && _coverId.hasMatch(id) && isCoverKey(entry.value, id)) {
      index[id] = entry.value as String;
    }
  }
  return index;
}

/// Copia de las entradas JSON (canciones o álbumes de data/*.json) con «cover» = el fichero del índice para los ids
/// que están en él. Las demás se dejan igual.
List<Object?> applyCoverIndexJson(
  List<Object?> items,
  Map<String, String> index,
) {
  if (index.isEmpty) return items;
  return [
    for (final item in items)
      if (item is Map && index[item['id']] != null)
        {...item.cast<String, Object?>(), 'cover': index[item['id']]}
      else
        item,
  ];
}

/// True si el «cover» de un elemento del catálogo es el fichero [key] (solo o con una dirección delante). Regla común
/// de tests/contrato/ediciones-pendientes.json.
bool isCoverReflected(String? cover, String? key) {
  if (cover == null || key == null || key.isEmpty) return false;
  return cover == key || cover.endsWith('/$key');
}

/// Texto del índice sin caché: primero por el Worker (lee el bucket al momento) y, si no está o no responde, del
/// bucket público ([bucketBase]). null si aún no existe (404). Lanza si no se puede leer.
Future<String?> fetchCoverIndexBody(
  http.Client client, {
  required String bucketBase,
  ApiRoutes? routes,
}) async {
  final api = routes ?? apiRoutes;
  if (api.usesWorker) {
    try {
      final response = await api.workerOnly(client, 'GET', '/api/portadas');
      if (response.statusCode == 200) return utf8.decode(response.bodyBytes);
    } catch (_) {
      // Se prueba con el bucket.
    }
  }
  final response = await client
      .get(
        Uri.parse('$bucketBase$kCoverIndexKey'),
        headers: const {'Cache-Control': 'no-cache'},
      )
      .timeout(const Duration(seconds: 10));
  if (response.statusCode == 404) return null;
  if (response.statusCode != 200) {
    throw http.ClientException('Índice de portadas: ${response.statusCode}');
  }
  return utf8.decode(response.bodyBytes);
}
