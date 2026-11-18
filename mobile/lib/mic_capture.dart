import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

import 'fingerprint.dart';

/// Captura un fragmento del micrófono para pasárselo al reconocedor (ADR-0048). Siempre mono, 16 kHz, PCM 16 bits —
/// lo mismo que espera `fingerprint()`. El micrófono SOLO se activa aquí, y se cierra en `stop()` o si tira una
/// excepción. No persiste nada: el fichero temporal se borra al leer sus bytes.

class MicPermissionDenied implements Exception {
  const MicPermissionDenied();
  @override
  String toString() => 'Sin permiso del micrófono.';
}

class MicCaptureAborted implements Exception {
  const MicCaptureAborted();
  @override
  String toString() => 'Captura cancelada.';
}

/// Lo que devuelve el micrófono tras una captura (ADR-0048): muestras ya decodificadas para la huella Shazam-style y
/// bytes del WAV originales por si la segunda vía (letras vía Whisper) los necesita.
class MicCaptureResult {
  const MicCaptureResult({required this.samples, required this.wavBytes});
  final Float32List samples;
  final Uint8List wavBytes;
}

class MicCapture {
  MicCapture({AudioRecorder? recorder}) : _recorder = recorder ?? AudioRecorder();

  final AudioRecorder _recorder;
  File? _lastFile;

  /// Pide permiso si hace falta. Lanza [MicPermissionDenied] si el usuario lo niega.
  Future<void> ensurePermission() async {
    if (await Permission.microphone.isGranted) return;
    final status = await Permission.microphone.request();
    if (!status.isGranted) throw const MicPermissionDenied();
  }

  /// Graba [seconds] segundos del micrófono y devuelve muestras Float32 + bytes WAV.
  /// Si se completa [cancel] antes de terminar, aborta y lanza [MicCaptureAborted]. Nunca deja el micrófono abierto.
  Future<MicCaptureResult> record({
    required int seconds,
    Future<void>? cancel,
  }) async {
    await ensurePermission();
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/mic-${DateTime.now().microsecondsSinceEpoch}.wav';
    _lastFile = File(path);
    final config = RecordConfig(
      encoder: AudioEncoder.wav,
      sampleRate: kFingerprintSampleRate,
      numChannels: 1,
      bitRate: kFingerprintSampleRate * 16,
    );
    final completer = Completer<void>();
    Timer? timer;
    StreamSubscription<void>? cancelSub;
    try {
      await _recorder.start(config, path: path);
      timer = Timer(Duration(seconds: seconds), () { if (!completer.isCompleted) completer.complete(); });
      if (cancel != null) {
        cancelSub = cancel.asStream().listen((_) {
          if (!completer.isCompleted) completer.completeError(const MicCaptureAborted());
        });
      }
      await completer.future;
    } finally {
      timer?.cancel();
      await cancelSub?.cancel();
      try { await _recorder.stop(); } catch (_) {}
    }
    final bytes = await _lastFile!.readAsBytes();
    try { await _lastFile!.delete(); } catch (_) {}
    final samples = _wavToFloat32(bytes);
    return MicCaptureResult(samples: samples, wavBytes: bytes);
  }

  /// Libera recursos del grabador. Seguro llamar varias veces.
  Future<void> dispose() async {
    try { await _recorder.stop(); } catch (_) {}
    try { await _recorder.dispose(); } catch (_) {}
    try { if (_lastFile != null && await _lastFile!.exists()) await _lastFile!.delete(); } catch (_) {}
  }
}

/// Lee los datos PCM 16-LE de un WAV mono @ 16 kHz y devuelve Float32 [-1, 1]. No valida la cabecera a fondo; busca el
/// chunk `data` y descarga el resto como PCM. Si no encuentra el chunk, usa todo tras los 44 bytes típicos.
Float32List _wavToFloat32(Uint8List bytes) {
  var dataStart = 44;
  var dataEnd = bytes.length;
  // Busca el chunk `data` a mano (algunas implementaciones meten chunks LIST/INFO en medio).
  for (var i = 12; i + 8 < bytes.length - 4; i++) {
    if (bytes[i] == 0x64 && bytes[i + 1] == 0x61 && bytes[i + 2] == 0x74 && bytes[i + 3] == 0x61) { // "data"
      final size = ByteData.sublistView(bytes, i + 4, i + 8).getUint32(0, Endian.little);
      dataStart = i + 8;
      dataEnd = dataStart + size;
      break;
    }
  }
  final pcm = bytes.sublist(dataStart, dataEnd.clamp(dataStart, bytes.length));
  return pcm16leToFloat32(pcm);
}
