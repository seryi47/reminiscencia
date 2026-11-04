import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import 'app_error.dart';
import 'song.dart';
import 'zip_audio.dart';

/// Subida local de audio desde el teléfono (ADR-0013, espejo de ADR-0012 de la web).
/// El cuidador elige archivos; se convierten a Ogg Opus y se guardan solo en este teléfono.
/// Nada sale del dispositivo: no hay red ni se toca el catálogo público.

/// Prefijo de los identificadores locales. El catálogo usa «S», así que no colisionan.
const String kLocalIdPrefix = 'L';
const String kLocalDirName = 'biblioteca-local';
const String kLocalIndexName = 'pistas.json';
const String kLocalLicense = 'Subida desde este teléfono';

/// Extensiones que se ofrecen al elegir archivos (WAV, MP3, M4A, FLAC y OGG).
const List<String> kLocalAudioExtensions = ['wav', 'mp3', 'm4a', 'flac', 'ogg'];

const int kOpusRate = 48000;
const int kBitrateMono = 32000;
const int kBitrateStereo = 48000;
const int kMaxFileBytes = 60 * 1024 * 1024;
const double kMaxDurationS = 20 * 60;
const int kMaxTitleRunes = 200;

/// Título de la canción: el nombre del archivo sin la última extensión. Sin nombre útil, «Sin título».
String titleFromFileName(String? fileName) {
  final base = (fileName ?? '').split(RegExp(r'[\\/]')).last;
  final title = base.replaceFirst(RegExp(r'\.[^.]*$'), '').trim();
  final cut = String.fromCharCodes(title.runes.take(kMaxTitleRunes)).trim();
  return cut.isEmpty ? 'Sin título' : cut;
}

/// Canales y tasa de salida: mono o estéreo. Lo que tiene más de dos canales se mezcla a estéreo.
@immutable
class LocalFormat {
  const LocalFormat({required this.channels, required this.bitrate});

  final int channels;
  final int bitrate;
}

LocalFormat localFormatFor(int channels) {
  final stereo = channels >= 2;
  return LocalFormat(
    channels: stereo ? 2 : 1,
    bitrate: stereo ? kBitrateStereo : kBitrateMono,
  );
}

/// Texto en megabytes con coma decimal, para los mensajes.
String formatMegabytes(int bytes) {
  final mb = bytes / (1024 * 1024);
  return '${mb.toStringAsFixed(1).replaceAll('.', ',')} MB';
}

/// Límites por archivo. Devuelve el motivo en texto o null si el archivo cabe.
String? checkFileLimits({required int bytes, double? durationS}) {
  if (bytes <= 0) return 'El archivo está vacío.';
  if (bytes > kMaxFileBytes) {
    return 'El archivo pesa ${formatMegabytes(bytes)} y el límite es ${formatMegabytes(kMaxFileBytes)}.';
  }
  if (durationS != null && durationS > kMaxDurationS) {
    return 'La canción dura más de ${kMaxDurationS ~/ 60} minutos. Divídela en partes más cortas.';
  }
  return null;
}

/// Identificador local a partir de 8 bytes: «L» más 16 hexadecimales.
String localSongIdFromBytes(List<int> bytes) {
  if (bytes.length != 8) throw ArgumentError('Hacen falta 8 bytes.');
  return kLocalIdPrefix +
      bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
}

String newLocalSongId(Random random) =>
    localSongIdFromBytes(List<int>.generate(8, (_) => random.nextInt(256)));

bool isLocalSongId(String id) => id.startsWith(kLocalIdPrefix);

/// Dato guardado de una canción local. Solo metadatos: el audio va en un fichero aparte.
@immutable
class LocalSongRecord {
  const LocalSongRecord({
    required this.id,
    required this.title,
    required this.durationS,
    required this.channels,
    required this.bitrate,
    required this.bytes,
    required this.createdAt,
  });

  final String id;
  final String title;
  final double durationS;
  final int channels;
  final int bitrate;
  final int bytes;
  final int createdAt;

  Map<String, Object> toJson() => {
    'id': id,
    'title': title,
    'duration_s': durationS,
    'channels': channels,
    'bitrate': bitrate,
    'bytes': bytes,
    'created_at': createdAt,
  };

  /// Lanza FormatException si la entrada no es válida (el lector la omite).
  factory LocalSongRecord.fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    final title = json['title'];
    final duration = json['duration_s'];
    final channels = json['channels'];
    final bitrate = json['bitrate'];
    final bytes = json['bytes'];
    final createdAt = json['created_at'];
    if (id is! String ||
        !isLocalSongId(id) ||
        title is! String ||
        duration is! num ||
        channels is! int ||
        bitrate is! int ||
        bytes is! int ||
        createdAt is! int) {
      throw const FormatException('Entrada de canción local no válida.');
    }
    return LocalSongRecord(
      id: id,
      title: title,
      durationS: duration.toDouble(),
      channels: channels,
      bitrate: bitrate,
      bytes: bytes,
      createdAt: createdAt,
    );
  }
}

