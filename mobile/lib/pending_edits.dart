import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:path_provider/path_provider.dart';

import 'cover_index.dart';
import 'covers.dart';
import 'edit_remote.dart';
import 'library_requests.dart';
import 'local_audio.dart' show kLocalDirName;
import 'song.dart';

// Ediciones pendientes de la biblioteca común (ADR-0027), igual que la web (js/edit-pending.js): cada cambio enviado a
// /api/editar se guarda como pendiente, se ve al momento sobre el catálogo (sin tocar el catálogo real) con la marca
// «Pendiente», se confirma cuando el catálogo ya lo refleja y, si el servidor dice que falló (o tarda demasiado), se
// deshace y se avisa con «Reintentar». Las reglas están en tests/contrato/ediciones-pendientes.json. Una portada
// guardada por el Worker (ADR-0029) trae su fichero de R2 ([PendingEdit.coverKey]) y se confirma en cuanto el catálogo,
// con el índice de portadas encima, apunta a él: en segundos y sin suponer nada.

/// Estados de una edición guardada.
const String kEditPending = 'pendiente';
const String kEditFailed = 'error';

/// Esperas entre revisiones: 20, 30, 45, 60, 90 y 120 s; después, cada 180 s.
const List<int> kEditCheckDelaysS = [20, 30, 45, 60, 90, 120, 180];

/// Sin confirmar ni cerrarse en este tiempo (y con el catálogo leído), la edición se da por fallida.
const Duration kEditMaxPending = Duration(minutes: 30);

/// Cerrada por el servidor hace este tiempo sin verse en el catálogo: se da por guardada.
const Duration kEditClosedGrace = Duration(minutes: 10);

/// Portada de algo que ya tenía portada (la ruta no cambia): se da por guardada pasado este tiempo. No vale para las
/// portadas guardadas por el Worker, que sí se ven en el catálogo.
const Duration kEditCoverAssume = Duration(minutes: 10);

/// Primera revisión de una portada guardada por el Worker: el índice ya la tiene, así que se mira enseguida.
const Duration kEditCoverKeyCheck = Duration(seconds: 3);

/// Espera antes de la revisión número [attempt] (desde 0).
Duration editCheckDelay(int attempt) => Duration(
  seconds: kEditCheckDelaysS[attempt.clamp(0, kEditCheckDelaysS.length - 1)],
);

String editFailedText(String label) =>
    'No se ha podido guardar «$label». Inténtalo de nuevo.';
String editDuplicateText(String label) => 'Ya está pendiente: «$label».';
String editConfirmedText(String label) => 'Ya está guardado: «$label».';

/// Un cambio enviado que todavía no se ve en el catálogo (o que falló).
@immutable
class PendingEdit {
  const PendingEdit({
    required this.key,
    required this.kind,
    this.payload,
    this.targetId,
    this.issue,
    this.label = '',
    this.action = '',
    required this.createdAt,
    this.closedAt,
    this.state = kEditPending,
    this.error,
    this.hadCover = false,
    this.preview,
    this.coverKey,
    this.knownFolderIds = const [],
  });

  /// Identificador local.
  final String key;

  /// 'organize' (texto, álbumes y orden) o 'cover' (portada).
  final String kind;

  /// La operación tal cual se envió (organize).
  final Map<String, Object?>? payload;

  /// Canción o álbum de la portada (cover).
  final String? targetId;

  /// Número de la incidencia que la aplica, o null (portadas).
  final int? issue;

  /// Nombre de lo editado, ya con el cambio.
  final String label;

  /// Qué se hizo («Detalles de la canción», «Portada nueva»…).
  final String action;
  final DateTime createdAt;

  /// Cuándo dijo el servidor que la incidencia estaba cerrada.
  final DateTime? closedAt;
  final String state;
  final String? error;

  /// Portadas: si el elemento ya tenía portada al cambiarla.
  final bool hadCover;

  /// Portadas: el JPEG ya recortado, en base64.
  final String? preview;

  /// Portadas guardadas por el Worker: su fichero en R2 (`portadas/<id>-<hash>.jpg`), o null.
  final String? coverKey;

  /// create_folder: álbumes que había al crearlo.
  final List<String> knownFolderIds;

  bool get isCover => kind == 'cover';
  bool get failed => state == kEditFailed;
  bool get pending => state == kEditPending;
  String? get op => payload?['op'] as String?;

  PendingEdit copyWith({
    String? key,
    int? issue,
    bool clearIssue = false,
    DateTime? createdAt,
    DateTime? closedAt,
    bool clearClosedAt = false,
    String? state,
    String? error,
    bool clearError = false,
    String? coverKey,
    bool clearCoverKey = false,
  }) => PendingEdit(
    key: key ?? this.key,
    kind: kind,
    payload: payload,
    targetId: targetId,
    issue: clearIssue ? null : (issue ?? this.issue),
    label: label,
    action: action,
    createdAt: createdAt ?? this.createdAt,
    closedAt: clearClosedAt ? null : (closedAt ?? this.closedAt),
    state: state ?? this.state,
    error: clearError ? null : (error ?? this.error),
    hadCover: hadCover,
    preview: preview,
    coverKey: clearCoverKey ? null : (coverKey ?? this.coverKey),
    knownFolderIds: knownFolderIds,
  );

