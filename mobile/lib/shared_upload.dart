import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'app_error.dart';
import 'library_store.dart';
import 'local_audio.dart';

/// Subida «para todos»: cada archivo se convierte a Ogg Opus en el teléfono y se envía, en trozos, a la función
/// de la web (`/api/subir`), que lo guarda en el buzón del repositorio con el token del servidor. La app no guarda
/// ni ve ningún token: hace las mismas peticiones que la web. No hay tamaño máximo por archivo.

/// Función de la web que recibe los trozos.
final Uri kUploadEndpoint = Uri.parse('${kLibraryBase}api/subir');

/// Tamaño de cada trozo (4 MB): Vercel acepta como máximo 4,5 MB por petición.
const int kUploadChunkBytes = 4 * 1024 * 1024;

/// Cabeceras de cada trozo.
const String kUploadNameHeader = 'X-Nombre-Archivo';
const String kUploadIdHeader = 'X-Subida-Id';
const String kUploadPartHeader = 'X-Parte';
const String kUploadPartsHeader = 'X-Partes';

/// Texto fijo junto al botón. No hay casilla ni confirmación.
const String kUploadRightsNotice =
    'Al subir, declaras que tienes derecho a publicar estos archivos.';

const String kUploadedMessage = 'Subida: llegará a todos en un par de minutos.';

const String kOfflineMessage =
    'No hay conexión a internet. Conéctate y vuelve a intentarlo; no se ha subido nada.';

const String _pausedMessage =
    'pendiente: la subida se paró al salir de la app. Vuelve a subirlo.';
const String _lostConnectionMessage =
    'pendiente: se perdió la conexión. Vuelve a subirlo cuando tengas red.';

/// Tiempo máximo de cada petición. Un trozo de 4 MB con mala cobertura cabe de sobra.
const Duration kUploadTimeout = Duration(seconds: 90);

/// ¿Hay alguna red (Wi-Fi, datos o cable)? Se consulta una vez antes de subir, nunca en bucle.
typedef ConnectionCheck = Future<bool> Function();

/// Nombre original del archivo codificado igual que `encodeURIComponent` de JavaScript
/// (Dart deja sin codificar las mismas letras, cifras y `-_.!~*'()`).
String encodeUploadName(String name) => Uri.encodeComponent(name);