/// Canción con la forma del catálogo. `audio` es la ruta absoluta del fichero local.
Song songFromRecord(LocalSongRecord record, String filePath) {
  return Song(
    id: record.id,
    title: record.title,
    artist: '',
    year: null,
    tags: const [],
    folderId: null,
    durationS: record.durationS,
    license: kLocalLicense,
    audio: filePath,
    local: true,
  );
}

/// Archivo que el cuidador ha elegido: nombre visible y ruta en el sistema de ficheros.
/// Si la canción viene de un ZIP, [zip] dice de dónde sacarla: [path] es entonces la ruta del ZIP y [name]
/// el nombre base de la canción dentro de él.
@immutable
class PickedAudioFile {
  const PickedAudioFile({
    required this.name,
    required this.path,
    this.zip,
    this.artist = '',
    this.youtubePlaylistId,
    this.youtubePlaylistName,
  });

  final String name;
  final String path;
  final ZipSongRef? zip;
  final String artist;
  final String? youtubePlaylistId;
  final String? youtubePlaylistName;
}

/// Resultado de convertir una canción en el dispositivo.
@immutable
class ConvertedAudio {
  const ConvertedAudio({
    required this.durationS,
    required this.channels,
    required this.bitrate,
    required this.bytes,
  });

  final double durationS;
  final int channels;
  final int bitrate;
  final int bytes;
}

/// Conversor de archivos a Ogg Opus. La implementación real usa FFmpeg; en pruebas se usa una falsa.
abstract interface class AudioConverter {
  /// Escribe el Ogg Opus en [outputPath]. Lanza AppException con el motivo si no se puede.
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  });

  /// Detiene la conversión en curso (al pasar la app a segundo plano).
  Future<void> cancel();
}

class LocalAddFailure {
  const LocalAddFailure({required this.name, required this.message});

  final String name;
  final String message;
}

class LocalAddResult {
  const LocalAddResult({required this.added, required this.failed});

  final List<Song> added;
  final List<LocalAddFailure> failed;
}

/// Texto de resumen para el cuidador tras añadir archivos.
String describeAddResult(LocalAddResult result) {
  final added = result.added.length;
  final parts = <String>[];
  if (added > 0) {
    parts.add(added == 1 ? 'Añadida 1 canción.' : 'Añadidas $added canciones.');
  }
  if (result.failed.isNotEmpty) {
    final first = result.failed.first;
    final more = result.failed.length - 1;
    final suffix = more > 0 ? ' y $more más' : '';
    parts.add('No se pudo añadir «${first.name}»$suffix: ${first.message}');
  }
  return parts.isEmpty ? 'No se añadió ningún archivo.' : parts.join(' ');
}

/// Guardado de las canciones locales en este teléfono: un índice de metadatos y un fichero Opus por canción.
/// La carpeta de audio queda fuera de la copia de seguridad del sistema (ver backup_rules.xml); el índice sí.
class LocalAudioStore {
  LocalAudioStore({Future<Directory> Function()? root})
    : _resolveRoot = root ?? _documentsRoot;

  final Future<Directory> Function() _resolveRoot;
  Directory? _root;
  Future<void> _serial = Future<void>.value();

  static Future<Directory> _documentsRoot() async {
    final docs = await getApplicationDocumentsDirectory();
    return Directory('${docs.path}/$kLocalDirName');
  }

  Future<Directory> _dir() async {
    final cached = _root;
    if (cached != null) return cached;
    final root = await _resolveRoot();
    await Directory('${root.path}/audio').create(recursive: true);
    _root = root;
    return root;
  }

  /// Fichero Opus de una canción local (puede no existir todavía).
  Future<File> audioFile(String id) async {
    final root = await _dir();
    return File('${root.path}/audio/$id.opus');
  }

  /// Operaciones de escritura una detrás de otra, para que dos altas seguidas no se pisen.
  Future<T> _exclusive<T>(Future<T> Function() operation) {
    final run = _serial.then((_) => operation());
    _serial = run.then<void>((_) {}, onError: (Object _) {});
    return run;
  }

  /// Lee el índice. Las entradas dañadas se omiten; un índice ilegible equivale a no tener canciones.
  Future<List<LocalSongRecord>> readRecords() async {
    final root = await _dir();
    final index = File('${root.path}/$kLocalIndexName');
    if (!await index.exists()) return [];
    final decoded = jsonDecode(await index.readAsString());
    final list = decoded is Map<String, dynamic> ? decoded['pistas'] : null;
    if (list is! List) return [];
    final records = <LocalSongRecord>[];
    for (final entry in list) {
      if (entry is! Map<String, dynamic>) continue;
      try {
        records.add(LocalSongRecord.fromJson(entry));
      } on FormatException {
        // Entrada dañada: se ignora.
      }
    }
    return records;
  }

