import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_config.dart';
import 'fingerprint.dart';
import 'mic_capture.dart';

/// Reconocedor musical propio (ADR-0048). Captura un fragmento del micro, calcula la huella Shazam-style y la manda al
/// Worker para buscarla en nuestra biblioteca pre-huellada. Si hay match, devuelve la canción ya existente.

enum RecognitionStatus {
  idle,
  requestingPermission,
  listening,
  analyzing,
  querying,
  matched,
  notMatched,
  error,
}

class RecognitionProgress {
  const RecognitionProgress(this.status, {this.message = '', this.elapsedSeconds, this.songId, this.title, this.artist, this.confidence});
  final RecognitionStatus status;
  final String message;
  final int? elapsedSeconds;
  final String? songId;
  final String? title;
  final String? artist;
  final double? confidence;
}

class RecognitionResult {
  const RecognitionResult({required this.matched, this.songId, this.title, this.artist, this.confidence = 0, this.reason = ''});
  final bool matched;
  final String? songId;
  final String? title;
  final String? artist;
  final double confidence;
  /// Motivo informativo cuando `matched = false` (p. ej. `db_not_ready`). Vacío si no se conoce.
  final String reason;
}

/// Duración de la captura. 8 s es el sweet spot: más corto = menos hashes; más largo = más batería y UX lenta.
const int kRecognitionSeconds = 8;

/// Endpoint del Worker. En pruebas se puede cambiar.
String recognizeEndpoint = '$kWorkerApiBase/api/recognize';

class MusicRecognizer {
  MusicRecognizer({MicCapture? mic, http.Client? client}) : _mic = mic ?? MicCapture(), _client = client ?? http.Client();

  final MicCapture _mic;
  final http.Client _client;

  /// Hace una pasada entera: micro → huella → consulta. Avisa por [onProgress] en cada cambio de estado. [cancel] (si se
  /// completa) aborta la captura. Nunca lanza: devuelve un resultado con `matched: false` y el motivo.
  Future<RecognitionResult> recognize({
    void Function(RecognitionProgress)? onProgress,
    Future<void>? cancel,
  }) async {
    try {
      onProgress?.call(const RecognitionProgress(RecognitionStatus.requestingPermission));
      try {
        await _mic.ensurePermission();
      } on MicPermissionDenied {
        onProgress?.call(const RecognitionProgress(RecognitionStatus.error, message: 'Sin permiso del micrófono.'));
        return const RecognitionResult(matched: false);
      }

      onProgress?.call(const RecognitionProgress(RecognitionStatus.listening, message: 'Escuchando…'));
      final samples = await _mic.record(seconds: kRecognitionSeconds, cancel: cancel);

      onProgress?.call(const RecognitionProgress(RecognitionStatus.analyzing, message: 'Analizando…'));
      final hashes = fingerprint(samples);
      if (hashes.isEmpty) {
        onProgress?.call(const RecognitionProgress(RecognitionStatus.notMatched, message: 'No se pudo analizar el audio.'));
        return const RecognitionResult(matched: false);
      }

      onProgress?.call(const RecognitionProgress(RecognitionStatus.querying, message: 'Consultando la biblioteca…'));
      final result = await _query(hashes);

      if (result.matched) {
        onProgress?.call(RecognitionProgress(
          RecognitionStatus.matched,
          message: 'Identificada: ${result.title}',
          songId: result.songId,
          title: result.title,
          artist: result.artist,
          confidence: result.confidence,
        ));
      } else {
        final msg = result.reason == 'db_not_ready'
            ? 'La base de huellas aún no está cargada en el servidor.'
            : 'No está en tu biblioteca.';
        onProgress?.call(RecognitionProgress(RecognitionStatus.notMatched, message: msg));
      }
      return result;
    } on MicCaptureAborted {
      onProgress?.call(const RecognitionProgress(RecognitionStatus.idle, message: 'Cancelado.'));
      return const RecognitionResult(matched: false);
    } catch (error) {
      onProgress?.call(RecognitionProgress(RecognitionStatus.error, message: 'Fallo: $error'));
      return const RecognitionResult(matched: false);
    }
  }

  Future<RecognitionResult> _query(List<FingerprintHash> hashes) async {
    // Serializa los hashes como dos arrays paralelos (clave + offset) para no mandar un objeto por hash.
    final keys = <int>[];
    final offsets = <int>[];
    for (final h in hashes) {
      keys.add(h.hash);
      offsets.add(h.offset);
    }
    try {
      final response = await _client.post(
        Uri.parse(recognizeEndpoint),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'v': 1, 'hashes': keys, 'offsets': offsets}),
      ).timeout(const Duration(seconds: 20));
      if (response.statusCode != 200) return const RecognitionResult(matched: false);
      final data = jsonDecode(response.body);
      if (data is! Map) return const RecognitionResult(matched: false);
      final matched = data['matched'] == true;
      final reason = data['reason'] is String ? data['reason'] as String : '';
      if (!matched) return RecognitionResult(matched: false, reason: reason);
      return RecognitionResult(
        matched: true,
        songId: data['songId'] is String ? data['songId'] as String : null,
        title: data['title'] is String ? data['title'] as String : null,
        artist: data['artist'] is String ? data['artist'] as String : null,
        confidence: (data['confidence'] as num?)?.toDouble() ?? 0,
      );
    } catch (_) {
      return const RecognitionResult(matched: false);
    }
  }

  Future<void> dispose() async {
    await _mic.dispose();
    _client.close();
  }
}
