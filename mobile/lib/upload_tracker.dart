import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'app_error.dart';
import 'library_store.dart';
import 'local_audio.dart';
import 'shared_upload.dart';
import 'song.dart';
import 'zip_audio.dart';

/// Seguimiento de cada canción subida para todos, de principio a fin: conversión, subida por trozos,
/// guardado en GitHub y publicación en la web (cuando aparece en `data/songs.json`).
///
/// En cuanto termina la conversión, la canción aparece en la biblioteca con «Publicándose…» y suena desde su
/// copia Opus local. Batería: la publicación se comprueba cada 20 s, como mucho 10 minutos y SOLO con la app
/// en primer plano. Fuera de eso no hay temporizadores ni peticiones. Lo que queda por publicar se guarda
/// (con su Opus) y se sigue comprobando al volver.

/// Cada cuánto se mira si ya está publicada.
const Duration kPublishPollInterval = Duration(seconds: 20);

/// Tras este tiempo desde que se guarda en GitHub, la canción pasa a «pendiente de aparecer».
/// Sigue comprobándose con la app en primer plano hasta reconocerla.
const Duration kPublishPollLimit = Duration(minutes: 10);

const String kPublishingLabel = 'Publicándose…';
const String kUploadErrorLabel = 'Error';
const String kSlowPublishMessage =
    'Aún no aparece en la biblioteca; seguiremos comprobando';
const String kAlreadyPublishedLabel = 'Ya estaba en la biblioteca';

/// Prefijo de las canciones provisionales: no coincide con «S» (catálogo) ni con «L» (solo en este teléfono).
const String kProvisionalIdPrefix = 'P';

bool isProvisionalSongId(String id) => id.startsWith(kProvisionalIdPrefix);

String newProvisionalId(Random random) =>
    kProvisionalIdPrefix + _randomHex(random);

/// Prefijo de los grupos de un ZIP. No es id de canción.
const String kZipGroupPrefix = 'Z';

String _randomHex(Random random) => List<String>.generate(
  8,
  (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
).join();

enum UploadStage {
  queued,
  converting,
  sending,
  saved,
  publishing,
  published,
  slow,
  failed,
}

/// Temporizador periódico. Se sustituye en pruebas.
typedef PeriodicTimerFactory =
    Timer Function(Duration period, void Function() onTick);

Timer _periodic(Duration period, void Function() onTick) =>
    Timer.periodic(period, (_) => onTick());

/// Canción publicada (solo lo que hace falta para reconocerla).
@immutable
class PublishedSong {
  const PublishedSong(this.id, this.title, {this.artist = '', this.folderId});

  final String id;
  final String title;
  final String artist;
  final String? folderId;
}

/// Id estable del álbum de una playlist de YouTube (el mismo que calcula `sonidos.catalog`).
String youtubeFolderId(String playlistId) =>
    'F${sha256.convert(utf8.encode('youtube:$playlistId')).toString().substring(0, 16)}';

/// Lee las canciones publicadas en la web.
abstract interface class PublishedSongsSource {
  Future<List<PublishedSong>> fetch();
}

/// `data/songs.json` de la web, sin caché intermedia. Solo lee id, título, artista y álbum.
class HttpPublishedSongs implements PublishedSongsSource {
  HttpPublishedSongs({required this.client, Uri? uri})
    : uri = uri ?? Uri.parse('${kLibraryBase}data/songs.json');

  final http.Client client;
  final Uri uri;

  @override
  Future<List<PublishedSong>> fetch() async {
    final response = await client
        .get(uri, headers: const {'Cache-Control': 'no-cache'})
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw HttpException('HTTP ${response.statusCode}', uri: uri);
    }
    return parsePublishedSongs(utf8.decode(response.bodyBytes));
  }
}

/// Id, título, artista y álbum de cada canción de un `songs.json`. Las entradas raras se omiten.
List<PublishedSong> parsePublishedSongs(String body) {
  final decoded = jsonDecode(body);
  if (decoded is! List) {
    throw const FormatException('songs.json no es una lista.');
  }
  return [
    for (final entry in decoded)
      if (entry is Map && entry['id'] is String && entry['title'] is String)
        PublishedSong(
          entry['id'] as String,
          entry['title'] as String,
          artist: entry['artist'] is String ? entry['artist'] as String : '',
          folderId: entry['folder_id'] is String
              ? entry['folder_id'] as String
              : null,
        ),
  ];
}