  Future<void> _writeRecords(List<LocalSongRecord> records) async {
    final root = await _dir();
    final target = File('${root.path}/$kLocalIndexName');
    final temp = File('${target.path}.tmp');
    final body = jsonEncode({
      'version': 1,
      'pistas': records.map((record) => record.toJson()).toList(),
    });
    await temp.writeAsString(body, flush: true);
    await temp.rename(target.path);
  }

  /// Canciones guardadas que tienen su fichero. Las entradas sin fichero (por ejemplo tras restaurar la copia) se omiten.
  Future<List<Song>> songs() async {
    final songs = <Song>[];
    for (final record in await readRecords()) {
      final file = await audioFile(record.id);
      if (await file.exists()) songs.add(songFromRecord(record, file.path));
    }
    return songs;
  }

  /// Registra una canción cuyo fichero ya está escrito. Sin fichero, lanza AppException.
  Future<LocalSongRecord> commit(LocalSongRecord record) =>
      _exclusive(() async {
        final file = await audioFile(record.id);
        if (!await file.exists()) {
          throw const AppException('No se encontró el audio convertido.');
        }
        final records = await readRecords();
        records.removeWhere((existing) => existing.id == record.id);
        records.add(record);
        await _writeRecords(records);
        return record;
      });

  /// Borra una canción local: primero sale del índice y luego se borra el fichero.
  Future<void> delete(String id) => _exclusive(() async {
    if (!isLocalSongId(id)) {
      throw const AppException(
        'Solo se pueden borrar las canciones subidas desde este teléfono.',
      );
    }
    final records = await readRecords();
    records.removeWhere((record) => record.id == id);
    await _writeRecords(records);
    final file = await audioFile(id);
    if (await file.exists()) await file.delete();
  });
}

/// Une conversor, almacén y generador de identificadores. Es la lógica de «Añadir audio de este teléfono».
class LocalAudioLibrary {
  LocalAudioLibrary({
    required this.store,
    required this.converter,
    Random? random,
    DateTime Function()? clock,
  }) : _random = random ?? Random.secure(),
       _clock = clock ?? DateTime.now;

  final LocalAudioStore store;
  final AudioConverter converter;
  final Random _random;
  final DateTime Function() _clock;
  bool _cancelled = false;

  Future<List<Song>> songs() => store.songs();

  /// Pide parar la conversión. Los archivos ya guardados se conservan; el resto se marca como pendiente
  /// y el cuidador lo vuelve a añadir (la conversión no sigue en segundo plano).
  Future<void> cancelImport() async {
    _cancelled = true;
    await converter.cancel();
  }

  /// Convierte y guarda cada archivo por separado: un fallo no para a los demás.
  /// [onProgress] recibe la posición (desde 0), el total y el título del archivo que se procesa.
  Future<LocalAddResult> addFiles(
    List<PickedAudioFile> files, {
    void Function(int index, int total, String title)? onProgress,
  }) async {
    final added = <Song>[];
    final failed = <LocalAddFailure>[];
    _cancelled = false;
    for (var index = 0; index < files.length; index += 1) {
      final file = files[index];
      final title = titleFromFileName(file.name);
      if (_cancelled) {
        failed.add(
          LocalAddFailure(
            name: file.name,
            message:
                'pendiente: la conversión se paró al salir de la app. Vuelve a añadirlo.',
          ),
        );
        continue;
      }
      onProgress?.call(index, files.length, title);
      final id = newLocalSongId(_random);
      final output = await store.audioFile(id);
      try {
        final converted = await converter.convert(
          inputPath: file.path,
          outputPath: output.path,
          title: title,
        );
        final record = await store.commit(
          LocalSongRecord(
            id: id,
            title: title,
            durationS: converted.durationS,
            channels: converted.channels,
            bitrate: converted.bitrate,
            bytes: converted.bytes,
            createdAt: _clock().millisecondsSinceEpoch,
          ),
        );
        added.add(songFromRecord(record, output.path));
      } catch (error) {
        if (await output.exists()) await output.delete();
        failed.add(
          LocalAddFailure(
            name: file.name,
            message: error is AppException
                ? error.message
                : 'error inesperado al convertir el archivo.',
          ),
        );
      }
    }
    return LocalAddResult(added: added, failed: failed);
  }

  Future<void> delete(Song song) async {
    if (!song.local) {
      throw const AppException(
        'Solo se pueden borrar las canciones subidas desde este teléfono.',
      );
    }
    return store.delete(song.id);
  }
}
