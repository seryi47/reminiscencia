import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'api_config.dart';
import 'app_error.dart';
import 'library_store.dart';
import 'local_audio.dart';
import 'zip_audio.dart';

/// Subida «para todos»: cada archivo se convierte a Ogg Opus en el teléfono y se envía, en trozos, a la función
/// de la web (`/api/subir`), que lo guarda en el buzón del repositorio con el token del servidor. La app no guarda
/// ni ve ningún token: hace las mismas peticiones que la web. No hay tamaño máximo por archivo.
///
/// Canalización (ADR-0030, igual que la web): mientras se envía un archivo ya se convierte el siguiente, y se envían
/// hasta [kMaxParallelSends] archivos a la vez (los trozos de cada uno, en orden). Como mucho hay
/// [kMaxConvertedWaiting] archivo convertido esperando hueco. Cada subida lleva un UUID versión 7
/// ([OrderedUploadIds]) sacado en el orden de la cola: el buzón cataloga por ese orden aunque terminen desordenadas.

/// Función de la web que recibe los trozos (Vercel). Con el Worker de Cloudflare (ADR-0029), [SharedUploader.route]
/// apunta a él y los trozos son de 32 MB; lo decide quien sube antes de cada tanda (lib/api_config.dart).
final Uri kUploadEndpoint = Uri.parse('${kLibraryBase}api/subir');

/// Tamaño de cada trozo por Vercel (4 MB): Vercel acepta como máximo 4,5 MB por petición. Por el Worker,
/// [kWorkerChunkBytes] (32 MB).
const int kUploadChunkBytes = kVercelChunkBytes;

/// Cabeceras de cada trozo.
const String kUploadNameHeader = 'X-Nombre-Archivo';
const String kUploadIdHeader = 'X-Subida-Id';
const String kUploadPartHeader = 'X-Parte';
const String kUploadPartsHeader = 'X-Partes';
const String kUploadAlbumIdHeader = 'X-Album-Id';
const String kUploadAlbumNameHeader = 'X-Album-Name';
const String kUploadArtistHeader = 'X-Artista-Cancion';

/// Texto fijo junto al botón. No hay casilla ni confirmación.
const String kUploadRightsNotice =
    'Al subir, declaras que tienes derecho a publicar estos archivos.';

const String kUploadedMessage = 'Subida: llegará a todos en un par de minutos.';

const String kOfflineMessage =
    'No hay conexión a internet. Conéctate y vuelve a intentarlo; no se ha subido nada.';

/// Motivo corto de «sin red» para el estado de un archivo.
const String kNoConnectionReason = 'no hay conexión a internet.';

/// Motivo de lo que no llegó a subirse porque se salió de la app (lo que estaba en cola también; ADR-0033).
const String kPausedUploadMessage =
    'pendiente: la subida se paró al salir de la app. Vuelve a subirlo.';
const String _lostConnectionMessage =
    'pendiente: se perdió la conexión. Vuelve a subirlo cuando tengas red.';

/// Tiempo máximo de cada petición. Un trozo de 4 MB con mala cobertura cabe de sobra.
const Duration kUploadTimeout = Duration(seconds: 90);

/// Archivos que se envían a la vez (ADR-0030). `/api/subir` exige en orden los trozos de cada archivo, no entre
/// archivos.
const int kMaxParallelSends = 2;

/// Archivos ya convertidos que pueden esperar un hueco para enviarse: la conversión no se adelanta sin límite.
const int kMaxConvertedWaiting = 1;

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

/// Identificadores de subida UUID versión 7 (RFC 9562, apartado 5.7), como `orderedUploadIds` de la web: 48 bits
/// de milisegundos Unix, la versión, 12 bits de contador (método 1 del apartado 6.2: si coincide el milisegundo, o el
/// reloj va hacia atrás, se sigue del último sumando uno) y 62 bits aleatorios. Cada uno es mayor que el anterior,
/// así que su orden es el de la cola.
class OrderedUploadIds {
  OrderedUploadIds({DateTime Function()? now, Random? random})
    : _now = now ?? DateTime.now,
      _random = random ?? Random.secure();

