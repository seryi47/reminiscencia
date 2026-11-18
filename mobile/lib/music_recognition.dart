import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'dart:typed_data';

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
  const RecognitionProgress(this.status, {this.message = '', this.elapsedSeconds, this.songId, this.title, this.artist, this.confidence, this.reason = ''});
  final RecognitionStatus status;
  final String message;
  final int? elapsedSeconds;
  final String? songId;
  final String? title;
  final String? artist;
  final double? confidence;
  /// Motivo máquina-legible asociado al progreso (`mic_permanently_denied`, `db_not_ready`, ...). La UI decide qué
  /// acción ofrecer basándose en esto, nunca en el texto del mensaje.
  final String reason;
}

class RecognitionResult {
  const RecognitionResult({
    required this.matched,
    this.songId,
    this.title,
    this.artist,
    this.confidence = 0,
    this.reason = '',
    this.source = '',
  });
  final bool matched;
  final String? songId;
  final String? title;
  final String? artist;
  final double confidence;
  /// Motivo informativo cuando `matched = false` (p. ej. `db_not_ready`, `no_lyrics_match`). Vacío si no se conoce.
  final String reason;
  /// Vía por la que llegó el match: 'library' (D1) o 'lyrics' (Whisper + LRClib).
  final String source;
}

/// Duración de la captura. 8 s es el sweet spot: más corto = menos hashes; más largo = más batería y UX lenta.
const int kRecognitionSeconds = 8;

/// Endpoints del Worker. En pruebas se pueden cambiar.
String recognizeEndpoint = '$kWorkerApiBase/api/recognize';
String recognizeLyricsEndpoint = '$kWorkerApiBase/api/recognize-lyrics';

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
      } on MicPermissionDenied catch (e) {
        final reason = e.permanent ? 'mic_permanently_denied' : 'mic_denied';
        final msg = e.permanent
            ? 'El permiso del micrófono está desactivado. Ábrelo en Ajustes → Permisos → Micrófono.'
            : 'Sin permiso del micrófono.';
        onProgress?.call(RecognitionProgress(RecognitionStatus.error, message: msg, reason: reason));
        return RecognitionResult(matched: false, reason: reason);
      }

      onProgress?.call(const RecognitionProgress(RecognitionStatus.listening, message: 'Escuchando…'));
      final capture = await _mic.record(seconds: kRecognitionSeconds, cancel: cancel);

      onProgress?.call(const RecognitionProgress(RecognitionStatus.analyzing, message: 'Analizando…'));
      final hashes = fingerprint(capture.samples);
      if (hashes.isEmpty) {
        onProgress?.call(const RecognitionProgress(RecognitionStatus.notMatched, message: 'No se pudo analizar el audio.'));
        return const RecognitionResult(matched: false);
      }

      onProgress?.call(const RecognitionProgress(RecognitionStatus.querying, message: 'Consultando la biblioteca…'));
      final libraryResult = await _query(hashes);

      if (libraryResult.matched) {
        onProgress?.call(RecognitionProgress(
          RecognitionStatus.matched,
          message: 'Identificada: ${libraryResult.title}',
          songId: libraryResult.songId,
          title: libraryResult.title,
          artist: libraryResult.artist,
          confidence: libraryResult.confidence,
        ));
        return RecognitionResult(
          matched: true,
          songId: libraryResult.songId,
          title: libraryResult.title,
          artist: libraryResult.artist,
          confidence: libraryResult.confidence,
          source: 'library',
        );
      }

      // Vía 2: letras con Whisper + LRClib (ADR-0048). Para canciones que no están en la biblioteca.
      onProgress?.call(const RecognitionProgress(
        RecognitionStatus.querying,
        message: 'No está en tu biblioteca. Probando a entender la letra…',
      ));
      final lyricsResult = await _queryLyrics(capture.wavBytes);
      if (lyricsResult.matched) {
        onProgress?.call(RecognitionProgress(
          RecognitionStatus.matched,
          message: 'Identificada por letra: ${lyricsResult.title}',
          title: lyricsResult.title,
          artist: lyricsResult.artist,
          confidence: lyricsResult.confidence,
        ));
        return lyricsResult;
      }

      final String msg;
      switch (libraryResult.reason) {
        case 'db_not_ready':
          msg = 'La base de huellas aún no está cargada en el servidor.'; break;
        case 'db_query_failed':
          msg = 'Fallo transitorio al consultar la biblioteca; vuelve a intentarlo en un momento.'; break;
        default:
          msg = 'No he podido identificar la canción.';
      }
      onProgress?.call(RecognitionProgress(RecognitionStatus.notMatched, message: msg, reason: libraryResult.reason));
      return lyricsResult.matched ? lyricsResult : libraryResult;
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

  /// Segunda vía: manda los bytes WAV al Worker, que los pasa a Whisper y busca la letra en LRClib. Nunca lanza.
  Future<RecognitionResult> _queryLyrics(Uint8List wavBytes) async {
    try {
      final response = await _client.post(
        Uri.parse(recognizeLyricsEndpoint),
        headers: {'Content-Type': 'application/octet-stream'},
        body: wavBytes,
      ).timeout(const Duration(seconds: 60));
      if (response.statusCode != 200) return const RecognitionResult(matched: false);
      final data = utf8DecodeMap(response.bodyBytes);
      if (data == null) return const RecognitionResult(matched: false);
      final matched = data['matched'] == true;
      final reason = data['reason'] is String ? data['reason'] as String : '';
      if (!matched) return RecognitionResult(matched: false, reason: reason);
      return RecognitionResult(
        matched: true,
        title: data['title'] is String ? data['title'] as String : null,
        artist: data['artist'] is String ? data['artist'] as String : null,
        confidence: (data['confidence'] as num?)?.toDouble() ?? 0,
        source: 'lyrics',
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

/// Helper que decodifica los bytes de respuesta como UTF-8 JSON Map. Separado para mantener `_queryLyrics` legible.
/// Usa `utf8.decode` (no `String.fromCharCodes`, que trata los bytes como UCS-2 y mojibakea las tildes y la ñ).
Map<String, dynamic>? utf8DecodeMap(List<int> bytes) {
  try {
    final decoded = jsonDecode(utf8.decode(bytes));
    return decoded is Map<String, dynamic> ? decoded : null;
  } catch (_) { return null; }
}
