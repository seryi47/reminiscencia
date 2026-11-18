import 'dart:async';
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Historial persistente de reconocimientos (ADR-0048): para ver qué identificó la app en cada toque y poder reintentar
/// una descarga que falló. Guardado en SharedPreferences como JSON; cap de 100 entradas (las más antiguas caen al tope).

const String _kHistoryKey = 'reminiscencia.recognition.history.v1';
const int _kHistoryMaxEntries = 100;

enum RecognitionHistoryStatus {
  /// Match por biblioteca: la canción ya existe; abre en el reproductor y ya.
  inLibrary,
  /// Match por letra: la canción no está en biblioteca; falta importar.
  pendingImport,
  /// Match por letra: se añadió correctamente a la biblioteca.
  imported,
  /// La importación falló; el usuario puede reintentar desde el historial.
  importFailed,
  /// No se identificó nada.
  notMatched,
}

class RecognitionHistoryEntry {
  const RecognitionHistoryEntry({
    required this.id,
    required this.at,
    required this.status,
    this.title = '',
    this.artist = '',
    this.songId,
    this.source = '',
    this.confidence = 0,
  });

  /// Identificador único (microsegundos del reloj del reloj del dispositivo + aleatorio).
  final String id;
  final DateTime at;
  final RecognitionHistoryStatus status;
  final String title;
  final String artist;
  final String? songId;
  final String source; // 'library' | 'lyrics' | ''
  final double confidence;

  RecognitionHistoryEntry copyWith({RecognitionHistoryStatus? status}) => RecognitionHistoryEntry(
        id: id,
        at: at,
        status: status ?? this.status,
        title: title,
        artist: artist,
        songId: songId,
        source: source,
        confidence: confidence,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'at': at.toIso8601String(),
        'status': status.name,
        'title': title,
        'artist': artist,
        'songId': songId,
        'source': source,
        'confidence': confidence,
      };

  static RecognitionHistoryEntry? fromJson(Map<String, dynamic> json) {
    try {
      final at = DateTime.tryParse(json['at'] as String? ?? '') ?? DateTime.now();
      final statusName = json['status'] as String? ?? 'notMatched';
      final status = RecognitionHistoryStatus.values.firstWhere(
        (s) => s.name == statusName,
        orElse: () => RecognitionHistoryStatus.notMatched,
      );
      return RecognitionHistoryEntry(
        id: json['id'] as String? ?? '',
        at: at,
        status: status,
        title: json['title'] as String? ?? '',
        artist: json['artist'] as String? ?? '',
        songId: json['songId'] as String?,
        source: json['source'] as String? ?? '',
        confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
      );
    } catch (_) {
      return null;
    }
  }
}

class RecognitionHistory {
  RecognitionHistory();

  final StreamController<List<RecognitionHistoryEntry>> _controller = StreamController.broadcast();
  List<RecognitionHistoryEntry> _entries = const [];
  bool _loaded = false;

  Stream<List<RecognitionHistoryEntry>> get stream => _controller.stream;
  List<RecognitionHistoryEntry> get entries => _entries;

  Future<void> load() async {
    if (_loaded) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kHistoryKey);
      if (raw != null && raw.isNotEmpty) {
        final list = jsonDecode(raw);
        if (list is List) {
          _entries = list
              .whereType<Map<String, dynamic>>()
              .map(RecognitionHistoryEntry.fromJson)
              .whereType<RecognitionHistoryEntry>()
              .toList();
        }
      }
    } catch (_) { /* arrancar con lista vacía */ }
    _loaded = true;
    _controller.add(_entries);
  }

  Future<void> add(RecognitionHistoryEntry entry) async {
    await load();
    _entries = [entry, ..._entries];
    if (_entries.length > _kHistoryMaxEntries) {
      _entries = _entries.sublist(0, _kHistoryMaxEntries);
    }
    await _persist();
    _controller.add(_entries);
  }

  Future<void> updateStatus(String id, RecognitionHistoryStatus status) async {
    await load();
    _entries = [
      for (final e in _entries) e.id == id ? e.copyWith(status: status) : e,
    ];
    await _persist();
    _controller.add(_entries);
  }

  Future<void> clear() async {
    _entries = const [];
    await _persist();
    _controller.add(_entries);
  }

  Future<void> _persist() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kHistoryKey, jsonEncode(_entries.map((e) => e.toJson()).toList()));
    } catch (_) { /* seguir en memoria si no se puede guardar */ }
  }

  void dispose() {
    _controller.close();
  }
}
