import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'api_config.dart';
import 'cover_index.dart';
import 'local_audio.dart';
import 'offline_downloads.dart';
import 'song.dart';

/// Origen de la biblioteca. La web es la fuente (desde ADR-0034, en Cloudflare: el mismo Worker sirve la web y el API);
/// la app guarda copias para usarla sin conexión.
const String kLibraryBase = 'https://reminiscencia.cometia.es/';

/// Bucket público de R2 por r2.dev (ADR-0020): las portadas y, desde ADR-0031, el primer respaldo del audio. El audio
/// se pide antes al Worker (`ApiRoutes.audioBase`, derivado de kWorkerApiBase en lib/api_config.dart) y, si también
/// falla r2.dev, a la web (kLibraryBase), donde también lo sirve el Worker.
const String kR2AudioBase =
    'https://pub-8a005187082e401abad47cdee4ec88ab.r2.dev/';

class LibraryData {
  const LibraryData({
    required this.songs,
    required this.folders,
    required this.fromNetwork,
  });

  final List<Song> songs;
  final List<Folder> folders;
  final bool fromNetwork;
}

/// Acceso a la biblioteca. La implementación real usa la web y la copia local; en pruebas se usa una falsa.
abstract interface class LibrarySource {
  /// Lee la biblioteca. Si no hay red, usa la copia guardada; si tampoco hay copia, lanza excepción.
  Future<LibraryData> load();

  /// Descarga las canciones que falten para escucharlas sin conexión. Devuelve cuántas se han descargado.
  /// [onProgress] recibe (hechas + fallidas, que faltaban); [onDetail], el progreso de todas las canciones con los
  /// bytes («Guardando 3 de 8 · 2,4 MB», ADR-0033). Con [cancel] se puede cortar: lo ya guardado se queda.
  Future<int> downloadAll(
    List<Song> songs,
    void Function(int done, int total) onProgress, {
    void Function(OfflineProgress progress)? onDetail,
    OfflineCancel? cancel,
  });

  /// Ids de las canciones cuyo audio está guardado en la copia de la web (nunca las locales).
  Future<Set<String>> cachedAudioIds();

  /// Borra el audio guardado de una canción de la web. No toca la lista ni las canciones locales.
  Future<void> deleteCachedAudio(String id);
}

class LibraryStore implements LibrarySource {
  LibraryStore({
    Future<Directory> Function()? root,
    http.Client? client,
    ApiRoutes? routes,
    this.concurrency = kOfflineConcurrency,
  }) : _resolveRoot = root ?? _documentsRoot,
       _client = client ?? http.Client(),
       // ignore: prefer_initializing_formals
       _routes = routes;

  /// Canciones que se descargan a la vez (ADR-0033).
  final int concurrency;

  /// Número de cada descarga en curso, para el nombre de su «.part».
  static int _partSeq = 0;

  final Future<Directory> Function() _resolveRoot;
  final http.Client _client;
  final ApiRoutes? _routes;
  Directory? _root;

  /// Rutas del API y del audio: las inyectadas o las comunes (que las pruebas cambian por unas sin Worker).
  ApiRoutes get _api => _routes ?? apiRoutes;

  static Future<Directory> _documentsRoot() async {
    final docs = await getApplicationDocumentsDirectory();
    return Directory('${docs.path}/biblioteca');
  }

  Future<Directory> _dir() async {
    if (_root != null) return _root!;
    final root = await _resolveRoot();
    await root.create(recursive: true);
    _root = root;
    return root;
  }

  /// Lee la biblioteca de Vercel, con el índice de portadas de R2 encima (ADR-0029). Si no hay conexión, usa la
  /// última copia guardada. La copia solo se reemplaza cuando la respuesta es válida: un JSON roto no borra la copia
  /// buena. Si el índice no se puede leer, vale el último guardado (solo crece).
  @override
  Future<LibraryData> load() async {
    final dir = await _dir();
    final songsFile = File('${dir.path}/songs.json');
    final foldersFile = File('${dir.path}/folders.json');
    final indexFile = File('${dir.path}/portadas.json');
    Future<String?> savedIndex() async =>
        await indexFile.exists() ? await indexFile.readAsString() : null;
    try {
      final songsBody = await _get('data/songs.json');
      final foldersBody = await _get('data/folders.json');
      String? indexBody;
      var indexFresh = false;
      try {
        indexBody = await fetchCoverIndexBody(
          _client,
          bucketBase: kR2AudioBase,
          routes: _routes,
        );
        indexFresh = indexBody != null;
      } catch (error) {
        debugPrint('portadas: índice no disponible, uso el guardado: $error');
        indexBody = await savedIndex();
      }
      final data = _parse(songsBody, foldersBody, indexBody, fromNetwork: true);
      await songsFile.writeAsString(songsBody, flush: true);
      await foldersFile.writeAsString(foldersBody, flush: true);
      if (indexFresh) await indexFile.writeAsString(indexBody!, flush: true);
      return data;
    } catch (error) {
      debugPrint('biblioteca: descarga fallida, uso la copia guardada: $error');
      if (!await songsFile.exists()) rethrow;
      final foldersBody = await foldersFile.exists()
          ? await foldersFile.readAsString()
          : '[]';
      return _parse(
        await songsFile.readAsString(),
        foldersBody,
        await savedIndex(),
        fromNetwork: false,
      );
    }
  }

