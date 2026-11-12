import 'dart:io';

import 'package:ffmpeg_kit_flutter_new_audio/ffmpeg_kit.dart';
import 'package:ffmpeg_kit_flutter_new_audio/ffprobe_kit.dart';
import 'package:ffmpeg_kit_flutter_new_audio/return_code.dart';

import 'app_error.dart';
import 'local_audio.dart';

/// Conversión real a Ogg Opus con FFmpeg (paquete ffmpeg_kit_flutter_new_audio, con libopus).
/// Mismas tasas que la web (ADR-0012): mono 32 kbps y estéreo 48 kbps, a 48 kHz.
/// Las pruebas unitarias no lo ejecutan (necesita el binario nativo); los argumentos se comprobaron con ffmpeg de escritorio.
/// [enforceLimits] aplica los límites de la subida local (60 MB y 20 minutos); la subida para todos no tiene
/// tamaño máximo, porque se envía en trozos.
class FfmpegOpusConverter implements AudioConverter {
  const FfmpegOpusConverter({this.enforceLimits = true});

  final bool enforceLimits;

  static const String _readError =
      'No se puede leer este archivo. Comprueba que es audio válido (WAV, MP3, M4A, FLAC u OGG).';

  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) async {
    final input = File(inputPath);
    if (!await input.exists()) throw const AppException(_readError);
    final bytes = await input.length();
    if (bytes <= 0) throw const AppException('El archivo está vacío.');
    if (enforceLimits) {
      final sizeProblem = checkFileLimits(bytes: bytes);
      if (sizeProblem != null) throw AppException(sizeProblem);
    }

    final probe = await _probe(inputPath);
    if (enforceLimits) {
      final durationProblem = checkFileLimits(
        bytes: bytes,
        durationS: probe.durationS,
      );
      if (durationProblem != null) throw AppException(durationProblem);
    }

    final format = localFormatFor(probe.channels);
    final session = await FFmpegKit.executeWithArguments([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:a:0',
      '-vn',
      '-map_metadata',
      '-1',
      '-c:a',
      'libopus',
      '-b:a',
      '${format.bitrate}',
      '-ac',
      '${format.channels}',
      '-ar',
      '$kOpusRate',
      '-metadata',
      'title=$title',
      '-f',
      'ogg',
      outputPath,
    ]);
    final code = await session.getReturnCode();
    final output = File(outputPath);
    if (!ReturnCode.isSuccess(code) || !await output.exists()) {
      if (await output.exists()) await output.delete();
      throw const AppException('No se pudo convertir este archivo a Opus.');
    }
    final outputBytes = await output.length();
    if (outputBytes == 0) {
      await output.delete();
      throw const AppException('No se pudo convertir este archivo a Opus.');
    }
    return ConvertedAudio(
      durationS: probe.durationS,
      channels: format.channels,
      bitrate: format.bitrate,
      bytes: outputBytes,
    );
  }

  @override
  Future<void> cancel() => FFmpegKit.cancel();

  Future<_Probe> _probe(String path) async {
    final session = await FFprobeKit.getMediaInformation(path);
    final info = session.getMediaInformation();
    final durationS = double.tryParse(info?.getDuration() ?? '') ?? 0;
    final audio = (info?.getStreams() ?? const [])
        .where((stream) => stream.getType() == 'audio')
        .toList();
    if (audio.isEmpty || !(durationS > 0)) {
      // Se incluye el tamaño para diagnosticar: si es pequeño, el archivo llegó truncado; si es grande, llegó entero
      // pero no se pudo leer la pista de audio.
      var size = -1;
      try {
        size = await File(path).length();
      } catch (_) {}
      throw AppException(
        'No se puede leer este archivo ($size bytes). Comprueba que es '
        'audio válido (WAV, MP3, M4A, FLAC u OGG).',
      );
    }
    final channels = audio.first.getAllProperties()?['channels'];
    return _Probe(
      durationS: durationS,
      channels: channels is num ? channels.toInt() : 2,
    );
  }
}

class _Probe {
  const _Probe({required this.durationS, required this.channels});

  final double durationS;
  final int channels;
}

/// Duración de un archivo de audio en segundos, o null si no se puede leer. La usa el aviso de duplicados de
/// «Subir canciones» antes de poner los archivos en la cola (ADR-0026); un fallo nunca impide subir.
Future<double?> probeAudioDurationS(String path) async {
  try {
    final session = await FFprobeKit.getMediaInformation(path);
    final value = double.tryParse(
      session.getMediaInformation()?.getDuration() ?? '',
    );
    return value != null && value.isFinite && value > 0 ? value : null;
  } catch (_) {
    return null;
  }
}