  Map<String, Object?> toJson() => {
    'key': key,
    'kind': kind,
    'payload': payload,
    'targetId': targetId,
    'issue': issue,
    'label': label,
    'action': action,
    'createdAt': createdAt.millisecondsSinceEpoch,
    'closedAt': closedAt?.millisecondsSinceEpoch,
    'state': state,
    'error': error,
    'hadCover': hadCover,
    'preview': preview,
    'coverKey': ?coverKey,
    'knownFolderIds': knownFolderIds,
  };

  /// Lee una edición guardada. Lanza FormatException si no vale.
  factory PendingEdit.fromJson(Map<String, Object?> json) {
    final key = json['key'];
    final kind = json['kind'];
    final created = json['createdAt'];
    if (key is! String || key.isEmpty) throw const FormatException('key');
    if (kind != 'organize' && kind != 'cover') {
      throw const FormatException('kind');
    }
    final payload = json['payload'];
    final target = json['targetId'];
    if (kind == 'organize' && (payload is! Map || payload['op'] is! String)) {
      throw const FormatException('payload');
    }
    if (kind == 'cover' && target is! String) {
      throw const FormatException('targetId');
    }
    final state = json['state'] == kEditFailed ? kEditFailed : kEditPending;
    final closed = json['closedAt'];
    final issue = json['issue'];
    final known = json['knownFolderIds'];
    return PendingEdit(
      key: key,
      kind: kind as String,
      payload: payload is Map ? payload.cast<String, Object?>() : null,
      targetId: target is String ? target : null,
      issue: issue is int && issue > 0 ? issue : null,
      label: json['label'] is String ? json['label'] as String : '',
      action: json['action'] is String ? json['action'] as String : '',
      createdAt: DateTime.fromMillisecondsSinceEpoch(
        created is int ? created : 0,
      ),
      closedAt: closed is int
          ? DateTime.fromMillisecondsSinceEpoch(closed)
          : null,
      state: state,
      error: json['error'] is String ? json['error'] as String : null,
      hadCover: json['hadCover'] == true,
      preview: json['preview'] is String ? json['preview'] as String : null,
      coverKey: isCoverKey(json['coverKey'], target is String ? target : null)
          ? json['coverKey'] as String
          : null,
      knownFolderIds: known is List
          ? [
              for (final id in known)
                if (id is String) id,
            ]
          : const [],
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Lógica pura (contrato común)
// ---------------------------------------------------------------------------------------------

Object? _canonical(Object? value) {
  if (value is Map) {
    final keys = value.keys.map((key) => '$key').toList()..sort();
    return {for (final key in keys) key: _canonical(value[key])};
  }
  if (value is List) return [for (final item in value) _canonical(item)];
  return value;
}

/// Clave para detectar duplicados: la misma operación con los mismos datos (sin importar el orden de las claves), o la
/// portada del mismo elemento con la misma imagen.
String editKey(PendingEdit edit) => edit.isCover
    ? 'cover|${edit.targetId}|${edit.preview ?? ''}'
    : 'organize|${jsonEncode(_canonical(edit.payload))}';

bool isDuplicateEdit(PendingEdit a, PendingEdit b) => editKey(a) == editKey(b);

// Entidad y campos que cambia una edición de campos: ('song', id), ('folder', id) u ('order', id).
(String, String, Set<String>)? _fieldEdit(PendingEdit edit) {
  final payload = edit.payload;
  if (payload == null) return null;
  switch (payload['op']) {
    case 'edit_song':
      return (
        'song',
        '${payload['song_id']}',
        payload.keys.where((k) => k != 'op' && k != 'song_id').toSet(),
      );
    case 'edit_folder':
    case 'rename_folder':
      return (
        'folder',
        '${payload['folder_id']}',
        payload.keys.where((k) => k != 'op' && k != 'folder_id').toSet(),
      );
    case 'order_album':
      return ('order', '${payload['folder_id']}', const {});
  }
  return null;
}

/// True si [newer] deja sin efecto a [older] (pendiente): cambia todos sus campos sobre lo mismo, es otro orden del
/// mismo álbum o es otra portada del mismo elemento. move_songs y create_folder nunca se sustituyen.
bool supersedesEdit(PendingEdit newer, PendingEdit older) {
  if (!older.pending) return false;
  if (newer.isCover || older.isCover) {
    return newer.isCover && older.isCover && newer.targetId == older.targetId;
  }
  final a = _fieldEdit(newer);
  final b = _fieldEdit(older);
  if (a == null || b == null || a.$1 != b.$1 || a.$2 != b.$2) return false;
  return a.$3.containsAll(b.$3);
}

/// Texto comparable: sin espacios al principio ni al final y con espacios simples.
String cleanEditText(Object? value) =>
    (value is String ? value : (value == null ? '' : '$value'))
        .trim()
        .replaceAll(RegExp(r'\s+'), ' ');

/// Etiquetas como el catálogo: minúsculas, sin vacías ni repetidas.
List<String> normalizeEditTags(Object? value) {
  final seen = <String>{};
  final tags = <String>[];
  for (final item in value is List ? value : const []) {
    final tag = '${item ?? ''}'.trim().toLowerCase();
    if (tag.isNotEmpty && seen.add(tag)) tags.add(tag);
  }
  return tags;
}

Song _songWith(
  Song song, {
  String? title,
  String? artist,
  Object? year = _keep,
  List<String>? tags,
  Object? folderId = _keep,
  Object? track = _keep,
  Object? cover = _keep,
  bool? pendingEdit,
}) => Song(
  id: song.id,
  title: title ?? song.title,
  artist: artist ?? song.artist,
  year: identical(year, _keep) ? song.year : year as int?,
  tags: tags ?? song.tags,
  folderId: identical(folderId, _keep) ? song.folderId : folderId as String?,
  durationS: song.durationS,
  license: song.license,
  audio: song.audio,
  cover: identical(cover, _keep) ? song.cover : cover as String?,
  local: song.local,
  uploadStatus: song.uploadStatus,
  track: identical(track, _keep) ? song.track : track as int?,
  gainDb: song.gainDb, // la normalización de volumen (ADR-0046) no es editable: se conserva
  pendingEdit: pendingEdit ?? song.pendingEdit,
);

Folder _folderWith(
  Folder folder, {
  String? name,
  String? artist,
  Object? cover = _keep,
  bool? pendingEdit,
}) => Folder(
  id: folder.id,
  name: name ?? folder.name,
  parentId: folder.parentId,
  artist: artist ?? folder.artist,
  cover: identical(cover, _keep) ? folder.cover : cover as String?,
  pendingEdit: pendingEdit ?? folder.pendingEdit,
);

const Object _keep = Object();

/// Resultado de aplicar las pendientes: lo que se pinta y qué lleva la marca «Pendiente».
typedef PendingView = ({
  List<Song> songs,
  List<Folder> folders,
  Set<String> songIds,
  Set<String> folderIds,
});

/// Catálogo con las ediciones pendientes aplicadas encima, en orden de envío (sin tocar [songs] ni [folders]).
/// Las fallidas no se aplican. create_folder no se puede previsualizar. Una portada marca su elemento y, si no tenía
/// portada, le pone su ruta (`covers/<id>.jpg`) para que la interfaz pida la imagen (la vista previa).
PendingView applyPendingEdits(
  List<Song> songs,
  List<Folder> folders,
  Iterable<PendingEdit> edits,
) {
  final songList = [...songs];
  final folderList = [...folders];
  final songIndex = {
    for (var i = 0; i < songList.length; i++) songList[i].id: i,
  };
  final folderIndex = {
    for (var i = 0; i < folderList.length; i++) folderList[i].id: i,
  };
  final markedSongs = <String>{};
  final markedFolders = <String>{};
  // Canciones eliminadas (despublicadas, ADR-0041): se quitan al final, para no mover los índices mientras se aplican
  // las demás ediciones.
  final removedSongs = <String>{};

  void moveInto(int index, String? target) {
    final song = songList[index];
    if (song.folderId == target) return;
    if (target == null) {
      songList[index] = _songWith(song, folderId: null, track: null);
      return;
    }
    int? highest;
    var numbered = false;
    for (final other in songList) {
      if (other.folderId != target || other.track == null) continue;
      numbered = true;
      highest = max(highest ?? 0, other.track!);
    }
    songList[index] = _songWith(
      song,
      folderId: target,
      track: numbered ? highest! + 1 : null,
    );
  }

  for (final edit in edits) {
    if (!edit.pending) continue;
    if (edit.isCover) {
      final id = edit.targetId;
      final si = songIndex[id];
      final fi = folderIndex[id];
      if (si != null) {
        final song = songList[si];
        songList[si] = _songWith(song, cover: song.cover ?? 'covers/$id.jpg');
        markedSongs.add(id!);
      } else if (fi != null) {
        final folder = folderList[fi];
        folderList[fi] = _folderWith(
          folder,
          cover: folder.cover ?? 'covers/$id.jpg',
        );
        markedFolders.add(id!);
      }
      continue;
    }
    final payload = edit.payload!;
    switch (payload['op']) {
      case 'edit_song':
        final index = songIndex[payload['song_id']];
        if (index == null) break;
        final song = songList[index];
        songList[index] = _songWith(
          song,
          title: payload.containsKey('title')
              ? cleanEditText(payload['title'])
              : null,
          artist: payload.containsKey('artist')
              ? cleanEditText(payload['artist'])
              : null,
          year: payload.containsKey('year') ? payload['year'] as int? : _keep,
          tags: payload.containsKey('tags')
              ? normalizeEditTags(payload['tags'])
              : null,
        );
        if (payload.containsKey('folder_id')) {
          moveInto(index, payload['folder_id'] as String?);
        }
        markedSongs.add(song.id);
      case 'unpublish_song':
        // Eliminar = despublicar (ADR-0041): la canción desaparece de la biblioteca al instante.
        final id = payload['song_id'];
        if (id is String) removedSongs.add(id);
      case 'move_songs':
        final target = payload['folder_id'] as String?;
        for (final id in (payload['song_ids'] as List? ?? const [])) {
          final index = songIndex[id];
          if (index == null) continue;
          moveInto(index, target);
          markedSongs.add(id as String);
        }
      case 'order_album':
        final folderId = payload['folder_id'];
        if (!folderIndex.containsKey(folderId)) break;
        var position = 0;
        for (final id in (payload['song_ids'] as List? ?? const [])) {
          final index = songIndex[id];
          if (index == null || songList[index].folderId != folderId) continue;
          position++;
          songList[index] = _songWith(songList[index], track: position);
        }
        markedFolders.add(folderId as String);
      case 'edit_folder':
      case 'rename_folder':
        final index = folderIndex[payload['folder_id']];
        if (index == null) break;
        final folder = folderList[index];
        folderList[index] = _folderWith(
          folder,
          name: payload.containsKey('name')
              ? cleanEditText(payload['name'])
              : null,
          artist: payload.containsKey('artist')
              ? cleanEditText(payload['artist'])
              : null,
        );
        markedFolders.add(folder.id);
    }
  }
  if (removedSongs.isNotEmpty) {
    songList.removeWhere((song) => removedSongs.contains(song.id));
  }
  for (var i = 0; i < songList.length; i++) {
    if (markedSongs.contains(songList[i].id)) {
      songList[i] = _songWith(songList[i], pendingEdit: true);
    }
  }
  for (var i = 0; i < folderList.length; i++) {
    if (markedFolders.contains(folderList[i].id)) {
      folderList[i] = _folderWith(folderList[i], pendingEdit: true);
    }
  }
  return (
    songs: songList,
    folders: folderList,
    songIds: markedSongs,
    folderIds: markedFolders,
  );
}

/// True si el catálogo real ([songs], [folders]) ya refleja la edición, o si lo editado ya no existe.
bool isEditReflected(PendingEdit edit, List<Song> songs, List<Folder> folders) {
  Song? song(Object? id) {
    for (final item in songs) {
      if (item.id == id) return item;
    }
    return null;
  }

  Folder? folder(Object? id) {
    for (final item in folders) {
      if (item.id == id) return item;
    }
    return null;
  }

  if (edit.isCover) {
    final target = edit.targetId;
    final songTarget = song(target);
    final folderTarget = songTarget == null ? folder(target) : null;
    if (songTarget == null && folderTarget == null) return true;
    final cover = songTarget?.cover ?? folderTarget?.cover;
    // Por el Worker: reflejada cuando el catálogo (con el índice de portadas encima) apunta a ese fichero.
    if (edit.coverKey != null) return isCoverReflected(cover, edit.coverKey);
    return !edit.hadCover && cover != null;
  }
  final payload = edit.payload!;
  switch (payload['op']) {
    case 'edit_song':
      final current = song(payload['song_id']);
      if (current == null) return true;
      if (payload.containsKey('title') &&
          cleanEditText(payload['title']) != cleanEditText(current.title)) {
        return false;
      }
      if (payload.containsKey('artist') &&
          cleanEditText(payload['artist']) != cleanEditText(current.artist)) {
        return false;
      }
      if (payload.containsKey('year') && payload['year'] != current.year) {
        return false;
      }
      if (payload.containsKey('tags') &&
          !listEquals(
            normalizeEditTags(payload['tags']),
            normalizeEditTags(current.tags),
          )) {
        return false;
      }
      if (payload.containsKey('folder_id') &&
          payload['folder_id'] != current.folderId) {
        return false;
      }
      return true;
    case 'unpublish_song':
      // Reflejada cuando la canción ya no está en el catálogo público (se despublicó).
      return song(payload['song_id']) == null;
    case 'move_songs':
      for (final id in (payload['song_ids'] as List? ?? const [])) {
        final current = song(id);
        if (current != null && current.folderId != payload['folder_id']) {
          return false;
        }
      }
      return true;
    case 'order_album':
      final folderId = payload['folder_id'];
      if (folder(folderId) == null) return true;
      final inFolder = {
        for (final item in songs)
          if (item.folderId == folderId) item.id: item,
      };
      final wanted = [
        for (final id in (payload['song_ids'] as List? ?? const []))
          if (inFolder.containsKey(id)) inFolder[id]!,
      ];
      if (wanted.any((item) => item.track == null)) return false;
      final sorted = [...wanted]..sort((a, b) => a.track!.compareTo(b.track!));
      for (var i = 0; i < wanted.length; i++) {
        if (sorted[i].id != wanted[i].id) return false;
      }
      return true;
    case 'edit_folder':
    case 'rename_folder':
      final current = folder(payload['folder_id']);
      if (current == null) return true;
      if (payload.containsKey('name') &&
          cleanEditText(payload['name']) != cleanEditText(current.name)) {
        return false;
      }
      if (payload.containsKey('artist') &&
          cleanEditText(payload['artist']) != cleanEditText(current.artist)) {
        return false;
      }
      return true;
    case 'create_folder':
      final known = edit.knownFolderIds.toSet();
      return folders.any(
        (item) =>
            !known.contains(item.id) &&
            cleanEditText(item.name) == cleanEditText(payload['name']) &&
            (!payload.containsKey('artist') ||
                cleanEditText(item.artist) == cleanEditText(payload['artist'])),
      );
  }
  return false;
}

/// Resultado de revisar una edición.
enum EditOutcome { pending, confirmed, failed }

/// Decide qué pasa con una edición pendiente en una revisión. [status]: lo que dijo el servidor ('abierta', 'cerrada',
/// 'error') o null si no se sabe; [reflected]: si el catálogo leído ya la refleja; [catalogOk]: si se pudo leer.
({EditOutcome outcome, DateTime? closedAt}) reviewEdit(
  PendingEdit edit, {
  required DateTime now,
  required String? status,
  required bool reflected,
  required bool catalogOk,
}) {
  if (reflected) {
    return (outcome: EditOutcome.confirmed, closedAt: edit.closedAt);
  }
  if (status == 'error') {
    return (outcome: EditOutcome.failed, closedAt: edit.closedAt);
  }
  final closedAt = edit.closedAt ?? (status == 'cerrada' ? now : null);
  if (closedAt != null && now.difference(closedAt) >= kEditClosedGrace) {
    return (outcome: EditOutcome.confirmed, closedAt: closedAt);
  }
  final age = now.difference(edit.createdAt);
  if (edit.isCover &&
      edit.hadCover &&
      edit.coverKey == null &&
      age >= kEditCoverAssume) {
    return (outcome: EditOutcome.confirmed, closedAt: closedAt);
  }
  if (catalogOk && closedAt == null && age >= kEditMaxPending) {
    return (outcome: EditOutcome.failed, closedAt: closedAt);
  }
  return (outcome: EditOutcome.pending, closedAt: closedAt);
}

/// Nombre de lo editado y qué se hizo, con el catálogo que se ve ([songs], [folders]).
({String label, String action}) describeEdit(
  Map<String, Object?> payload,
  List<Song> songs,
  List<Folder> folders,
) {
  String songTitle(Object? id) {
    for (final song in songs) {
      if (song.id == id) return song.title;
    }
    return 'Canción';
  }

  String folderName(Object? id) {
    for (final folder in folders) {
      if (folder.id == id) return folder.name;
    }
    return 'Álbum';
  }

  switch (payload['op']) {
    case 'edit_song':
      final label = payload.containsKey('title')
          ? cleanEditText(payload['title'])
          : songTitle(payload['song_id']);
      if (payload.containsKey('folder_id')) {
        final target = payload['folder_id'];
        return (
          label: label,
          action: target == null
              ? 'Quitar del álbum'
              : 'Añadir a «${folderName(target)}»',
        );
      }
      return (label: label, action: 'Detalles de la canción');
    case 'move_songs':
      final ids = payload['song_ids'] as List? ?? const [];
      final target = payload['folder_id'];
      return (
        label: ids.length == 1
            ? songTitle(ids.first)
            : '${ids.length} canciones',
        action: target == null
            ? 'Quitar del álbum'
            : 'Mover a «${folderName(target)}»',
      );
    case 'order_album':
      return (
        label: folderName(payload['folder_id']),
        action: 'Orden de las canciones',
      );
    case 'edit_folder':
    case 'rename_folder':
      return (
        label: payload.containsKey('name')
            ? cleanEditText(payload['name'])
            : folderName(payload['folder_id']),
        action: 'Detalles del álbum',
      );
    case 'create_folder':
      return (label: cleanEditText(payload['name']), action: 'Álbum nuevo');
  }
  return (label: 'Cambio', action: 'Cambio');
}

/// Nombre de la canción o del álbum de una portada.
String coverLabel(String id, List<Song> songs, List<Folder> folders) {
  for (final song in songs) {
    if (song.id == id) return song.title;
  }
  for (final folder in folders) {
    if (folder.id == id) return folder.name;
  }
  return 'Portada';
}

// ---------------------------------------------------------------------------------------------
// Almacén
// ---------------------------------------------------------------------------------------------

/// Dónde se guardan las ediciones pendientes para seguir tras cerrar la app.
abstract interface class PendingEditsStore {
  Future<List<PendingEdit>> read();
  Future<void> write(List<PendingEdit> edits);
}

/// En `biblioteca-local/ediciones_pendientes.json` (fuera de la copia de seguridad del sistema, como las subidas).
/// Un fichero dañado se lee como vacío.
class FilePendingEditsStore implements PendingEditsStore {
  FilePendingEditsStore({Future<Directory> Function()? root})
    : _resolveRoot = root ?? _documentsRoot;

  static const String fileName = 'ediciones_pendientes.json';

  final Future<Directory> Function() _resolveRoot;
  Future<void> _serial = Future<void>.value();

  static Future<Directory> _documentsRoot() async {
    final docs = await getApplicationDocumentsDirectory();
    return Directory('${docs.path}/$kLocalDirName');
  }

  @override
  Future<List<PendingEdit>> read() async {
    try {
      final file = File('${(await _resolveRoot()).path}/$fileName');
      if (!await file.exists()) return [];
      return parsePendingEdits(await file.readAsString());
    } catch (error) {
      debugPrint('ediciones: no se pudieron leer las pendientes: $error');
      return [];
    }
  }

  @override
  Future<void> write(List<PendingEdit> edits) {
    final body = serializePendingEdits(edits);
    final run = _serial.then((_) async {
      final dir = await _resolveRoot();
      await dir.create(recursive: true);
      final temp = File('${dir.path}/$fileName.tmp');
      await temp.writeAsString(body, flush: true);
      await temp.rename('${dir.path}/$fileName');
    });
    _serial = run.then<void>((_) {}, onError: (Object _) {});
    return run;
  }
}

/// En memoria (pruebas): guarda el texto, como el fichero.
class MemoryPendingEditsStore implements PendingEditsStore {
  String? body;
  int writes = 0;

  @override
  Future<List<PendingEdit>> read() async => parsePendingEdits(body);

  @override
  Future<void> write(List<PendingEdit> edits) async {
    writes++;
    body = serializePendingEdits(edits);
  }
}

String serializePendingEdits(List<PendingEdit> edits) => jsonEncode({
  'version': 1,
  'items': [for (final edit in edits) edit.toJson()],
});

/// Lee lo guardado. Nunca lanza: lo que no vale se descarta.
List<PendingEdit> parsePendingEdits(String? body) {
  Object? data;
  try {
    data = jsonDecode(body ?? 'null');
  } catch (_) {
    return [];
  }
  if (data is! Map || data['version'] != 1 || data['items'] is! List) return [];
  final edits = <PendingEdit>[];
  for (final item in data['items'] as List) {
    if (item is! Map) continue;
    try {
      edits.add(PendingEdit.fromJson(item.cast<String, Object?>()));
    } on FormatException {
      // Entrada dañada: se ignora.
    } on TypeError {
      // Entrada dañada: se ignora.
    }
  }
  return edits;
}

// ---------------------------------------------------------------------------------------------
// Controlador
// ---------------------------------------------------------------------------------------------

/// Temporizador de una sola vez (en pruebas, uno falso).
typedef EditTimerFactory =
    Timer Function(Duration delay, void Function() onFire);

Timer _oneShot(Duration delay, void Function() onFire) => Timer(delay, onFire);

/// Catálogo real leído para revisar: [ok] es false si no se pudo leer de la web.
typedef EditCatalog = ({List<Song> songs, List<Folder> folders, bool ok});

/// Aviso para la interfaz: una edición confirmada o fallida.
@immutable
class PendingEditNotice {
  const PendingEditNotice({
    required this.key,
    required this.failed,
    required this.message,
  });

  final String key;
  final bool failed;
  final String message;
}

/// Ediciones pendientes de este teléfono: las guarda, las revisa con espera creciente y avisa.
class PendingEditsController extends ChangeNotifier {
  PendingEditsController({
    EditStatusFetcher? fetchStatus,
    this.store,
    DateTime Function()? clock,
    EditTimerFactory? timer,
    Random? random,
  }) : _fetchStatus = fetchStatus ?? fetchEditStatus,
       _clock = clock ?? DateTime.now,
       _timerFactory = timer ?? _oneShot,
       _random = random ?? Random();

  final EditStatusFetcher _fetchStatus;
  final PendingEditsStore? store;
  final DateTime Function() _clock;
  final EditTimerFactory _timerFactory;
  final Random _random;

  /// Catálogo real que se ve ahora (sin las pendientes). Lo conecta LibraryController.
  EditCatalog Function() currentCatalog = () =>
      (songs: const <Song>[], folders: const <Folder>[], ok: false);

  /// Vuelve a leer el catálogo de la web y lo devuelve. Lo conecta LibraryController.
  Future<EditCatalog> Function()? loadCatalog;

  /// Se llama al confirmar una portada (para volver a pedir la imagen guardada).
  void Function(String coverPath)? onCoverConfirmed;

  final List<PendingEdit> _items = [];
  final StreamController<PendingEditNotice> _notices =
      StreamController<PendingEditNotice>.broadcast();
  final Map<String, MemoryImage> _previews = {};
  final Map<CoverImages, CoverImages> _coverWrappers = Map.identity();
  Timer? _timer;
  int _timerGeneration = 0;
  int _attempt = 0;
  bool _checking = false;
  bool _restored = false;
  bool _disposed = false;
  bool _foreground = true;

  /// Todas, en orden de envío.
  List<PendingEdit> get items => List.unmodifiable(_items);
  List<PendingEdit> get pendingItems => _items.where((e) => e.pending).toList();
  List<PendingEdit> get failedItems => _items.where((e) => e.failed).toList();

  /// Avisos de confirmación y de fallo.
  Stream<PendingEditNotice> get notices => _notices.stream;

  /// True si hay una revisión programada.
  bool get scheduled => _timer != null;

  @visibleForTesting
  bool get foreground => _foreground;

  /// La app pasa a primer plano (true) o al fondo (false). En segundo plano se pausan las revisiones
  /// periódicas: mientras suena música con la pantalla apagada no se gasta red ni batería comprobando el
  /// catálogo (ADR-0046). La corrección se conserva: `reviewEdit` usa la antigüedad real desde `createdAt`,
  /// así que al volver al primer plano una edición caducada (> [kEditMaxPending]) se detecta igual. Al
  /// volver se retoma la revisión enseguida si queda algo pendiente.
  void setForeground(bool value) {
    if (_disposed || _foreground == value) return;
    _foreground = value;
    if (!value) {
      _cancelTimer();
    } else if (!_checking && _items.any((e) => e.pending)) {
      _attempt = 0;
      _schedule(first: Duration.zero);
    }
  }

  /// El catálogo con las pendientes aplicadas.
  PendingView apply(List<Song> songs, List<Folder> folders) =>
      applyPendingEdits(songs, folders, _items);

  /// Recupera lo guardado (una sola vez) y lo revisa enseguida.
  Future<void> restore() async {
    if (_restored) return;
    _restored = true;
    final saved = await store?.read() ?? const <PendingEdit>[];
    if (_disposed || saved.isEmpty) return;
    final keys = _items.map((e) => e.key).toSet();
    _items.insertAll(0, saved.where((e) => !keys.contains(e.key)));
    notifyListeners();
    if (_items.any((e) => e.pending)) unawaited(check());
  }

  String _newKey() =>
      'e${_clock().millisecondsSinceEpoch}${_random.nextInt(1 << 30).toRadixString(16)}';

  /// Envía un cambio (si no hay ya uno igual pendiente) y lo deja pendiente. Devuelve el texto para la persona.
  /// Lanza el error del envío.
  Future<String> submit(LibraryRequest request, EditSubmitter send) async {
    final real = currentCatalog();
    final shown = apply(real.songs, real.folders);
    final described = describeEdit(request.payload, shown.songs, shown.folders);
    final candidate = PendingEdit(
      key: _newKey(),
      kind: 'organize',
      payload: Map.of(request.payload),
      label: described.label,
      action: described.action,
      createdAt: _clock(),
      knownFolderIds: request.payload['op'] == 'create_folder'
          ? [for (final folder in real.folders) folder.id]
          : const [],
    );
    final duplicate = _pendingDuplicate(candidate);
    if (duplicate != null) return editDuplicateText(duplicate.label);
    final receipt = await send(request);
    _register(candidate.copyWith(issue: receipt.issue, createdAt: _clock()));
    return receipt.message;
  }

  /// Envía la portada [jpeg] de [id] y la deja pendiente, con su vista previa.
  Future<String> submitCover(
    String id,
    Uint8List jpeg,
    CoverSubmitter send,
  ) async {
    final real = currentCatalog();
    final shown = apply(real.songs, real.folders);
    var hadCover = false;
    for (final song in real.songs) {
      if (song.id == id) hadCover = song.cover != null;
    }
    for (final folder in real.folders) {
      if (folder.id == id) hadCover = folder.cover != null;
    }
    final candidate = PendingEdit(
      key: _newKey(),
      kind: 'cover',
      targetId: id,
      label: coverLabel(id, shown.songs, shown.folders),
      action: 'Portada nueva',
      createdAt: _clock(),
      hadCover: hadCover,
      preview: base64Encode(jpeg),
    );
    final duplicate = _pendingDuplicate(candidate);
    if (duplicate != null) return editDuplicateText(duplicate.label);
    final receipt = await send(id, jpeg);
    _register(
      candidate.copyWith(
        issue: receipt.issue,
        createdAt: _clock(),
        coverKey: isCoverKey(receipt.cover, id) ? receipt.cover : null,
      ),
    );
    return receipt.message;
  }

  /// Vuelve a enviar una edición fallida (la misma operación o la misma portada). Lanza el error del envío.
  Future<String> retry(
    String key, {
    required EditSubmitter sendEdit,
    required CoverSubmitter sendCover,
  }) async {
    final index = _items.indexWhere((e) => e.key == key);
    if (index < 0) return 'Ese cambio ya no está en la lista.';
    final edit = _items[index];
    final EditReceipt receipt;
    if (edit.isCover) {
      receipt = await sendCover(
        edit.targetId!,
        base64Decode(edit.preview ?? ''),
      );
    } else {
      receipt = await sendEdit(LibraryRequest.resend(edit.payload!));
    }
    _items.removeWhere((e) => e.key == key);
    final coverKey = edit.isCover && isCoverKey(receipt.cover, edit.targetId)
        ? receipt.cover
        : null;
    _register(
      edit.copyWith(
        key: _newKey(),
        issue: receipt.issue,
        clearIssue: receipt.issue == null,
        createdAt: _clock(),
        clearClosedAt: true,
        state: kEditPending,
        clearError: true,
        coverKey: coverKey,
        clearCoverKey: coverKey == null,
      ),
    );
    return receipt.message;
  }

  /// Quita una edición de la lista (una fallida que ya no se quiere).
  Future<void> discard(String key) async {
    final before = _items.length;
    _items.removeWhere((e) => e.key == key);
    if (_items.length == before) return;
    _changed();
  }

  PendingEdit? _pendingDuplicate(PendingEdit candidate) {
    for (final edit in _items) {
      if (edit.pending && isDuplicateEdit(edit, candidate)) return edit;
    }
    return null;
  }

  void _register(PendingEdit edit) {
    // La nueva sustituye a las pendientes que deja sin efecto, y a las fallidas iguales (se ha vuelto a pedir).
    _items.removeWhere(
      (old) =>
          supersedesEdit(edit, old) ||
          (old.failed && isDuplicateEdit(old, edit)),
    );
    _items.add(edit);
    _attempt = 0;
    _cancelTimer();
    _changed();
    _schedule(first: edit.coverKey != null ? kEditCoverKeyCheck : null);
  }

  void _changed() {
    if (_disposed) return;
    _previews.removeWhere((key, _) => !_items.any((e) => e.key == key));
    unawaited(_persist());
    notifyListeners();
  }

  Future<void> _persist() async {
    try {
      await store?.write(List.of(_items));
    } catch (error) {
      debugPrint('ediciones: no se pudieron guardar las pendientes: $error');
    }
  }

  /// Revisa ahora: lee el catálogo de la web y el estado de cada incidencia, y confirma o da por fallidas.
  Future<void> check() async {
    if (_disposed || _checking) return;
    if (!_items.any((e) => e.pending)) {
      _cancelTimer();
      return;
    }
    _checking = true;
    _cancelTimer();
    try {
      EditCatalog catalog;
      try {
        final loader = loadCatalog;
        catalog = loader == null ? currentCatalog() : await loader();
      } catch (error) {
        catalog = (songs: const <Song>[], folders: const <Folder>[], ok: false);
      }
      final statuses = <int, String>{};
      for (final edit in _items.where((e) => e.pending && e.issue != null)) {
        try {
          statuses[edit.issue!] = await _fetchStatus(edit.issue!);
        } catch (error) {
          debugPrint(
            'ediciones: estado de la incidencia ${edit.issue} no disponible: $error',
          );
        }
      }
      if (_disposed) return;
      _review(catalog, statuses);
    } finally {
      _checking = false;
    }
    _attempt++;
    _schedule();
  }

  /// Con un catálogo recién leído de la web (sincronización): confirma lo que ya refleja.
  void reconcile(List<Song> songs, List<Folder> folders) {
    if (!_items.any((e) => e.pending)) return;
    _review((songs: songs, folders: folders, ok: true), const {});
  }

  void _review(EditCatalog catalog, Map<int, String> statuses) {
    final now = _clock();
    var changed = false;
    final notices = <PendingEditNotice>[];
    for (var i = 0; i < _items.length; i++) {
      final edit = _items[i];
      if (!edit.pending) continue;
      final reflected =
          catalog.ok && isEditReflected(edit, catalog.songs, catalog.folders);
      final status = edit.issue == null ? null : statuses[edit.issue];
      final result = reviewEdit(
        edit,
        now: now,
        status: status,
        reflected: reflected,
        catalogOk: catalog.ok,
      );
      switch (result.outcome) {
        case EditOutcome.confirmed:
          _items.removeAt(i);
          i--;
          changed = true;
          notices.add(
            PendingEditNotice(
              key: edit.key,
              failed: false,
              message: editConfirmedText(edit.label),
            ),
          );
          if (edit.isCover) {
            onCoverConfirmed?.call(
              edit.coverKey ?? 'covers/${edit.targetId}.jpg',
            );
          }
        case EditOutcome.failed:
          _items[i] = edit.copyWith(
            state: kEditFailed,
            error: status == 'error'
                ? 'El servidor no ha podido aplicarlo.'
                : 'No se ha confirmado a tiempo.',
            closedAt: result.closedAt,
          );
          changed = true;
          notices.add(
            PendingEditNotice(
              key: edit.key,
              failed: true,
              message: editFailedText(edit.label),
            ),
          );
        case EditOutcome.pending:
          if (result.closedAt != edit.closedAt) {
            _items[i] = edit.copyWith(closedAt: result.closedAt);
            changed = true;
          }
      }
    }
    if (changed) _changed();
    for (final notice in notices) {
      if (!_notices.isClosed) _notices.add(notice);
    }
  }

  void _schedule({Duration? first}) {
    if (_disposed ||
        _timer != null ||
        !_foreground ||
        !_items.any((e) => e.pending)) {
      return;
    }
    final generation = ++_timerGeneration;
    _timer = _timerFactory(first ?? editCheckDelay(_attempt), () {
      if (generation != _timerGeneration) return;
      _cancelTimer();
      unawaited(check());
    });
  }

  void _cancelTimer() {
    _timerGeneration++;
    _timer?.cancel();
    _timer = null;
  }

  /// Vista previa de una portada pendiente para [coverPath] (`covers/<id>.jpg` o `portadas/<id>-<hash>.jpg`), o null.
  ImageProvider? previewFor(String? coverPath) {
    if (coverPath == null) return null;
    for (final edit in _items.reversed) {
      if (!edit.pending || !edit.isCover || edit.preview == null) continue;
      if (!coverPathIsFor(coverPath, edit.targetId)) continue;
      return _previews.putIfAbsent(edit.key, () {
        try {
          return MemoryImage(base64Decode(edit.preview!));
        } catch (_) {
          return MemoryImage(Uint8List(0));
        }
      });
    }
    return null;
  }

  /// Portadas que muestran primero la vista previa de las pendientes (la misma envoltura para el mismo [inner]).
  CoverImages coverImages(CoverImages inner) =>
      _coverWrappers.putIfAbsent(inner, () => _PendingCoverImages(inner, this));

  @override
  void dispose() {
    _disposed = true;
    _cancelTimer();
    _notices.close();
    super.dispose();
  }
}

class _PendingCoverImages implements CoverImages {
  _PendingCoverImages(this.inner, this.edits)
    : _merged = Listenable.merge([inner, edits]);

  final CoverImages inner;
  final PendingEditsController edits;
  final Listenable _merged;

  @override
  ImageProvider? imageFor(String? coverPath) =>
      edits.previewFor(coverPath) ?? inner.imageFor(coverPath);

  @override
  void addListener(VoidCallback listener) => _merged.addListener(listener);

  @override
  void removeListener(VoidCallback listener) =>
      _merged.removeListener(listener);
}