/// UUID versión 4 a partir de 16 bytes aleatorios.
String uuidV4(Random random) {
  final b = List<int>.generate(16, (_) => random.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final hex = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-${hex.substring(20)}';
}

enum UploadOutcome {
  /// La función la guardó en el buzón.
  uploaded,

  /// No se pudo convertir o la función la rechazó.
  failed,

  /// No se intentó: se perdió la conexión o se salió de la app antes de llegar a ella.
  pending,
}

/// Resultado de un archivo.
@immutable
class UploadItemResult {
  const UploadItemResult({
    required this.name,
    required this.title,
    required this.outcome,
    required this.message,
  });

  /// Nombre del archivo elegido.
  final String name;

  /// Título de la canción: el nombre sin extensión.
  final String title;
  final UploadOutcome outcome;

  /// Mensaje para la persona, en español.
  final String message;
}

@immutable
class SharedUploadResult {
  const SharedUploadResult(this.items);

  final List<UploadItemResult> items;

  int get uploaded =>
      items.where((item) => item.outcome == UploadOutcome.uploaded).length;
}

/// Lo que se está haciendo ahora: convertir un archivo o enviar uno de sus trozos.
@immutable
class UploadProgress {
  const UploadProgress({
    required this.index,
    required this.total,
    required this.title,
    this.part,
    this.parts,
  });

  /// Posición del archivo (desde 0) y número de archivos.
  final int index;
  final int total;
  final String title;

  /// Trozo que se envía (desde 0) y número de trozos. Null mientras se convierte.
  final int? part;
  final int? parts;

  bool get sending => part != null;

  /// Texto para la interfaz.
  String describe() {
    final position = '${index + 1} de $total';
    if (!sending) return 'Convirtiendo $position: $title';
    final count = parts ?? 1;
    final piece = count > 1 ? ' (parte ${part! + 1} de $count)' : '';
    return 'Subiendo $position: $title$piece';
  }
}

/// Resumen corto para el aviso inferior.
String describeUploadResult(SharedUploadResult result) {
  final total = result.items.length;
  final done = result.uploaded;
  if (total == 0) return 'No se subió ningún archivo.';
  if (done == total) {
    return total == 1
        ? kUploadedMessage
        : 'Subidas $total canciones: llegarán a todos en un par de minutos.';
  }
  if (done == 0) {
    return total == 1
        ? 'No se pudo subir el archivo.'
        : 'No se pudo subir ninguno de los $total archivos.';
  }
  return 'Subidas $done de $total canciones.';
}

/// Error de conexión o de servidor: el trozo se reintenta una vez como máximo.
class _RetryableUploadError implements Exception {
  const _RetryableUploadError(this.message, {required this.connection});

  final String message;

  /// True si falló la red (los archivos siguientes no se intentan).
  final bool connection;
}

/// Convierte y sube archivos de uno en uno, y cada archivo trozo a trozo, en orden.
/// Un fallo no para a los demás archivos, salvo si se pierde la conexión.
class SharedUploader {
  SharedUploader({
    required this.client,
    required this.converter,
    required this.hasConnection,
    Future<Directory> Function()? workDir,
    this.endpoint,
    this.retryDelay = const Duration(seconds: 3),
    this.timeout = kUploadTimeout,
    this.chunkBytes = kUploadChunkBytes,
    Random? random,
  }) : _workDir = workDir ?? _tempDir,
       _random = random ?? Random.secure();

  final http.Client client;
  final AudioConverter converter;
  final ConnectionCheck hasConnection;
  final Uri? endpoint;

  /// Espera antes del único reintento de un trozo.
  final Duration retryDelay;
  final Duration timeout;

  /// Tamaño de los trozos. Solo se cambia en pruebas.
  final int chunkBytes;
  final Future<Directory> Function() _workDir;
  final Random _random;
  bool _cancelled = false;

  static Future<Directory> _tempDir() async {
    final temp = await getTemporaryDirectory();
    return Directory('${temp.path}/subida');
  }

  /// Para la conversión en curso (al salir de la app). Lo que falte queda pendiente.
  Future<void> cancel() async {
    _cancelled = true;
    await converter.cancel();
  }

  /// Sube [files]. Sin red, lanza AppException y no intenta nada.
  Future<SharedUploadResult> upload(
    List<PickedAudioFile> files, {
    void Function(UploadProgress progress)? onProgress,
  }) async {
    if (files.isEmpty) return const SharedUploadResult([]);
    if (!await hasConnection()) throw const AppException(kOfflineMessage);
    _cancelled = false;
    final dir = await _workDir();
    await dir.create(recursive: true);
    final items = <UploadItemResult>[];
    String? stopReason;
    for (var index = 0; index < files.length; index += 1) {
      final file = files[index];
      final title = titleFromFileName(file.name);
      if (_cancelled) stopReason ??= _pausedMessage;
      if (stopReason != null) {
        items.add(_item(file, title, UploadOutcome.pending, stopReason));
        continue;
      }
      final output = File('${dir.path}/${uuidV4(_random)}.opus');
      try {
        onProgress?.call(
          UploadProgress(index: index, total: files.length, title: title),
        );
        try {
          await converter.convert(
            inputPath: file.path,
            outputPath: output.path,
            title: title,
          );
        } catch (error) {
          if (!_cancelled) rethrow;
          stopReason = _pausedMessage;
          items.add(_item(file, title, UploadOutcome.pending, stopReason));
          continue;
        }
        await _sendFile(
          output,
          file.name,
          (part, parts) => onProgress?.call(
            UploadProgress(
              index: index,
              total: files.length,
              title: title,
              part: part,
              parts: parts,
            ),
          ),
        );
        items.add(_item(file, title, UploadOutcome.uploaded, kUploadedMessage));
      } on _RetryableUploadError catch (error) {
        items.add(_item(file, title, UploadOutcome.failed, error.message));
        if (error.connection) stopReason = _lostConnectionMessage;
      } catch (error) {
        items.add(
          _item(
            file,
            title,
            UploadOutcome.failed,
            error is AppException
                ? error.message
                : 'error inesperado al preparar el archivo.',
          ),
        );
      } finally {
        await _deleteQuietly(output);
      }
    }
    return SharedUploadResult(items);
  }

  UploadItemResult _item(
    PickedAudioFile file,
    String title,
    UploadOutcome outcome,
    String message,
  ) => UploadItemResult(
    name: file.name,
    title: title,
    outcome: outcome,
    message: message,
  );

  static Future<void> _deleteQuietly(File file) async {
    try {
      if (await file.exists()) await file.delete();
    } catch (error) {
      debugPrint('subida: no se pudo borrar el temporal: $error');
    }
  }

  /// Envía el Opus en trozos, en orden y con el mismo X-Subida-Id. Lee un trozo cada vez: no carga el archivo entero.
  Future<void> _sendFile(
    File opus,
    String name,
    void Function(int part, int parts) onPart,
  ) async {
    final length = await opus.length();
    if (length == 0) {
      throw const AppException('el audio convertido está vacío.');
    }
    final parts = (length + chunkBytes - 1) ~/ chunkBytes;
    final id = uuidV4(_random);
    final reader = await opus.open();
    try {
      for (var part = 0; part < parts; part += 1) {
        await reader.setPosition(part * chunkBytes);
        final bytes = await reader.read(chunkBytes);
        onPart(part, parts);
        await _sendWithOneRetry({
          'Content-Type': 'audio/ogg',
          kUploadNameHeader: encodeUploadName(name),
          kUploadIdHeader: id,
          kUploadPartHeader: '$part',
          kUploadPartsHeader: '$parts',
        }, bytes);
      }
    } finally {
      await reader.close();
    }
  }

  /// Un intento y, si falla la red o el servidor (5xx), un único reintento. Un rechazo (4xx) no se reintenta.
  Future<void> _sendWithOneRetry(
    Map<String, String> headers,
    Uint8List bytes,
  ) async {
    try {
      await _send(headers, bytes);
    } on _RetryableUploadError {
      if (retryDelay > Duration.zero) await Future<void>.delayed(retryDelay);
      await _send(headers, bytes);
    }
  }

  Future<void> _send(Map<String, String> headers, Uint8List bytes) async {
    final http.Response response;
    try {
      response = await client
          .post(endpoint ?? kUploadEndpoint, headers: headers, body: bytes)
          .timeout(timeout);
    } on TimeoutException {
      throw const _RetryableUploadError(
        'la web tardó demasiado en responder.',
        connection: true,
      );
    } on SocketException {
      throw const _RetryableUploadError(
        'no hay conexión con la web.',
        connection: true,
      );
    } on http.ClientException {
      throw const _RetryableUploadError(
        'no hay conexión con la web.',
        connection: true,
      );
    }
    final reply = _decode(response.body);
    final status = response.statusCode;
    if (status >= 200 && status < 300 && reply?['ok'] == true) return;
    final error = reply?['error'];
    final message = error is String && error.trim().isNotEmpty
        ? error.trim()
        : 'la web no aceptó el archivo (código $status).';
    if (status >= 500) throw _RetryableUploadError(message, connection: false);
    throw AppException(message);
  }

  static Map<String, dynamic>? _decode(String body) {
    try {
      final decoded = jsonDecode(body);
      return decoded is Map<String, dynamic> ? decoded : null;
    } on FormatException {
      return null;
    }
  }
}