  final DateTime Function() _now;
  final Random _random;
  int _lastMs = -1;
  int _counter = 0;

  String next() {
    var ms = max(0, _now().millisecondsSinceEpoch);
    if (ms > _lastMs) {
      _lastMs = ms;
      _counter = 0;
    } else {
      _counter += 1;
      if (_counter > 0xfff) {
        // Más de 4096 en el mismo milisegundo: se toma el siguiente.
        _lastMs += 1;
        _counter = 0;
      }
      ms = _lastMs;
    }
    String hex(int value, int length) =>
        value.toRadixString(16).padLeft(length, '0');
    final time = hex(ms, 12);
    final random = List<int>.generate(9, (_) => _random.nextInt(256));
    final tail = random.skip(1).map((byte) => hex(byte, 2)).join();
    final variant = (8 | (random[0] & 0x3)).toRadixString(16);
    return '${time.substring(0, 8)}-${time.substring(8)}-7${hex(_counter, 3)}-'
        '$variant${tail.substring(0, 3)}-${tail.substring(3, 15)}';
  }
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

  /// Porcentaje enviado, por trozos: los trozos ya aceptados entre el total. 0 mientras se convierte.
  int get percent {
    final count = parts ?? 0;
    if (part == null || count <= 0) return 0;
    return (part! * 100 / count).round();
  }

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

/// Convierte los archivos de uno en uno y en orden y los envía hasta [maxParallelSends] a la vez, cada uno trozo a
/// trozo y en orden (ADR-0030). Un fallo no para a los demás archivos, salvo si se pierde la conexión.
class SharedUploader {
  SharedUploader({
    required this.client,
    required this.converter,
    required this.hasConnection,
    Future<Directory> Function()? workDir,
    Uri? endpoint,
    this.retryDelay = const Duration(seconds: 3),
    this.timeout = kUploadTimeout,
    int? chunkBytes,
    this.maxParallelSends = kMaxParallelSends,
    Random? random,
    OrderedUploadIds? uploadIds,
    // ignore: prefer_initializing_formals
  }) : _endpoint = endpoint,
       // ignore: prefer_initializing_formals
       _chunkBytes = chunkBytes,
       _workDir = workDir ?? _tempDir,
       _random = random ?? Random.secure(),
       _uploadIds = uploadIds ?? OrderedUploadIds(random: random);

  final http.Client client;
  final AudioConverter converter;
  final ConnectionCheck hasConnection;
  final Uri? _endpoint;

  /// Destino de las subidas (Worker o Vercel, ADR-0029). Lo pone UploadTracker antes de cada tanda, nunca a mitad de
  /// un archivo: los trozos de 32 MB del Worker no caben en Vercel.
  UploadRoute route = UploadRoute.vercel;

  /// Dirección a la que se envían los trozos: la fijada en las pruebas o la de [route].
  Uri? get endpoint => _endpoint ?? route.endpoint;

  /// Espera antes del único reintento de un trozo.
  final Duration retryDelay;
  final Duration timeout;

  /// Tamaño de los trozos: el fijado en las pruebas o el de [route].
  int get chunkBytes => _chunkBytes ?? route.chunkBytes;
  final int? _chunkBytes;