/// Títulos comparables: minúsculas, sin tildes (compuestas o descompuestas) y sin espacios repetidos.
String foldTitle(String text) {
  const from = 'áàäâãéèëêíìïîóòöôõúùüûñç';
  const to = 'aaaaaeeeeiiiiooooouuuunc';
  final buffer = StringBuffer();
  for (final rune in text.toLowerCase().runes) {
    if (rune >= 0x300 && rune <= 0x36f) continue;
    final char = String.fromCharCode(rune);
    final index = from.indexOf(char);
    buffer.write(index < 0 ? char : to[index]);
  }
  return buffer.toString().trim().replaceAll(RegExp(r'\s+'), ' ');
}

/// Un archivo subido y su estado.
class UploadEntry {
  UploadEntry({
    required this.key,
    required this.name,
    required this.title,
    this.source,
    this.stage = UploadStage.queued,
    this.opusPath,
    this.durationS = 0,
    this.baseline,
    this.savedAt,
    this.error,
    this.groupKey,
    this.groupName,
    this.youtubePlaylistId,
    this.youtubePlaylistName,
    this.artist = '',
  });

  /// Id de la canción provisional (`P` + 16 hexadecimales).
  final String key;

  /// Nombre del archivo elegido y título (el nombre sin extensión).
  final String name;
  final String title;

  /// Archivo original, para reintentar si no llegó a convertirse. Null tras reabrir la app.
  PickedAudioFile? source;
  UploadStage stage;

  /// Trozo que se envía y número de trozos.
  int part = 0;
  int parts = 0;

  /// Copia Opus local: suena mientras se publica y sirve para reintentar sin convertir otra vez.
  String? opusPath;
  double durationS;

  /// Ids publicados antes de subir: la canción nueva es la que no estaba.
  Set<String>? baseline;
  DateTime? savedAt;
  String? error;

  /// Id de la canción publicada.
  String? publishedId;

  /// La canción ya estaba publicada (el buzón la deduplicó) y se reconoció por álbum, título y artista.
  bool alreadyPresent = false;

  /// Id que el buzón da a este Opus: `S` + 16 hexadecimales de su SHA-256. Se calcula al comprobar.
  String? expectedId;

  /// Grupo del ZIP del que salió (clave `Z…` y nombre del ZIP). Null si se eligió suelta.
  final String? groupKey;
  final String? groupName;
  final String? youtubePlaylistId;
  final String? youtubePlaylistName;
  final String artist;

  /// Porcentaje enviado, por trozos.
  int get percent => parts <= 0 ? 0 : (part * 100 / parts).round();

  bool get awaitingPublication =>
      stage == UploadStage.saved || stage == UploadStage.publishing;

  /// Ya se guardó (o se publicó) y se puede buscar en la web.
  bool get matchable => awaitingPublication || stage == UploadStage.slow;

  bool get canRetry => stage == UploadStage.failed;

  /// Texto del estado para la interfaz.
  String get statusText => switch (stage) {
    UploadStage.queued => 'En espera',
    UploadStage.converting => 'Convirtiendo a Opus…',
    UploadStage.sending => 'Subiendo… $percent %',
    UploadStage.saved => 'Guardada en GitHub',
    UploadStage.publishing => 'Publicándose… (suele tardar 2–3 minutos)',
    UploadStage.published =>
      alreadyPresent ? kAlreadyPublishedLabel : 'Publicada',
    UploadStage.slow => kSlowPublishMessage,
    UploadStage.failed => 'Error: ${error ?? 'no se pudo subir.'}',
  };

  /// Valor de la barra: null es indeterminada (convirtiendo o publicándose).
  double? get progress => switch (stage) {
    UploadStage.queued => 0,
    UploadStage.converting => null,
    UploadStage.sending => parts <= 0 ? 0 : part / parts,
    UploadStage.saved => 1,
    UploadStage.publishing => null,
    UploadStage.published => 1,
    UploadStage.slow => 1,
    UploadStage.failed => 0,
  };

  /// Canción provisional para la biblioteca: suena desde la copia Opus local.
  Song? toSong() {
    final path = opusPath;
    if (path == null) return null;
    return Song(
      id: key,
      title: title,
      artist: artist,
      year: null,
      tags: const [],
      folderId: null,
      durationS: durationS,
      license: '',
      audio: path,
      local: true,
      uploadStatus: stage == UploadStage.failed
          ? kUploadErrorLabel
          : kPublishingLabel,
    );
  }

  Map<String, Object?> toJson() => {
    'key': key,
    'name': name,
    'title': title,
    'stage': stage.name,
    'opus': opusPath,
    'duration_s': durationS,
    'baseline': baseline?.toList(),
    'saved_at': savedAt?.millisecondsSinceEpoch,
    'error': error,
    if (groupKey != null) 'group': groupKey,
    if (groupName != null) 'group_name': groupName,
    if (youtubePlaylistId != null) 'youtube_playlist_id': youtubePlaylistId,
    if (youtubePlaylistName != null)
      'youtube_playlist_name': youtubePlaylistName,
    if (artist.isNotEmpty) 'artist': artist,
  };

