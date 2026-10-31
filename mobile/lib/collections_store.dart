import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'collections.dart';

/// Dónde se guardan los favoritos y las listas.
abstract interface class CollectionsRepository {
  /// Lee lo guardado. Si todavía no hay nada, devuelve colecciones vacías.
  /// Lanza excepción si lo guardado no se puede leer.
  Future<Collections> read();

  Future<void> write(Collections data);
}

/// Guarda un único fichero JSON (colecciones.json) en el directorio de documentos de la app.
/// La escritura va a un fichero temporal y luego se renombra, para no dejar el JSON a medias.
class FileCollectionsRepository implements CollectionsRepository {
  FileCollectionsRepository({Future<File> Function()? file})
    : _file = file ?? _defaultFile;

  final Future<File> Function() _file;

  static Future<File> _defaultFile() async {
    final docs = await getApplicationDocumentsDirectory();
    return File('${docs.path}/colecciones.json');
  }

  @override
  Future<Collections> read() async {
    final file = await _file();
    if (!await file.exists()) return Collections();
    return Collections.fromJson(jsonDecode(await file.readAsString()));
  }

  @override
  Future<void> write(Collections data) async {
    final file = await _file();
    final temp = File('${file.path}.tmp');
    await temp.writeAsString(jsonEncode(data.toJson()), flush: true);
    await temp.rename(file.path);
  }
}