  /// Archivos que se envían a la vez.
  final int maxParallelSends;
  final Future<Directory> Function() _workDir;
  final Random _random;
  final OrderedUploadIds _uploadIds;
  Future<void> _turn = Future<void>.value();
  int _waiting = 0;
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
  ///
  /// Las canciones de un ZIP ([PickedAudioFile.zip]) se sacan justo antes de convertirlas, de una en una, a un
  /// archivo temporal de la carpeta `zip/` del directorio de trabajo, y se borran al convertirlas. Al terminar
  /// se borra esa carpeta entera.
  ///
  /// [outputFor] da el fichero donde se guarda el Opus de cada archivo; si se da, el Opus se conserva al terminar
  /// (para escucharlo mientras se publica y para reintentar sin volver a convertir) y [onConverted] avisa de que
  /// ya está escrito. Sin [outputFor], el Opus es temporal y se borra. [onItemDone] recibe el resultado de cada
  /// archivo en cuanto se conoce (con dos envíos a la vez, no siempre en el orden de la lista); el resultado final
  /// sí va en el orden de [files].
  /// Una sola conversión a la vez: varias descargas del buscador a la vez no deben lanzar FFmpeg en paralelo.
  Future<SharedUploadResult> upload(
    List<PickedAudioFile> files, {
    void Function(UploadProgress progress)? onProgress,
    Future<File> Function(int index)? outputFor,
    void Function(int index, File opus, ConvertedAudio audio)? onConverted,
    void Function(int index, UploadItemResult item)? onItemDone,
  }) {
    Future<SharedUploadResult> run() => _upload(
      files,
      onProgress: onProgress,
      outputFor: outputFor,
      onConverted: onConverted,
      onItemDone: onItemDone,
    );
    if (_waiting == 0) {
      _waiting += 1;
      final first = run();
      final done = Completer<void>();
      _turn = done.future;
      return first.whenComplete(() {
        _waiting -= 1;
        done.complete();
      });
    }
    _waiting += 1;
    final previous = _turn;
    final done = Completer<void>();
    _turn = done.future;
    return previous.then((_) => run()).whenComplete(() {
      _waiting -= 1;
      done.complete();
    });
  }