  /// Lanza FormatException si la entrada no es válida.
  factory UploadEntry.fromJson(Map<String, dynamic> json) {
    final key = json['key'];
    final name = json['name'];
    final title = json['title'];
    final stage = UploadStage.values.asNameMap()[json['stage']];
    final opus = json['opus'];
    if (key is! String ||
        !isProvisionalSongId(key) ||
        name is! String ||
        title is! String ||
        stage == null ||
        opus is! String) {
      throw const FormatException('Entrada de subida no válida.');
    }
    final baseline = json['baseline'];
    final savedAt = json['saved_at'];
    final error = json['error'];
    final duration = json['duration_s'];
    final group = json['group'];
    final groupName = json['group_name'];
    final playlistId = json['youtube_playlist_id'];
    final playlistName = json['youtube_playlist_name'];
    final artist = json['artist'];
    final grouped = group is String && groupName is String;
    final hasPlaylist = playlistId is String && playlistName is String;
    return UploadEntry(
      key: key,
      name: name,
      title: title,
      stage: stage,
      opusPath: opus,
      durationS: duration is num ? duration.toDouble() : 0,
      baseline: baseline is List ? baseline.whereType<String>().toSet() : null,
      savedAt: savedAt is int
          ? DateTime.fromMillisecondsSinceEpoch(savedAt)
          : null,
      error: error is String ? error : null,
      groupKey: grouped ? group : null,
      groupName: grouped ? groupName : null,
      youtubePlaylistId: hasPlaylist ? playlistId : null,
      youtubePlaylistName: hasPlaylist ? playlistName : null,
      artist: artist is String ? artist : '',
    );
  }
}

/// Un ZIP elegido: su nombre, cuántos archivos se ignoraron y, si no se pudo abrir, el motivo.
class UploadGroup {
  UploadGroup({
    required this.key,
    required this.name,
    required this.songs,
    this.ignored = 0,
    this.error,
  });

  final String key;

  /// Nombre del ZIP («Álbum.zip»).
  final String name;

  /// Canciones que se sacaron del ZIP.
  final int songs;

  /// Archivos que no se subieron: carpetas del sistema, ocultos o que no son audio.
  final int ignored;

  /// Motivo si el ZIP no se pudo abrir (dañado o cifrado).
  final String? error;

  /// «Álbum.zip: 12 canciones».
  String get headline {
    if (error != null) return name;
    if (songs == 0) return '$name: no tiene canciones';
    return '$name: $songs ${songs == 1 ? 'canción' : 'canciones'}';
  }

  /// «Se ignoraron 3 archivos que no son canciones.» Null si no se ignoró ninguno.
  String? get ignoredText {
    if (ignored <= 0) return null;
    return ignored == 1
        ? 'Se ignoró 1 archivo que no es una canción.'
        : 'Se ignoraron $ignored archivos que no son canciones.';
  }
}

/// Lo que se ve en la lista de subidas: una canción suelta o un ZIP con sus canciones.
class UploadSection {
  UploadSection.single(UploadEntry entry) : group = null, entries = [entry];
  const UploadSection.zip(UploadGroup this.group, this.entries);

  final UploadGroup? group;
  final List<UploadEntry> entries;
}

/// Aviso para la persona (por ejemplo, «ya está publicada»).
@immutable
class UploadNotice {
  const UploadNotice({required this.key, required this.message});

  final String key;
  final String message;
}

/// Guarda en el teléfono las subidas por publicar y sus copias Opus, dentro de `biblioteca-local/subidas`
/// (fuera de la copia de seguridad del sistema, como el resto de `biblioteca-local`).
class UploadsStore {
  UploadsStore({Future<Directory> Function()? root})
    : _resolveRoot = root ?? _documentsRoot;

  final Future<Directory> Function() _resolveRoot;
  Directory? _root;
  Future<void> _serial = Future<void>.value();

  static Future<Directory> _documentsRoot() async {
    final docs = await getApplicationDocumentsDirectory();
    return Directory('${docs.path}/$kLocalDirName/subidas');
  }

  Future<Directory> _dir() async {
    final cached = _root;
    if (cached != null) return cached;
    final root = await _resolveRoot();
    await root.create(recursive: true);
    _root = root;
    return root;
  }

  Future<File> opusFile(String key) async =>
      File('${(await _dir()).path}/$key.opus');

