import 'dart:math';

import 'package:flutter/foundation.dart';

import 'local_audio.dart';

/// Canciones que se bajan a la vez al guardar para escuchar sin conexión (ADR-0033). El audio lo sirve el Worker, sin
/// el límite de r2.dev (ADR-0031); es el mismo límite que la web (`OFFLINE_CONCURRENCY`, js/offline-downloads.js).
const int kOfflineConcurrency = 4;

/// Progreso de «Guardar para escuchar sin conexión»: canciones hechas de las que había que comprobar (lo ya guardado
/// cuenta como hecho), fallidas y bytes recibidos. Es inmutable: un ValueNotifier lo cambia entero y solo se repinta
/// lo que lo escucha (no la pantalla entera).
@immutable
class OfflineProgress {
  const OfflineProgress({
    required this.done,
    required this.total,
    this.bytes = 0,
    this.failed = 0,
  });

  /// Antes de saber qué falta.
  static const OfflineProgress preparing = OfflineProgress(done: 0, total: 0);

  final int done;
  final int total;
  final int bytes;
  final int failed;

  /// De 0 a 1 (lo guardado y lo fallido ya no se espera), o null mientras se prepara (anillo indeterminado).
  double? get fraction =>
      total <= 0 ? null : ((done + failed) / total).clamp(0.0, 1.0);

  /// «Guardando 3 de 8 · 2,4 MB» (sin bytes hasta el primero; «Preparando…» antes de saber cuántas faltan).
  String get text {
    if (total <= 0) return 'Preparando…';
    final base = 'Guardando $done de $total';
    return bytes > 0 ? '$base · ${formatMegabytes(bytes)}' : base;
  }

  OfflineProgress copyWith({int? done, int? total, int? bytes, int? failed}) =>
      OfflineProgress(
        done: done ?? this.done,
        total: total ?? this.total,
        bytes: bytes ?? this.bytes,
        failed: failed ?? this.failed,
      );

  @override
  bool operator ==(Object other) =>
      other is OfflineProgress &&
      other.done == done &&
      other.total == total &&
      other.bytes == bytes &&
      other.failed == failed;

  @override
  int get hashCode => Object.hash(done, total, bytes, failed);

  @override
  String toString() => 'OfflineProgress($done/$total, $bytes B, $failed)';
}

/// Error de una canción cuya descarga se ha cancelado (no cuenta como fallo).
class OfflineCancelled implements Exception {
  const OfflineCancelled();

  @override
  String toString() => 'Descarga cancelada.';
}

/// Cancelación de una descarga. Lo ya guardado se queda; lo que se estaba bajando se corta y no deja ficheros a medias.
class OfflineCancel {
  bool _cancelled = false;
  final List<void Function()> _listeners = [];

  bool get cancelled => _cancelled;

  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    for (final listener in List.of(_listeners)) {
      listener();
    }
    _listeners.clear();
  }

  /// [listener] se llama al cancelar (enseguida si ya estaba cancelada). Devuelve la función para quitarlo.
  void Function() onCancel(void Function() listener) {
    if (_cancelled) {
      listener();
      return () {};
    }
    _listeners.add(listener);
    return () => _listeners.remove(listener);
  }
}

/// Ejecuta [work] sobre cada elemento de [items], en el orden de la lista y con como mucho [limit] a la vez. Si [cancel]
/// se activa, no se empieza ninguno más (los que están en marcha terminan o se cortan solos). Un fallo de [work] no
/// para a los demás: quien llama recoge cada resultado.
Future<void> runLimited<T>(
  List<T> items,
  int limit,
  Future<void> Function(T item) work, {
  OfflineCancel? cancel,
}) async {
  var next = 0;
  Future<void> worker() async {
    while (next < items.length && !(cancel?.cancelled ?? false)) {
      final item = items[next];
      next += 1;
      try {
        await work(item);
      } catch (error) {
        debugPrint('descarga: $error');
      }
    }
  }

  final workers = min(max(1, limit), items.length);
  await Future.wait([for (var i = 0; i < workers; i++) worker()]);
}
