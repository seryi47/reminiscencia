// Cliente del preflight de cache R2 de YouTube para la APK (ADR-0052).
// La APK va directa a yttowav para convert/status/download (ADR-0045), pero puede consultar PRIMERO al Worker
// si los vídeos de la playlist ya están cacheados en R2. Los hits se descargan directamente del Worker
// (`/api/youtube/download?jobId=cached:<id>`), ahorrando la conversión de yttowav.

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Resultado del preflight.
class YoutubeCacheCheckResult {
  const YoutubeCacheCheckResult({
    required this.hits,
    required this.misses,
    required this.invalid,
  });

  /// Vídeos ya convertidos y en R2. Descárgalos directamente con jobId=`cached:<videoId>`.
  final List<YoutubeCacheHit> hits;

  /// Vídeos no cacheados. Hay que convertirlos con el flujo normal (yttowav).
  final List<YoutubeCacheMiss> misses;

  /// URLs que no son de YouTube.
  final List<String> invalid;

  double get hitRate {
    final total = hits.length + misses.length;
    return total == 0 ? 0 : hits.length / total;
  }

  bool get allCached => misses.isEmpty && hits.isNotEmpty;
  bool get noneCached => hits.isEmpty;
}

class YoutubeCacheHit {
  const YoutubeCacheHit({required this.url, required this.videoId, this.sizeBytes, this.durationS, this.title});
  final String url;
  final String videoId;
  final int? sizeBytes;
  final int? durationS;
  final String? title;

  /// jobId sintético para pedir al Worker `/api/youtube/status` y `/api/youtube/download`.
  String get jobId => 'cached:$videoId';
}

class YoutubeCacheMiss {
  const YoutubeCacheMiss({required this.url, required this.videoId});
  final String url;
  final String videoId;
}

/// Pregunta al Worker qué URLs de YouTube ya están cacheadas en R2. Nunca lanza: ante error devuelve todo como miss.
Future<YoutubeCacheCheckResult> youtubeCacheCheck(
  List<String> urls, {
  required Uri workerBase,
  http.Client? client,
  Duration timeout = const Duration(seconds: 6),
}) async {
  if (urls.isEmpty) {
    return const YoutubeCacheCheckResult(hits: [], misses: [], invalid: []);
  }
  final ownClient = client == null;
  final c = client ?? http.Client();
  try {
    final response = await c
        .post(
          workerBase.resolve('/api/youtube/cache/check'),
          headers: const {'Content-Type': 'application/json'},
          body: jsonEncode({'urls': urls}),
        )
        .timeout(timeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return _allMisses(urls);
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final hits = ((data['hits'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map((h) => YoutubeCacheHit(
              url: (h['url'] as String?) ?? '',
              videoId: (h['videoId'] as String?) ?? '',
              sizeBytes: (h['size_bytes'] as num?)?.toInt(),
              durationS: (h['duration_s'] as num?)?.toInt(),
              title: h['title'] as String?,
            ))
        .where((h) => h.videoId.isNotEmpty)
        .toList(growable: false);
    final misses = ((data['misses'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map((m) => YoutubeCacheMiss(
              url: (m['url'] as String?) ?? '',
              videoId: (m['videoId'] as String?) ?? '',
            ))
        .where((m) => m.videoId.isNotEmpty)
        .toList(growable: false);
    final invalid = ((data['invalid'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map((i) => (i['url'] as String?) ?? '')
        .where((s) => s.isNotEmpty)
        .toList(growable: false);
    return YoutubeCacheCheckResult(hits: hits, misses: misses, invalid: invalid);
  } catch (_) {
    return _allMisses(urls);
  } finally {
    if (ownClient) c.close();
  }
}

YoutubeCacheCheckResult _allMisses(List<String> urls) {
  return YoutubeCacheCheckResult(
    hits: const [],
    misses: urls.map((u) => YoutubeCacheMiss(url: u, videoId: '')).toList(growable: false),
    invalid: const [],
  );
}

/// Concurrencia recomendada para descargar según venga de cache (R2) o de yttowav.
int concurrencyFor({required bool cached}) => cached ? 8 : 2;