  Future<List<UploadEntry>> read() async {
    final index = File('${(await _dir()).path}/subidas.json');
    if (!await index.exists()) return [];
    final decoded = jsonDecode(await index.readAsString());
    final list = decoded is Map<String, dynamic> ? decoded['subidas'] : null;
    if (list is! List) return [];
    final entries = <UploadEntry>[];
    for (final item in list) {
      if (item is! Map<String, dynamic>) continue;
      try {
        entries.add(UploadEntry.fromJson(item));
      } on FormatException {
        // Entrada dañada: se ignora.
      }
    }
    return entries;
  }

  /// Escrituras una detrás de otra; cada una reemplaza el índice entero.
  Future<void> write(List<UploadEntry> entries) {
    final body = jsonEncode({
      'version': 1,
      'subidas': [for (final entry in entries) entry.toJson()],
    });
    final run = _serial.then((_) async {
      final dir = await _dir();
      final temp = File('${dir.path}/subidas.json.tmp');
      await temp.writeAsString(body, flush: true);
      await temp.rename('${dir.path}/subidas.json');
    });
    _serial = run.then<void>((_) {}, onError: (Object _) {});
    return run;
  }

  /// Borra las copias Opus que no son de ninguna de las subidas [keepKeys] (ni de las que se están convirtiendo).
  Future<void> deleteOrphans(Set<String> keepKeys) async {
    final dir = await _dir();
    await for (final entity in dir.list()) {
      if (entity is! File) continue;
      final name = entity.uri.pathSegments.last;
      if (!name.endsWith('.opus')) continue;
      if (keepKeys.contains(name.substring(0, name.length - 5))) continue;
      await entity.delete();
    }
  }
}

/// Estado de todas las subidas de esta sesión (y de las que quedaron por publicar).
class UploadTracker extends ChangeNotifier {
  UploadTracker({
    this.uploader,
    this.published,
    this.store,
    DateTime Function()? clock,
    PeriodicTimerFactory? timer,
    Random? random,
    Set<String> Function()? knownIds,
    this.onPublished,
  }) : _clock = clock ?? DateTime.now,
       _timerFactory = timer ?? _periodic,
       _random = random ?? Random.secure(),
       _knownIds = knownIds ?? (() => <String>{});

  final SharedUploader? uploader;

  /// Sin él no se comprueba la publicación (solo al sincronizar la biblioteca).
  final PublishedSongsSource? published;

  /// Sin él las copias Opus son temporales: no hay canción provisional ni se recuerda nada.
  final UploadsStore? store;

  /// Se llama al detectar una canción publicada (la biblioteca se sincroniza).
  final void Function(UploadEntry entry)? onPublished;

  final DateTime Function() _clock;
  final PeriodicTimerFactory _timerFactory;
  final Random _random;

  /// Ids del catálogo conocidos, si no se puede leer `songs.json` antes de subir.
  final Set<String> Function() _knownIds;

  final List<UploadEntry> _entries = [];

  /// ZIPs elegidos, por clave.
  final Map<String, UploadGroup> _groups = {};

  /// Orden de la lista: claves de canciones sueltas y de grupos.
  final List<String> _layout = [];
  final StreamController<UploadNotice> _notices =
      StreamController<UploadNotice>.broadcast();
  bool _busy = false;
  bool _foreground = true;
  bool _checking = false;
  bool _restored = false;
  bool _disposed = false;
  Timer? _timer;

  List<UploadEntry> get entries => List.unmodifiable(_entries);

  /// La lista agrupada: cada ZIP con sus canciones, en el orden en que se eligieron.
  List<UploadSection> get sections {
    final byGroup = <String, List<UploadEntry>>{};
    final single = <String, UploadEntry>{};
    for (final entry in _entries) {
      final group = entry.groupKey;
      if (group != null && _groups.containsKey(group)) {
        (byGroup[group] ??= []).add(entry);
      } else {
        single[entry.key] = entry;
      }
    }
    return [
      for (final key in _layout)
        if (_groups[key] case final group?)
          UploadSection.zip(group, List.unmodifiable(byGroup[key] ?? const []))
        else if (single[key] case final entry?)
          UploadSection.single(entry),
    ];
  }

  /// True mientras se convierte o se envía algo.
  bool get busy => _busy;

  /// True mientras hay un temporizador de comprobación activo.
  bool get polling => _timer != null;

  /// Avisos para mostrar en la interfaz.
  Stream<UploadNotice> get notices => _notices.stream;

  UploadEntry? entryOrNull(String key) {
    for (final entry in _entries) {
      if (entry.key == key) return entry;
    }
    return null;
  }

