import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

/// Portadas publicadas en la web: `covers/<id>.jpg` (contrato de data/songs.json y data/folders.json), o las del índice
/// de portadas de R2 (`portadas/<id>-<hash>.jpg`, ADR-0029; lib/cover_index.dart), que se piden al bucket público.
/// Solo se aceptan rutas relativas con un nombre simple: nada de direcciones ni «..».
final RegExp _coverPath = RegExp(
  r'^(?:covers/[A-Za-z0-9_-]{1,64}\.(?:jpg|jpeg|png|webp)|portadas/[SF][0-9a-f]{16}-[0-9a-f]{16}\.jpg)$',
);

/// Bucket público de R2 (el mismo que kR2AudioBase de library_store.dart): de ahí salen las portadas `portadas/…`.
const String kCoverBucketBase =
    'https://pub-8a005187082e401abad47cdee4ec88ab.r2.dev/';

/// Tamaño máximo de una portada descargada. Una respuesta mayor se descarta.
const int kMaxCoverBytes = 5 * 1024 * 1024;

/// Devuelve la ruta de la portada si es válida, o null. Una portada del índice con la dirección del bucket delante
/// (como la escribe la web) se queda en su fichero, `portadas/…`.
String? cleanCoverPath(Object? value) {
  if (value is! String) return null;
  var path = value.trim();
  if (path.startsWith('${kCoverBucketBase}portadas/')) {
    path = path.substring(kCoverBucketBase.length);
  }
  return _coverPath.hasMatch(path) ? path : null;
}

/// Portadas para la interfaz. Avisa (Listenable) cuando termina de bajar alguna.
abstract interface class CoverImages implements Listenable {
  /// Imagen de la portada si ya está guardada en el teléfono; si no, null.
  /// Si falta, pide la descarga una sola vez y avisa al terminar.
  ImageProvider? imageFor(String? coverPath);
}

/// Lo que la sincronización necesita de las portadas: descargar, comprobar cambios, borrar las retiradas.
abstract interface class CoverStore {
  /// Descarga las que falten. Devuelve cuántas se han descargado.
  Future<int> downloadAll(Iterable<String> coverPaths);

  /// Pregunta a la web si cambiaron las ya guardadas (petición condicional). Solo al refrescar a mano.
  Future<void> revalidate(Iterable<String> coverPaths);

  /// Borra las guardadas que ya no están en el catálogo.
  Future<void> prune(Set<String> keep);

  /// Olvida las descargas fallidas: tras una sincronización con red se puede volver a intentar.
  void resetFailures();
}

/// Sin portadas: lo que usan las pruebas que no las necesitan.
class NoCoverImages implements CoverImages {
  const NoCoverImages();

  @override
  ImageProvider? imageFor(String? coverPath) => null;

  @override
  void addListener(VoidCallback listener) {}

  @override
  void removeListener(VoidCallback listener) {}
}

/// Portadas guardadas que ya no se usan: las que no están en [keep].
Set<String> prunableCovers({
  required Iterable<String> cached,
  required Set<String> keep,
}) => cached.where((path) => !keep.contains(path)).toSet();

/// Dato guardado de una portada: fichero local y validadores de la web para la petición condicional.
@immutable
class CoverEntry {
  const CoverEntry({required this.file, this.etag, this.lastModified});

  final String file;
  final String? etag;
  final String? lastModified;

  Map<String, String> toJson() => {
    'file': file,
    'etag': ?etag,
    'last_modified': ?lastModified,
  };

  static CoverEntry? fromJson(Object? json) {
    if (json is! Map) return null;
    final file = json['file'];
    if (file is! String || !RegExp(r'^[A-Za-z0-9_.-]{1,96}$').hasMatch(file)) {
      return null;
    }
    final etag = json['etag'];
    final lastModified = json['last_modified'];
    return CoverEntry(
      file: file,
      etag: etag is String ? etag : null,
      lastModified: lastModified is String ? lastModified : null,
    );
  }
}