  Future<SharedUploadResult> _upload(
    List<PickedAudioFile> files, {
    void Function(UploadProgress progress)? onProgress,
    Future<File> Function(int index)? outputFor,
    void Function(int index, File opus, ConvertedAudio audio)? onConverted,
    void Function(int index, UploadItemResult item)? onItemDone,
  }) async {
    if (files.isEmpty) return const SharedUploadResult([]);
    if (!await hasConnection()) throw const AppException(kOfflineMessage);
    _cancelled = false;
    final dir = await _workDir();
    await dir.create(recursive: true);
    final zipDir = Directory('${dir.path}/zip');
    final results = List<UploadItemResult?>.filled(files.length, null);
    String? stopReason;
    // Convertidos esperando hueco (como mucho kMaxConvertedWaiting) y envíos en marcha.
    final ready = <_ConvertedJob>[];
    final sends = <Future<void>>[];
    var running = 0;
    Completer<void>? sendFinished;

    void add(int index, UploadOutcome outcome, String message) {
      final file = files[index];
      final item = _item(
        file.name,
        titleFromFileName(file.name),
        outcome,
        message,
      );
      results[index] = item;
      onItemDone?.call(index, item);
    }

    Future<void> send(_ConvertedJob job) async {
      final index = job.index;
      final file = files[index];
      final title = titleFromFileName(file.name);
      try {
        final sent = await _sendItem(
          job.output,
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
          albumId: file.youtubePlaylistId,
          albumName: file.youtubePlaylistName,
          artist: file.artist,
          uploadId: job.uploadId,
        );
        // Antes de avisar: lo que aún no se ha empezado ya no se intenta.
        if (sent.connectionLost) stopReason ??= _lostConnectionMessage;
        add(index, sent.item.outcome, sent.item.message);
      } catch (error) {
        add(
          index,
          UploadOutcome.failed,
          error is AppException
              ? error.message
              : 'error inesperado al preparar el archivo.',
        );
      } finally {
        if (!job.keep) await _deleteQuietly(job.output);
      }
    }

    // Arranca envíos de lo convertido, en orden, mientras haya hueco. Sin red, lo que espera queda pendiente.
    void pump() {
      while (ready.isNotEmpty && running < maxParallelSends) {
        final job = ready.removeAt(0);
        final reason = stopReason;
        if (reason != null) {
          add(job.index, UploadOutcome.pending, reason);
          if (!job.keep) unawaited(_deleteQuietly(job.output));
          continue;
        }
        running += 1;
        sends.add(
          send(job).whenComplete(() {
            running -= 1;
            pump();
            final waiting = sendFinished;
            sendFinished = null;
            waiting?.complete();
          }),
        );
      }
    }

    try {
      for (var index = 0; index < files.length; index += 1) {
        // Como mucho un archivo convertido esperando: si no hay hueco, se espera a que termine un envío.
        while (ready.length >= kMaxConvertedWaiting) {
          await (sendFinished ??= Completer<void>()).future;
        }
        final file = files[index];
        final title = titleFromFileName(file.name);
        if (_cancelled) stopReason ??= kPausedUploadMessage;
        final reason = stopReason;
        if (reason != null) {
          add(index, UploadOutcome.pending, reason);
          continue;
        }
        final output = outputFor != null
            ? await outputFor(index)
            : File('${dir.path}/${uuidV4(_random)}.opus');
        var queued = false;
        File? extracted;
        try {
          onProgress?.call(
            UploadProgress(index: index, total: files.length, title: title),
          );
          var input = file.path;
          final zip = file.zip;
          if (zip != null) {
            await zipDir.create(recursive: true);
            // Nombre propio, nunca la ruta del ZIP (zip-slip).
            extracted = File(
              '${zipDir.path}/${uuidV4(_random)}${zip.dotExtension}',
            );
            await extractZipSong(zip, extracted.path);
            input = extracted.path;
            if (_cancelled) {
              stopReason ??= kPausedUploadMessage;
              add(index, UploadOutcome.pending, stopReason!);
              continue;
            }
          }
          final ConvertedAudio converted;
          try {
            converted = await converter.convert(
              inputPath: input,
              outputPath: output.path,
              title: title,
            );
          } catch (error) {
            if (!_cancelled) rethrow;
            stopReason ??= kPausedUploadMessage;
            add(index, UploadOutcome.pending, stopReason!);
            continue;
          }
          // La copia sacada del ZIP ya no hace falta: se borra antes de enviar.
          if (extracted != null) await _deleteQuietly(extracted);
          if (outputFor != null) onConverted?.call(index, output, converted);
          // El UUID v7 se saca al terminar de convertir, que va en el orden de la cola.
          ready.add(
            _ConvertedJob(
              index: index,
              output: output,
              keep: outputFor != null,
              uploadId: _uploadIds.next(),
            ),
          );
          queued = true;
          pump();
        } catch (error) {
          add(
            index,
            UploadOutcome.failed,
            error is AppException
                ? error.message
                : 'error inesperado al preparar el archivo.',
          );
        } finally {
          if (!queued) await _deleteQuietly(output);
          if (extracted != null) await _deleteQuietly(extracted);
        }
      }
      // Lo que quede convertido sale en cuanto haya hueco; se espera a todos los envíos.
      while (ready.isNotEmpty || running > 0) {
        await (sendFinished ??= Completer<void>()).future;
      }
      await Future.wait(sends);
    } finally {
      await _deleteDirQuietly(zipDir);
    }
    return SharedUploadResult([for (final item in results) item!]);
  }