  /// «2 de 3 publicadas».
  String get summary {
    final total = _entries.length;
    if (total == 0) return 'Ninguna canción para subir';
    final done = _entries.where((e) => e.stage == UploadStage.published).length;
    return '$done de $total ${total == 1 ? 'publicada' : 'publicadas'}';
  }

  /// Canciones provisionales: lo convertido que aún no está publicado.
  List<Song> provisionalSongs({Set<String> catalogIds = const {}}) => [
    for (final entry in _entries)
      if (!(entry.stage == UploadStage.published &&
          catalogIds.contains(entry.publishedId)))
        ?entry.toSong(),
  ];

  /// Convierte y sube [files], de uno en uno. Sin red lanza AppException sin crear nada.
  ///
  /// Un ZIP no se sube: se leen sus canciones (también las de subcarpetas) y cada una se sube como si se hubiera
  /// elegida suelta, con su nombre base como título. Si un ZIP está dañado o cifrado, su grupo lleva el error y
  /// las demás siguen.
  Future<SharedUploadResult> start(List<PickedAudioFile> files) async {
    final shared = uploader;
    if (shared == null) {
      throw const AppException(
        'Subir canciones no está disponible en este teléfono.',
      );
    }
    if (files.isEmpty || _busy) return const SharedUploadResult([]);
    if (!await shared.hasConnection()) {
      throw const AppException(kOfflineMessage);
    }
    _busy = true;
    _changed();
    final batch = <UploadEntry>[];
    final songs = <PickedAudioFile>[];
    final layout = <String>[];
    try {
      for (final file in files) {
        if (file.zip == null && isZipName(file.name)) {
          final (group, zipSongs) = await _openZip(file);
          _groups[group.key] = group;
          layout.add(group.key);
          for (final song in zipSongs) {
            final picked = PickedAudioFile(
              name: song.name,
              path: song.zipPath,
              zip: song,
            );
            batch.add(_newEntry(picked, group: group));
            songs.add(picked);
          }
          continue;
        }
        final entry = _newEntry(file);
        layout.add(entry.key);
        batch.add(entry);
        songs.add(file);
      }
    } finally {
      _busy = false;
    }
    _entries.addAll(batch);
    _layout.addAll(layout);
    if (batch.isEmpty) {
      _changed();
      return const SharedUploadResult([]);
    }
    return _run(batch, songs);
  }

  UploadEntry _newEntry(PickedAudioFile file, {UploadGroup? group}) =>
      UploadEntry(
        key: newProvisionalId(_random),
        name: file.name,
        title: titleFromFileName(file.name),
        source: file,
        groupKey: group?.key,
        groupName: group?.name,
        youtubePlaylistId: file.youtubePlaylistId,
        youtubePlaylistName: file.youtubePlaylistName,
        artist: file.artist,
      );

  /// Lee las canciones de un ZIP. Si no se puede abrir, el grupo lleva el motivo y no tiene canciones.
  Future<(UploadGroup, List<ZipSongRef>)> _openZip(PickedAudioFile file) async {
    final key = kZipGroupPrefix + _randomHex(_random);
    try {
      final listing = await listZipAudio(file.path, file.name);
      return (
        UploadGroup(
          key: key,
          name: file.name,
          songs: listing.songs.length,
          ignored: listing.ignored,
        ),
        listing.songs,
      );
    } catch (error) {
      final reason = error is AppException
          ? error.message
          : '«${file.name}» no se pudo abrir.';
      return (
        UploadGroup(key: key, name: file.name, songs: 0, error: reason),
        const <ZipSongRef>[],
      );
    }
  }

  /// Vuelve a subir un archivo con error. Si ya estaba convertido, reenvía su Opus sin convertir de nuevo.
  Future<void> retry(String key) async {
    final entry = entryOrNull(key);
    final shared = uploader;
    if (entry == null || !entry.canRetry || _busy || shared == null) return;
    final opus = entry.opusPath == null ? null : File(entry.opusPath!);
    if (opus != null && await opus.exists()) {
      _busy = true;
      entry
        ..stage = UploadStage.sending
        ..error = null
        ..part = 0
        ..parts = 0;
      _changed();
      final baseline = _fetchBaseline();
      try {
        final item = await shared.resend(
          opus,
          entry.name,
          albumId: entry.youtubePlaylistId,
          albumName: entry.youtubePlaylistName,
          artist: entry.artist,
          onPart: (part, parts) {
            entry
              ..part = part
              ..parts = parts;
            _changed();
          },
        );
        _applyResult(entry, item, baseline);
      } finally {
        _busy = false;
        _changed();
      }
      return;
    }
    final source = entry.source;
    if (source == null) {
      entry.error = 'ya no está el archivo original. Vuelve a elegirlo.';
      _changed();
      return;
    }
    entry
      ..stage = UploadStage.queued
      ..error = null
      ..opusPath = null;
    try {
      await _run([entry], [source]);
    } on AppException catch (error) {
      entry
        ..stage = UploadStage.failed
        ..error = error.message;
      _changed();
    }
  }