/// Caché en disco de las portadas de la web. Cada una se descarga una vez y se usa sin red desde entonces.
/// No hay sondeos: se descarga al mostrarla por primera vez, al guardar para escuchar sin conexión (en Wi-Fi)
/// y solo se pregunta si cambió cuando el usuario refresca a mano.
///
/// Cada versión de una portada se guarda con un nombre nuevo, así la imagen en memoria nunca queda vieja.
class CoverCache extends ChangeNotifier implements CoverImages, CoverStore {
  CoverCache({
    Future<Directory> Function()? root,
    http.Client? client,
    this.base = 'https://reminiscencia.cometia.es/',
    this.bucketBase = kCoverBucketBase,
    DateTime Function()? clock,
  }) : _resolveRoot = root ?? _documentsRoot,
       _client = client ?? http.Client(),
       _clock = clock ?? DateTime.now;

  /// Dirección de la web; las rutas `covers/…` son relativas a ella.
  final String base;

  /// Dirección del bucket público; las rutas `portadas/…` son relativas a él.
  final String bucketBase;

  /// Dirección completa de una portada.
  Uri uriFor(String path) =>
      Uri.parse('${path.startsWith('portadas/') ? bucketBase : base}$path');
  final Future<Directory> Function() _resolveRoot;
  final http.Client _client;
  final DateTime Function() _clock;

  Directory? _dir;
  final Map<String, CoverEntry> _index = {};
  final Set<String> _failed = {};
  final Map<String, Future<bool>> _inFlight = {};
  Future<void> _writing = Future<void>.value();
  bool _disposed = false;
  int _version = 0;

  static Future<Directory> _documentsRoot() async {
    final docs = await getApplicationDocumentsDirectory();
    return Directory('${docs.path}/biblioteca/portadas');
  }

  /// Lee el índice guardado. Se llama una vez al arrancar; sin él no se muestra ninguna portada guardada.
  Future<void> init() async {
    try {
      final dir = await _resolveRoot();
      await dir.create(recursive: true);
      _dir = dir;
      final file = File('${dir.path}/indice.json');
      if (!await file.exists()) return;
      final json = jsonDecode(await file.readAsString());
      if (json is! Map) return;
      json.forEach((key, value) {
        final path = cleanCoverPath(key);
        final entry = CoverEntry.fromJson(value);
        if (path != null &&
            entry != null &&
            File('${dir.path}/${entry.file}').existsSync()) {
          _index[path] = entry;
        }
      });
    } catch (error) {
      debugPrint('portadas: no se pudo leer el índice: $error');
    }
  }

  /// Rutas de las portadas guardadas.
  Set<String> get cachedPaths => _index.keys.toSet();

  /// Fichero local de una portada, o null si no está guardada.
  File? fileFor(String? coverPath) {
    final dir = _dir;
    final entry = coverPath == null ? null : _index[coverPath];
    if (dir == null || entry == null) return null;
    return File('${dir.path}/${entry.file}');
  }

  @override
  ImageProvider? imageFor(String? coverPath) {
    final path = cleanCoverPath(coverPath);
    if (path == null) return null;
    final file = fileFor(path);
    if (file != null) return FileImage(file);
    if (!_failed.contains(path)) unawaited(ensure(path));
    return null;
  }

  /// Descarga la portada si falta. Devuelve true si queda guardada. Dos llamadas a la vez comparten la descarga.
  /// Si falla, no se vuelve a intentar hasta la próxima sincronización con red ([resetFailures]).
  Future<bool> ensure(String coverPath) {
    final path = cleanCoverPath(coverPath);
    if (path == null) return Future<bool>.value(false);
    if (_index.containsKey(path)) return Future<bool>.value(true);
    if (_failed.contains(path) || _dir == null) {
      return Future<bool>.value(false);
    }
    // Ojo: el callback no debe devolver el Future quitado, o whenComplete se esperaría a sí mismo.
    return _inFlight[path] ??= _fetch(path).whenComplete(() {
      _inFlight.remove(path);
    });
  }