  /// Vuelve a enviar un Opus ya convertido (Reintentar), sin convertir de nuevo. Nunca lanza: el fallo va en el resultado.
  Future<UploadItemResult> resend(
    File opus,
    String name, {
    String? albumId,
    String? albumName,
    String artist = '',
    void Function(int part, int parts)? onPart,
  }) async {
    final title = titleFromFileName(name);
    if (!await hasConnection()) {
      return _item(name, title, UploadOutcome.failed, kNoConnectionReason);
    }
    try {
      final sent = await _sendItem(
        opus,
        name,
        onPart ?? (_, _) {},
        albumId: albumId,
        albumName: albumName,
        artist: artist,
        uploadId: _uploadIds.next(),
      );
      return sent.item;
    } catch (error) {
      return _item(
        name,
        title,
        UploadOutcome.failed,
        error is AppException ? error.message : 'error inesperado al enviar.',
      );
    }
  }

  /// Envía un Opus y traduce los fallos de red o de la web a un resultado. Los demás errores se lanzan.
  Future<({UploadItemResult item, bool connectionLost})> _sendItem(
    File opus,
    String name,
    void Function(int part, int parts) onPart, {
    String? albumId,
    String? albumName,
    String artist = '',
    required String uploadId,
  }) async {
    final title = titleFromFileName(name);
    try {
      await _sendFile(
        opus,
        name,
        onPart,
        albumId: albumId,
        albumName: albumName,
        artist: artist,
        uploadId: uploadId,
      );
      return (
        item: _item(name, title, UploadOutcome.uploaded, kUploadedMessage),
        connectionLost: false,
      );
    } on _RetryableUploadError catch (error) {
      return (
        item: _item(name, title, UploadOutcome.failed, error.message),
        connectionLost: error.connection,
      );
    }
  }

  UploadItemResult _item(
    String name,
    String title,
    UploadOutcome outcome,
    String message,
  ) => UploadItemResult(
    name: name,
    title: title,
    outcome: outcome,
    message: message,
  );

  static Future<void> _deleteDirQuietly(Directory dir) async {
    try {
      if (await dir.exists()) await dir.delete(recursive: true);
    } catch (error) {
      debugPrint('subida: no se pudo borrar la carpeta temporal: $error');
    }
  }

  static Future<void> _deleteQuietly(File file) async {
    try {
      if (await file.exists()) await file.delete();
    } catch (error) {
      debugPrint('subida: no se pudo borrar el temporal: $error');
    }
  }

  /// Envía el Opus en trozos, en orden y con el mismo X-Subida-Id ([uploadId], un UUID v7 en el orden de la cola).
  /// Lee un trozo cada vez: no carga el archivo entero.
  Future<void> _sendFile(
    File opus,
    String name,
    void Function(int part, int parts) onPart, {
    String? albumId,
    String? albumName,
    String artist = '',
    required String uploadId,
  }) async {
    final length = await opus.length();
    if (length == 0) {
      throw const AppException('el audio convertido está vacío.');
    }
    final parts = (length + chunkBytes - 1) ~/ chunkBytes;
    final id = uploadId;
    final reader = await opus.open();
    try {
      for (var part = 0; part < parts; part += 1) {
        await reader.setPosition(part * chunkBytes);
        final bytes = await reader.read(chunkBytes);
        onPart(part, parts);
        final headers = <String, String>{
          'Content-Type': 'audio/ogg',
          kUploadNameHeader: encodeUploadName(name),
          kUploadIdHeader: id,
          kUploadPartHeader: '$part',
          kUploadPartsHeader: '$parts',
        };
        if (albumId != null && albumName != null) {
          headers[kUploadAlbumIdHeader] = albumId;
          headers[kUploadAlbumNameHeader] = Uri.encodeComponent(albumName);
        }
        if (artist.isNotEmpty) {
          headers[kUploadArtistHeader] = Uri.encodeComponent(artist);
        }
        await _sendWithOneRetry(headers, bytes);
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

/// Un archivo convertido que espera (o está en) su envío.
class _ConvertedJob {
  const _ConvertedJob({
    required this.index,
    required this.output,
    required this.keep,
    required this.uploadId,
  });

  final int index;
  final File output;

  /// True si el Opus se conserva al terminar (lo guarda el gestor de subidas).
  final bool keep;
  final String uploadId;
}