  Future<SharedUploadResult> _run(
    List<UploadEntry> batch,
    List<PickedAudioFile> files,
  ) async {
    final shared = uploader!;
    final saveTo = store;
    _busy = true;
    _changed();
    final baseline = _fetchBaseline();
    try {
      return await shared.upload(
        files,
        outputFor: saveTo == null
            ? null
            : (index) => saveTo.opusFile(batch[index].key),
        onProgress: (progress) {
          final entry = batch[progress.index];
          entry
            ..stage = progress.sending
                ? UploadStage.sending
                : UploadStage.converting
            ..part = progress.part ?? 0
            ..parts = progress.parts ?? 0;
          _changed();
        },
        onConverted: (index, opus, audio) {
          batch[index]
            ..opusPath = opus.path
            ..durationS = audio.durationS;
          _changed();
          unawaited(_persist());
        },
        onItemDone: (index, item) => _applyResult(batch[index], item, baseline),
      );
    } catch (error) {
      for (final entry in batch) {
        if (entry.stage.index < UploadStage.saved.index) {
          entry
            ..stage = UploadStage.failed
            ..error = error is AppException
                ? error.message
                : 'error inesperado al subir.';
        }
      }
      rethrow;
    } finally {
      _busy = false;
      _changed();
      // La subida no se considera terminada hasta que el estado guardado refleja
      // al menos la etapa actual. Si se deja en segundo plano, otra instancia
      // puede restaurar una etapa intermedia y marcarla erróneamente como fallida.
      await _persist();
    }
  }

  void _applyResult(
    UploadEntry entry,
    UploadItemResult item,
    Future<Set<String>> baseline,
  ) {
    if (item.outcome == UploadOutcome.uploaded) {
      entry
        ..stage = UploadStage.saved
        ..error = null
        ..savedAt = _clock();
      _changed();
      unawaited(
        baseline.then((ids) {
          entry.baseline = ids;
          _ensurePolling();
          return _persist();
        }),
      );
      _ensurePolling();
      return;
    }
    entry
      ..stage = UploadStage.failed
      ..error = failureReason(item.message);
    _changed();
    unawaited(_persist());
  }

  /// Ids publicados antes de subir. Si la web no responde, los del catálogo que ya conoce la app.
  Future<Set<String>> _fetchBaseline() async {
    final source = published;
    if (source != null) {
      try {
        return (await source.fetch()).map((song) => song.id).toSet();
      } catch (error) {
        debugPrint('subida: no se pudo leer songs.json antes de subir: $error');
      }
    }
    return _knownIds();
  }

  /// Primer plano o segundo plano. Fuera de primer plano no hay temporizador; al volver se comprueba enseguida.
  void setForeground(bool foreground) {
    if (_foreground == foreground) return;
    _foreground = foreground;
    if (foreground && _entries.any((e) => e.matchable)) {
      unawaited(checkNow());
    }
    _ensurePolling();
  }

  /// Al salir de la app: para la conversión en curso (no sigue en segundo plano) y deja de comprobar.
  Future<void> pause() async {
    setForeground(false);
    if (_busy) await uploader?.cancel();
  }

  void _ensurePolling() {
    if (_disposed) return;
    final needed =
        _foreground && published != null && _entries.any((e) => e.matchable);
    if (needed && _timer == null) {
      _timer = _timerFactory(kPublishPollInterval, () => unawaited(checkNow()));
    } else if (!needed && _timer != null) {
      _timer!.cancel();
      _timer = null;
    }
  }

  /// Mira una vez si ya están publicadas. Lo que pase de 10 minutos queda pendiente de aparecer y se sigue comprobando.
  Future<void> checkNow() async {
    final source = published;
    if (source == null || _checking || !_foreground) return;
    final waiting = _entries.where((e) => e.matchable).toList();
    if (waiting.isEmpty) {
      _ensurePolling();
      return;
    }
    _checking = true;
    for (final entry in waiting) {
      if (entry.stage == UploadStage.saved) {
        entry.stage = UploadStage.publishing;
      }
    }
    _changed();
    try {
      final remote = await source.fetch();
      await _matchByContent(remote);
      _match(remote);
    } catch (error) {
      debugPrint('subida: no se pudo comprobar la publicación: $error');
    } finally {
      _checking = false;
    }
    final now = _clock();
    for (final entry in waiting) {
      final saved = entry.savedAt;
      if (entry.awaitingPublication &&
          (saved == null || now.difference(saved) >= kPublishPollLimit)) {
        entry.stage = UploadStage.slow;
      }
    }
    _changed();
    _ensurePolling();
    await _persist();
  }

