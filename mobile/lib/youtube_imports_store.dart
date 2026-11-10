import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'local_audio.dart' show kLocalDirName;
import 'youtube_importer.dart' show YoutubeSearchResult;

/// Una importación de YouTube iniciada desde el buscador que todavía NO ha llegado a la cola de subidas.
///
/// La mitad de «subir» ya es persistente ([UploadsStore]) y se reanuda sola al abrir la app, pero la mitad de
/// «importar» (convertir en el proxy y descargar el WAV) vivía solo en memoria: si Android mataba el proceso a media
/// descarga (al mandar la app a segundo plano, o bajo presión de memoria), se perdía «como si nunca hubiera pasado».
/// Guardar aquí la intención permite reanudarla al volver a abrir.
class PendingYoutubeImport {
  const PendingYoutubeImport({
    required this.id,
    required this.url,
    required this.title,
    this.artist = '',
    this.durationS = 0,
  });

  final String id;
  final String url;
  final String title;
  final String artist;
  final int durationS;

  factory PendingYoutubeImport.fromResult(YoutubeSearchResult result) =>
      PendingYoutubeImport(
        id: result.id,
        url: result.url,
        title: result.title,
        artist: result.artist,
        durationS: result.durationS,
      );

  YoutubeSearchResult toResult() => YoutubeSearchResult(
    id: id,
    url: url,
    title: title,
    artist: artist,
    durationS: durationS,
  );

  factory PendingYoutubeImport.fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    final url = json['url'];
    final title = json['title'];
    if (id is! String ||
        url is! String ||
        title is! String ||
        id.isEmpty ||
        url.isEmpty) {
      throw const FormatException('Importación de YouTube pendiente inválida.');
    }
    final artist = json['artist'];
    final duration = json['duration_s'];
    return PendingYoutubeImport(
      id: id,
      url: url,
      title: title,
      artist: artist is String ? artist : '',
      durationS: duration is int ? duration : 0,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'url': url,
    'title': title,
    'artist': artist,
    'duration_s': durationS,
  };
}

/// Guarda en el teléfono las importaciones de YouTube en curso, dentro de `biblioteca-local/importaciones-youtube`
/// (fuera de la copia de seguridad del sistema, como el resto de `biblioteca-local`). Mismo patrón que [UploadsStore]:
/// el índice JSON entero se reescribe de forma atómica (fichero temporal + rename) y en serie; la lectura tolera
/// entradas dañadas.
class YoutubeImportsStore {
  YoutubeImportsStore({Future<Directory> Function()? root})
    : _resolveRoot = root ?? _documentsRoot;

  final Future<Directory> Function() _resolveRoot;
  Directory? _root;
  Future<void> _serial = Future<void>.value();

  static Future<Directory> _documentsRoot() async {
    final docs = await getApplicationDocumentsDirectory();
    return Directory('${docs.path}/$kLocalDirName/importaciones-youtube');
  }

  Future<Directory> _dir() async {
    final cached = _root;
    if (cached != null) return cached;
    final root = await _resolveRoot();
    await root.create(recursive: true);
    _root = root;
    return root;
  }

  Future<List<PendingYoutubeImport>> read() async {
    final index = File('${(await _dir()).path}/importaciones.json');
    if (!await index.exists()) return [];
    final decoded = jsonDecode(await index.readAsString());
    final list = decoded is Map<String, dynamic>
        ? decoded['importaciones']
        : null;
    if (list is! List) return [];
    final entries = <PendingYoutubeImport>[];
    for (final item in list) {
      if (item is! Map<String, dynamic>) continue;
      try {
        entries.add(PendingYoutubeImport.fromJson(item));
      } on FormatException {
        // Entrada dañada: se ignora.
      }
    }
    return entries;
  }

  /// Escrituras una detrás de otra; cada una reemplaza el índice entero de forma atómica.
  Future<void> write(List<PendingYoutubeImport> entries) {
    final body = jsonEncode({
      'version': 1,
      'importaciones': [for (final entry in entries) entry.toJson()],
    });
    final run = _serial.then((_) async {
      final dir = await _dir();
      final temp = File('${dir.path}/importaciones.json.tmp');
      await temp.writeAsString(body, flush: true);
      await temp.rename('${dir.path}/importaciones.json');
    });
    _serial = run.then<void>((_) {}, onError: (Object _) {});
    return run;
  }
}