  Future<bool> _fetch(String path, {CoverEntry? previous}) async {
    try {
      final headers = <String, String>{
        if (previous?.etag != null) 'If-None-Match': previous!.etag!,
        if (previous?.lastModified != null)
          'If-Modified-Since': previous!.lastModified!,
      };
      final response = await _client
          .get(uriFor(path), headers: headers)
          .timeout(const Duration(seconds: 30));
      if (previous != null && response.statusCode == 304) return true;
      if (response.statusCode != 200) {
        throw HttpException('HTTP ${response.statusCode}');
      }
      final bytes = response.bodyBytes;
      if (bytes.isEmpty || bytes.length > kMaxCoverBytes) {
        throw HttpException('tamaño no válido (${bytes.length} bytes)');
      }
      await _store(path, bytes, response.headers, previous: previous);
      return true;
    } catch (error) {
      debugPrint('portadas: no se pudo descargar $path: $error');
      if (previous == null) _failed.add(path);
      return previous != null;
    }
  }

  Future<void> _store(
    String path,
    Uint8List bytes,
    Map<String, String> headers, {
    CoverEntry? previous,
  }) async {
    final dir = _dir!;
    final stem = path
        .substring(path.indexOf('/') + 1)
        .replaceAll(RegExp(r'\.[a-z]+$'), '');
    final extension = path.substring(path.lastIndexOf('.'));
    _version += 1;
    final name =
        '$stem-${_clock().microsecondsSinceEpoch.toRadixString(36)}$_version$extension';
    final temp = File('${dir.path}/$name.tmp');
    await temp.writeAsBytes(bytes, flush: true);
    await temp.rename('${dir.path}/$name');
    _index[path] = CoverEntry(
      file: name,
      etag: headers['etag'],
      lastModified: headers['last-modified'],
    );
    if (previous != null && previous.file != name) {
      await _deleteFile(previous.file);
    }
    await _saveIndex();
    _notify();
  }

  @override
  Future<int> downloadAll(Iterable<String> coverPaths) async {
    var done = 0;
    for (final path in coverPaths.toSet()) {
      if (_index.containsKey(path)) continue;
      _failed.remove(path);
      if (await ensure(path)) done += 1;
    }
    return done;
  }

  @override
  Future<void> revalidate(Iterable<String> coverPaths) async {
    for (final path in coverPaths.toSet()) {
      final entry = _index[path];
      if (entry == null) continue;
      await _fetch(path, previous: entry);
    }
  }

  @override
  Future<void> prune(Set<String> keep) async {
    final doomed = prunableCovers(cached: _index.keys, keep: keep);
    if (doomed.isEmpty) return;
    for (final path in doomed) {
      final entry = _index.remove(path);
      if (entry != null) await _deleteFile(entry.file);
    }
    await _saveIndex();
    _notify();
  }

  @override
  void resetFailures() => _failed.clear();

  Future<void> _deleteFile(String name) async {
    try {
      final file = File('${_dir!.path}/$name');
      if (await file.exists()) await file.delete();
    } catch (error) {
      debugPrint('portadas: no se pudo borrar $name: $error');
    }
  }

  /// Guarda el índice entero en un temporal y lo renombra. Las escrituras van una detrás de otra.
  Future<void> _saveIndex() {
    final run = _writing.then((_) async {
      final dir = _dir;
      if (dir == null) return;
      final file = File('${dir.path}/indice.json');
      final temp = File('${file.path}.tmp');
      await temp.writeAsString(
        jsonEncode({
          for (final entry in _index.entries) entry.key: entry.value.toJson(),
        }),
        flush: true,
      );
      await temp.rename(file.path);
    });
    _writing = run.catchError((Object error) {
      debugPrint('portadas: no se pudo guardar el índice: $error');
    });
    return _writing;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
