import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';

/// ZIPs generados en las pruebas.

/// Bytes de audio falsos, distintos para cada nombre (para comprobar que se saca la entrada correcta).
List<int> fakeAudioBytes(String name, {int length = 3000}) {
  final seed = utf8.encode(name);
  return List<int>.generate(length, (i) => (seed[i % seed.length] + i) % 256);
}

/// ZIP con [files] (nombre → bytes) y [directories] (entradas de carpeta, acabadas en «/»).
Uint8List buildZip(
  Map<String, List<int>> files, {
  List<String> directories = const [],
  String? password,
}) {
  final archive = Archive();
  for (final dir in directories) {
    archive.add(ArchiveFile.directory(dir));
  }
  files.forEach((name, bytes) => archive.add(ArchiveFile.bytes(name, bytes)));
  return ZipEncoder(password: password).encodeBytes(archive);
}

/// Sustituye en los bytes del ZIP (cabeceras local y central) un nombre por otro de la misma longitud.
/// Sirve para crear entradas que el codificador no dejaría escribir, como `../../fuera.mp3`.
Uint8List renameInZip(Uint8List zip, String from, String to) {
  final a = utf8.encode(from);
  final b = utf8.encode(to);
  if (a.length != b.length) throw ArgumentError('misma longitud');
  final out = Uint8List.fromList(zip);
  var replaced = 0;
  for (var i = 0; i + a.length <= out.length; i += 1) {
    var match = true;
    for (var j = 0; j < a.length; j += 1) {
      if (out[i + j] != a[j]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    out.setRange(i, i + b.length, b);
    replaced += 1;
  }
  if (replaced < 2) throw StateError('no se encontró «$from» en el ZIP');
  return out;
}

Future<File> writeZip(Directory dir, String name, List<int> bytes) async {
  final file = File('${dir.path}/$name');
  await file.parent.create(recursive: true);
  await file.writeAsBytes(bytes, flush: true);
  return file;
}
