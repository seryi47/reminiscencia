import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:path_provider/path_provider.dart';

import 'app_error.dart';

/// Lado máximo (px) de la portada propia de una lista.
const int kPlaylistCoverSide = 640;

/// Tamaño máximo de la imagen elegida. Una foto más grande no se procesa.
const int kMaxPickedImageBytes = 40 * 1024 * 1024;

/// Carpeta (dentro de los documentos de la app) de las portadas propias. Queda fuera de la copia del sistema
/// (backup_rules.xml y data_extraction_rules.xml): la imagen se guarda solo en este teléfono.
const String kPlaylistCoverDirName = 'listas-portadas';

/// Recorta al centro en cuadrado y reduce a [maxSide] px como mucho; devuelve un JPEG.
/// Respeta la orientación de la foto (EXIF). Lanza AppException si la imagen no se puede leer.
Uint8List resizeCoverImage(
  Uint8List bytes, {
  int maxSide = kPlaylistCoverSide,
}) {
  final decoded = img.decodeImage(bytes);
  if (decoded == null) {
    throw const AppException(
      'No se pudo leer la imagen. Elige una foto JPG, PNG o WebP.',
    );
  }
  final oriented = img.bakeOrientation(decoded);
  final side = oriented.width < oriented.height
      ? oriented.width
      : oriented.height;
  final square = img.copyCrop(
    oriented,
    x: (oriented.width - side) ~/ 2,
    y: (oriented.height - side) ~/ 2,
    width: side,
    height: side,
  );
  final target = side > maxSide ? maxSide : side;
  final resized = target == side
      ? square
      : img.copyResize(
          square,
          width: target,
          height: target,
          interpolation: img.Interpolation.average,
        );
  return img.encodeJpg(resized, quality: 85);
}

/// Dónde se guardan las portadas propias de las listas.
abstract interface class PlaylistCoverStore {
  /// Reduce la imagen y la guarda. Devuelve el nombre del fichero.
  Future<String> save(String playlistId, Uint8List imageBytes);

  /// Fichero de una portada guardada (puede no existir), o null si no se puede saber todavía.
  File? fileFor(String fileName);

  Future<void> delete(String fileName);
}

/// Implementación real: un JPEG por portada en documentos/listas-portadas. La reducción va en otro isolate,
/// para no congelar la interfaz con una foto grande.
class FilePlaylistCoverStore implements PlaylistCoverStore {
  FilePlaylistCoverStore({
    Future<Directory> Function()? root,
    DateTime Function()? clock,
  }) : _resolveRoot = root ?? _documentsRoot,
       _clock = clock ?? DateTime.now;

  final Future<Directory> Function() _resolveRoot;
  final DateTime Function() _clock;
  Directory? _dir;

  static Future<Directory> _documentsRoot() async {
    final docs = await getApplicationDocumentsDirectory();
    return Directory('${docs.path}/$kPlaylistCoverDirName');
  }

  /// Resuelve la carpeta al arrancar, para poder dar los ficheros sin esperar.
  Future<void> init() async {
    final dir = await _resolveRoot();
    await dir.create(recursive: true);
    _dir = dir;
  }

  @override
  File? fileFor(String fileName) {
    final dir = _dir;
    return dir == null ? null : File('${dir.path}/$fileName');
  }

  @override
  Future<String> save(String playlistId, Uint8List imageBytes) async {
    if (imageBytes.length > kMaxPickedImageBytes) {
      throw const AppException(
        'La imagen es demasiado grande. Elige otra de menos de 40 MB.',
      );
    }
    if (_dir == null) await init();
    final jpeg = await Isolate.run(() => resizeCoverImage(imageBytes));
    var safeId = playlistId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '');
    if (safeId.length > 60) safeId = safeId.substring(0, 60);
    final stamp = _clock().microsecondsSinceEpoch.toRadixString(36);
    final name = '${safeId.isEmpty ? 'lista' : safeId}-$stamp.jpg';
    final file = File('${_dir!.path}/$name');
    final temp = File('${file.path}.tmp');
    await temp.writeAsBytes(jpeg, flush: true);
    await temp.rename(file.path);
    return name;
  }

  @override
  Future<void> delete(String fileName) async {
    final file = fileFor(fileName);
    if (file != null && await file.exists()) await file.delete();
  }
}