  LibraryData _parse(
    String songsBody,
    String foldersBody,
    String? indexBody, {
    required bool fromNetwork,
  }) {
    final index = parseCoverIndex(indexBody);
    final songs = applyCoverIndexJson(
      jsonDecode(songsBody) as List,
      index,
    ).map((e) => Song.fromJson((e as Map).cast<String, dynamic>())).toList();
    final folders = applyCoverIndexJson(
      jsonDecode(foldersBody) as List,
      index,
    ).map((e) => Folder.fromJson((e as Map).cast<String, dynamic>())).toList();
    return LibraryData(
      songs: songs,
      folders: folders,
      fromNetwork: fromNetwork,
    );
  }

  Future<String> _get(String path) async {
    final response = await _client
        .get(Uri.parse('$kLibraryBase$path'))
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw HttpException('HTTP ${response.statusCode}', uri: Uri.parse(path));
    }
    return response.body;
  }

  /// Dónde pedir el audio de una canción, por orden (ADR-0031): el Worker (si hay y no está caído), r2.dev y la web
  /// (Vercel lo redirige al Worker: es otro camino, no una copia aparte). Sin Worker, como antes: r2.dev y la web.
  List<Uri> audioUris(Song song) => [
    if (_api.audioBase.isNotEmpty) Uri.parse('${_api.audioBase}${song.audio}'),
    Uri.parse('$kR2AudioBase${song.audio}'),
    Uri.parse('$kLibraryBase${song.audio}'),
  ];

  /// Primera dirección del audio (la que se transmite al reproducir).
  Uri audioUri(Song song) => audioUris(song).first;

  /// ¿Es [uri] el audio pedido al Worker?
  bool _isWorkerAudio(Uri uri) =>
      _api.base.isNotEmpty && uri.toString().startsWith('${_api.base}/');

  /// Fichero local de una canción de la web (puede no existir todavía).
  Future<File> audioFile(Song song) async {
    final dir = await _dir();
    final audioDir = Directory('${dir.path}/audio');
    await audioDir.create(recursive: true);
    return File('${audioDir.path}/${song.id}.opus');
  }

  Future<bool> isCached(Song song) async => (await audioFile(song)).exists();

  @override
  Future<Set<String>> cachedAudioIds() async {
    final dir = await _dir();
    final audioDir = Directory('${dir.path}/audio');
    if (!await audioDir.exists()) return {};
    final ids = <String>{};
    await for (final entity in audioDir.list()) {
      if (entity is! File) continue;
      final name = entity.uri.pathSegments.last;
      if (!name.endsWith('.opus')) continue;
      final id = name.substring(0, name.length - '.opus'.length);
      if (!isLocalSongId(id)) ids.add(id);
    }
    return ids;
  }

  @override
  Future<void> deleteCachedAudio(String id) async {
    // Las canciones locales viven en otra carpeta; esta guarda evita borrar nada que no sea de la web.
    if (isLocalSongId(id)) return;
    final dir = await _dir();
    final file = File('${dir.path}/audio/$id.opus');
    if (await file.exists()) await file.delete();
  }

  @override
  Future<int> downloadAll(
    List<Song> songs,
    void Function(int done, int total) onProgress, {
    void Function(OfflineProgress progress)? onDetail,
    OfflineCancel? cancel,
  }) async {
    // Una lectura de la carpeta en lugar de comprobar canción a canción, y sin repetir ids.
    final cached = await cachedAudioIds();
    final targets = <String, Song>{
      for (final song in songs)
        if (!song.local) song.id: song,
    };
    final missing = [
      for (final song in targets.values)
        if (!cached.contains(song.id)) song,
    ];
    final already = targets.length - missing.length;
    var done = 0;
    var failed = 0;
    var bytes = 0;
    void report() => onDetail?.call(
      OfflineProgress(
        done: already + done,
        total: targets.length,
        bytes: bytes,
        failed: failed,
      ),
    );
    report();
    // Varias a la vez (ADR-0033); cada una entera o nada, y una rota no frena a las demás.
    await runLimited(missing, concurrency, (song) async {
      final ok = await _downloadOne(
        song,
        onBytes: (count) {
          bytes = max(0, bytes + count);
          report();
        },
        cancel: cancel,
      );
      if (cancel?.cancelled ?? false) {
        if (ok) done += 1;
        return;
      }
      if (ok) {
        done += 1;
      } else {
        failed += 1;
      }
      onProgress(done + failed, missing.length);
      report();
    }, cancel: cancel);
    if (failed > 0 && done == 0 && !(cancel?.cancelled ?? false)) {
      throw HttpException('No se pudo descargar ninguna de $failed canciones');
    }
    return done;
  }

  /// Descarga una canción a disco sin cargarla en memoria, con hasta 3 intentos. El fichero solo
  /// existe completo (se escribe en `.part` y se renombra), y una canción rota no frena a las demás.
  /// Con Worker: Worker, r2.dev y la web; sin Worker: r2.dev, la web y r2.dev otra vez (ADR-0031). Si el Worker no
  /// responde (no un 404 suyo), se marca caído y las siguientes canciones empiezan en r2.dev.
  /// [onBytes] recibe lo que llega (y, si un intento falla, lo que se descarta, en negativo). Con [cancel] se corta.
  Future<bool> _downloadOne(
    Song song, {
    void Function(int count)? onBytes,
    OfflineCancel? cancel,
  }) async {
    final file = await audioFile(song);
    // Un nombre propio por descarga: dos descargas a la vez de la misma canción no escriben el mismo «.part».
    _partSeq += 1;
    final part = File('${file.path}.$_partSeq.part');
    // Las direcciones se fijan al empezar la canción: si el Worker cae a mitad, el siguiente intento sigue siendo r2.dev.
    final sources = audioUris(song);
    for (var attempt = 1; attempt <= 3; attempt++) {
      if (cancel?.cancelled ?? false) return false;
      final uri = sources[(attempt - 1) % sources.length];
      var received = 0;
      try {
        final http.StreamedResponse response;
        try {
          response = await _client
              .send(http.Request('GET', uri))
              .timeout(const Duration(seconds: 30));
        } catch (_) {
          if (_isWorkerAudio(uri)) _api.reportWorkerFailure();
          rethrow;
        }
        if (_isWorkerAudio(uri) &&
            !response.headers.containsKey(kWorkerHeader)) {
          _api.reportWorkerFailure();
        }
        if (response.statusCode != 200) {
          throw HttpException('HTTP ${response.statusCode}', uri: uri);
        }
        final sink = part.openWrite();
        final finished = Completer<void>();
        final subscription = response.stream
            .timeout(const Duration(seconds: 60))
            .listen(
              (chunk) {
                sink.add(chunk);
                received += chunk.length;
                onBytes?.call(chunk.length);
              },
              onError: (Object error, StackTrace stack) {
                if (!finished.isCompleted) {
                  finished.completeError(error, stack);
                }
              },
              onDone: () {
                if (!finished.isCompleted) finished.complete();
              },
              cancelOnError: true,
            );
        final stopListening = cancel?.onCancel(() {
          unawaited(subscription.cancel());
          if (!finished.isCompleted) {
            finished.completeError(const OfflineCancelled());
          }
        });
        try {
          await finished.future;
        } finally {
          stopListening?.call();
          await sink.close();
        }
        // Si el servidor dijo cuánto mide, el fichero tiene que medir eso: nunca se da por guardada una canción
        // cortada (el reproductor la tomaría como completa y sonaría a medias).
        final expected = response.contentLength;
        if (expected != null && expected >= 0 && received != expected) {
          throw HttpException(
            'descarga incompleta: $received de $expected bytes',
            uri: uri,
          );
        }
        await part.rename(file.path);
        return true;
      } catch (error) {
        if (received > 0) onBytes?.call(-received);
        if (await part.exists()) await part.delete();
        if (error is OfflineCancelled) return false;
        debugPrint('biblioteca: ${song.title}, intento $attempt: $error');
      }
    }
    return false;
  }
}