  /// Con la biblioteca recién sincronizada (sin peticiones nuevas): reconoce lo que ya se publicó.
  void reconcile(List<Song> catalog) {
    if (!_entries.any((e) => e.matchable)) return;
    _match([
      for (final song in catalog)
        PublishedSong(
          song.id,
          song.title,
          artist: song.artist,
          folderId: song.folderId,
        ),
    ]);
    _changed();
    _ensurePolling();
    unawaited(_persist());
  }

  /// Id de contenido de la copia Opus (el buzón nombra la canción `S` + SHA-256[:16]).
  Future<String?> _contentId(UploadEntry entry) async {
    final cached = entry.expectedId;
    if (cached != null) return cached;
    final path = entry.opusPath;
    if (path == null) return null;
    try {
      final digest = await sha256.bind(File(path).openRead()).first;
      return entry.expectedId = 'S${digest.toString().substring(0, 16)}';
    } catch (error) {
      debugPrint('subida: no se pudo calcular el id de contenido: $error');
      return null;
    }
  }

  /// Reconoce por contenido lo que el buzón ya tenía (duplicadas) y lo que llegó aunque la respuesta se perdiera
  /// (con error). Es una correspondencia exacta, a diferencia del título.
  Future<void> _matchByContent(List<PublishedSong> remote) async {
    final byId = {for (final song in remote) song.id: song};
    for (final entry in List.of(_entries)) {
      if (!entry.matchable && entry.stage != UploadStage.failed) continue;
      final id = await _contentId(entry);
      final song = id == null ? null : byId[id];
      if (song == null) continue;
      entry
        ..stage = UploadStage.published
        ..publishedId = song.id
        ..alreadyPresent = entry.baseline?.contains(song.id) ?? true
        ..error = null;
      if (!_notices.isClosed) {
        _notices.add(
          UploadNotice(
            key: entry.key,
            message: entry.alreadyPresent
                ? '«${entry.title}» ya estaba en la biblioteca.'
                : '«${entry.title}» ya está publicada.',
          ),
        );
      }
      onPublished?.call(entry);
    }
  }

  /// Al abrir la app: una subida con error cuyo Opus ya está publicado se da por resuelta.
  Future<void> _resolveFailed() async {
    final source = published;
    if (source == null || !_entries.any((e) => e.stage == UploadStage.failed)) {
      return;
    }
    try {
      await _matchByContent(await source.fetch());
      _changed();
      await _persist();
    } catch (error) {
      debugPrint('subida: no se pudo resolver lo fallido: $error');
    }
  }

  void _match(List<PublishedSong> remote) {
    final claimed = {
      for (final entry in _entries)
        if (entry.publishedId != null) entry.publishedId!,
    };
    for (final entry in _entries) {
      final baseline = entry.baseline;
      if (!entry.matchable || baseline == null) continue;
      final wanted = foldTitle(entry.title);
      for (final song in remote) {
        if (baseline.contains(song.id) || claimed.contains(song.id)) continue;
        if (foldTitle(song.title) != wanted) continue;
        claimed.add(song.id);
        entry
          ..stage = UploadStage.published
          ..publishedId = song.id;
        if (!_notices.isClosed) {
          _notices.add(
            UploadNotice(
              key: entry.key,
              message: '«${entry.title}» ya está publicada.',
            ),
          );
        }
        onPublished?.call(entry);
        break;
      }
      if (entry.stage == UploadStage.published) continue;
      final duplicate = _existingPlaylistSong(entry, remote, claimed);
      if (duplicate == null) continue;
      claimed.add(duplicate.id);
      entry
        ..stage = UploadStage.published
        ..publishedId = duplicate.id
        ..alreadyPresent = true;
      if (!_notices.isClosed) {
        _notices.add(
          UploadNotice(
            key: entry.key,
            message: '«${entry.title}» ya estaba en la biblioteca.',
          ),
        );
      }
      onPublished?.call(entry);
    }
  }

