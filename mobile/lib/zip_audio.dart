import 'dart:io';
import 'dart:isolate';

import 'package:archive/archive.dart';
import 'package:flutter/foundation.dart';

import 'app_error.dart';

/// Canciones dentro de un ZIP («Subir canciones»). El ZIP no se sube: se lee su índice, se saca una canción
/// cada vez a un archivo temporal propio y esa canción sigue el flujo de siempre (Opus y trozos a `/api/subir`).
///
/// Memoria: el ZIP se lee del disco a trozos y cada canción se descomprime directamente a su archivo; nunca se
/// carga entero. Zip-slip: las rutas del ZIP solo sirven para mostrar el nombre base; el archivo temporal lo
/// nombra la app ([extractZipSong] recibe la ruta de destino), así que una entrada como `../../x.mp3` no escribe
/// fuera. El trabajo pesado va en un isolate de corta vida (con la app abierta, nunca en segundo plano) para
/// no congelar la interfaz.

/// Extensiones de audio que se sacan de un ZIP.
const List<String> kZipAudioExtensions = [
  'wav',
  'mp3',
  'm4a',
  'flac',
  'ogg',
  'opus',
];

/// ¿Es un ZIP, por su nombre?
bool isZipName(String name) => name.toLowerCase().endsWith('.zip');

/// Nombre base de una entrada del ZIP (sin carpetas, con `/` o `\`).
String zipEntryBaseName(String entryName) =>
    entryName.split(RegExp(r'[\\/]')).last;

/// Extensión en minúsculas, sin punto. Vacía si no tiene.
String _extension(String name) {
  final dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.substring(dot + 1).toLowerCase();
}

/// ¿Es una canción que hay que sacar? No lo son las carpetas del sistema de Mac (`__MACOSX/`), los archivos
/// o carpetas ocultos (empiezan por punto) ni lo que no es audio.
bool isZipAudioEntry(String entryName) {
  final segments = entryName
      .split(RegExp(r'[\\/]'))
      .where((segment) => segment.isNotEmpty)
      .toList();
  if (segments.isEmpty) return false;
  for (final segment in segments) {
    // «.» y «..» no son ocultos: son rutas (y nunca se usan para escribir).
    if (segment == '.' || segment == '..') continue;
    if (segment == '__MACOSX' || segment.startsWith('.')) return false;
  }
  return kZipAudioExtensions.contains(_extension(segments.last));
}

/// Una canción dentro de un ZIP: de qué ZIP, qué entrada (posición en el índice y nombre completo) y su nombre base.
@immutable
class ZipSongRef {
  const ZipSongRef({
    required this.zipPath,
    required this.zipName,
    required this.index,
    required this.entryName,
  });

  /// Ruta del ZIP en el teléfono y nombre visible («Álbum.zip»).
  final String zipPath;
  final String zipName;

  /// Posición en el índice del ZIP y nombre completo de la entrada (solo para comprobar que es la misma).
  final int index;
  final String entryName;

  /// Nombre base («Canción.mp3»): el que se sube y del que sale el título.
  String get name => zipEntryBaseName(entryName);

  /// Extensión con punto para el archivo temporal («.mp3»).
  String get dotExtension {
    final ext = _extension(name);
    return ext.isEmpty ? '' : '.$ext';
  }
}

/// Lo que hay dentro de un ZIP: las canciones, en orden, y cuántos archivos se ignoraron.
@immutable
class ZipListing {
  const ZipListing({required this.songs, required this.ignored});

  final List<ZipSongRef> songs;

  /// Archivos que no se suben: `__MACOSX/`, ocultos y lo que no es audio. Las carpetas no cuentan.
  final int ignored;
}

String _damaged(String zipName) =>
    '«$zipName» está dañado o no es un ZIP válido.';

String _encrypted(String zipName) =>
    '«$zipName» está protegido con contraseña; no se puede abrir.';

/// Entradas del ZIP (sin descomprimir nada) con su posición, su nombre, si es carpeta y si está cifrada.
List<({String name, bool directory, bool encrypted})> _readIndex(
  InputFileStream input,
) {
  final archive = ZipDecoder().decodeStream(input, verify: true);
  return [
    for (final file in archive.files)
      (
        name: file.name,
        directory: !file.isFile,
        encrypted: switch (file.rawContent) {
          final ZipFile zip => zip.flags & 0x1 != 0,
          _ => false,
        },
      ),
  ];
}

/// Lee el índice de un ZIP y devuelve sus canciones. Lanza AppException si está dañado o cifrado.
Future<ZipListing> listZipAudio(String zipPath, String zipName) async {
  final List<({String name, bool directory, bool encrypted})> index;
  try {
    index = await Isolate.run(() {
      final input = InputFileStream(zipPath);
      try {
        return _readIndex(input);
      } finally {
        input.closeSync();
      }
    });
  } catch (error) {
    debugPrint('zip: no se pudo leer «$zipName»: $error');
    throw AppException(_damaged(zipName));
  }
  final songs = <ZipSongRef>[];
  var ignored = 0;
  for (var i = 0; i < index.length; i += 1) {
    final entry = index[i];
    if (entry.directory) continue;
    if (!isZipAudioEntry(entry.name)) {
      ignored += 1;
      continue;
    }
    if (entry.encrypted) throw AppException(_encrypted(zipName));
    songs.add(
      ZipSongRef(
        zipPath: zipPath,
        zipName: zipName,
        index: i,
        entryName: entry.name,
      ),
    );
  }
  return ZipListing(songs: songs, ignored: ignored);
}

/// Descomprime una canción del ZIP en [outputPath] (una ruta que da la app, nunca la del ZIP), a trozos y
/// comprobando su CRC. Lanza AppException si no se puede; el archivo a medias se borra.
Future<void> extractZipSong(ZipSongRef song, String outputPath) async {
  final zipPath = song.zipPath;
  final index = song.index;
  final entryName = song.entryName;
  try {
    await Isolate.run(() {
      final input = InputFileStream(zipPath);
      try {
        final archive = ZipDecoder().decodeStream(input, verify: true);
        final files = archive.files;
        if (index >= files.length || files[index].name != entryName) {
          throw const FormatException('el ZIP ha cambiado');
        }
        final output = OutputFileStream(outputPath);
        try {
          files[index].writeContent(output);
        } finally {
          output.closeSync();
        }
      } finally {
        input.closeSync();
      }
    });
  } catch (error) {
    debugPrint('zip: no se pudo sacar «$entryName»: $error');
    try {
      final partial = File(outputPath);
      if (await partial.exists()) await partial.delete();
    } catch (_) {}
    if (!await File(zipPath).exists()) {
      throw AppException('ya no está «${song.zipName}». Vuelve a elegirlo.');
    }
    throw AppException(
      error is ArchivePasswordException
          ? _encrypted(song.zipName)
          : 'no se pudo sacar del ZIP «${song.zipName}»: está dañado.',
    );
  }
}