  /// Pista ya publicada de la misma playlist (el buzón deduplica por contenido y devuelve el id existente).
  /// Solo vale si coinciden álbum, título y artista.
  PublishedSong? _existingPlaylistSong(
    UploadEntry entry,
    List<PublishedSong> remote,
    Set<String> claimed,
  ) {
    final playlistId = entry.youtubePlaylistId;
    if (playlistId == null || entry.artist.isEmpty) return null;
    final folderId = youtubeFolderId(playlistId);
    final title = foldTitle(entry.title);
    final artist = foldTitle(entry.artist);
    for (final song in remote) {
      if (claimed.contains(song.id) || song.folderId != folderId) continue;
      if (foldTitle(song.title) == title && foldTitle(song.artist) == artist) {
        return song;
      }
    }
    return null;
  }

  /// Borra la copia Opus de una canción ya publicada (cuando no suena ni está en la cola).
  Future<void> discardAudio(String key) async {
    final entry = entryOrNull(key);
    final path = entry?.opusPath;
    if (entry == null || path == null) return;
    entry.opusPath = null;
    _changed();
    try {
      final file = File(path);
      if (await file.exists()) await file.delete();
    } catch (error) {
      debugPrint('subida: no se pudo borrar la copia local: $error');
    }
  }

  /// Quita de la lista las ya publicadas cuya copia local ya se borró.
  void clearPublished() {
    _entries.removeWhere(
      (e) => e.stage == UploadStage.published && e.opusPath == null,
    );
    final keys = {for (final entry in _entries) entry.key};
    final groupsInUse = {for (final entry in _entries) ?entry.groupKey};
    // Un ZIP se quita cuando ya no le queda ninguna canción (los que no se pudieron abrir se quedan).
    _groups.removeWhere(
      (key, group) => !groupsInUse.contains(key) && group.songs > 0,
    );
    _layout.removeWhere(
      (key) => !keys.contains(key) && !_groups.containsKey(key),
    );
    _changed();
  }

  /// Recupera lo que quedó por publicar (y los errores con su Opus) y borra las copias huérfanas.
  Future<void> restore() async {
    final saveTo = store;
    if (saveTo == null || _restored) return;
    _restored = true;
    try {
      final saved = await saveTo.read();
      final known = {for (final entry in _entries) entry.key};
      final restored = <UploadEntry>[];
      for (final entry in saved) {
        if (known.contains(entry.key)) continue;
        if (!await File(entry.opusPath!).exists()) continue;
        if (entry.stage.index < UploadStage.saved.index) {
          entry
            ..stage = UploadStage.failed
            ..error = 'la subida se paró al cerrar la app.';
        }
        if (entry.stage == UploadStage.saved) {
          entry.stage = UploadStage.publishing;
        }
        restored.add(entry);
      }
      _entries.insertAll(0, restored);
      final layout = <String>[];
      final counts = <String, int>{};
      for (final entry in restored) {
        final group = entry.groupKey;
        if (group == null) {
          layout.add(entry.key);
          continue;
        }
        if (_groups.containsKey(group)) continue;
        if (!counts.containsKey(group)) layout.add(group);
        counts[group] = (counts[group] ?? 0) + 1;
      }
      for (final entry in restored) {
        final group = entry.groupKey;
        if (group == null || _groups.containsKey(group)) continue;
        _groups[group] = UploadGroup(
          key: group,
          name: entry.groupName!,
          songs: counts[group]!,
        );
      }
      _layout.insertAll(0, layout);
      await saveTo.deleteOrphans({
        for (final entry in _entries)
          if (entry.opusPath != null ||
              entry.stage.index < UploadStage.saved.index)
            entry.key,
      });
    } catch (error) {
      debugPrint('subida: no se pudieron recuperar las subidas: $error');
    }
    _changed();
    if (_foreground && _entries.any((e) => e.awaitingPublication)) {
      unawaited(checkNow());
    }
    unawaited(_resolveFailed());
    _ensurePolling();
  }

  /// Guarda lo que tiene copia Opus y no está publicado.
  Future<void> _persist() async {
    final saveTo = store;
    if (saveTo == null) return;
    try {
      await saveTo.write([
        for (final entry in _entries)
          if (entry.opusPath != null && entry.stage != UploadStage.published)
            entry,
      ]);
    } catch (error) {
      debugPrint('subida: no se pudo guardar el estado: $error');
    }
  }

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _timer = null;
    _notices.close();
    super.dispose();
  }
}

/// Motivo de un fallo sin «pendiente:» ni la coletilla «Vuelve a subirlo».
String failureReason(String message) {
  var text = message.trim();
  if (text.startsWith('pendiente: ')) text = text.substring(11);
  final cut = text.indexOf(' Vuelve a subirlo');
  if (cut > 0) text = text.substring(0, cut);
  return text;
}
