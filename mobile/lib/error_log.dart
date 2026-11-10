import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// Tamaño máximo del registro de errores antes de rotarlo (se guarda el anterior como `.1`): como mucho el doble.
const int kErrorLogMaxBytes = 256 * 1024;

/// Registro de errores no capturados en un fichero pequeño del teléfono, para que en la versión de producción un
/// fallo no pase en silencio. No hay interfaz: se lee con `adb` (run-as) o se adjunta a una incidencia a mano.
/// Rota al pasar de [maxBytes]: `errores.log` y `errores.log.1`. Las escrituras van en fila y nunca lanzan.
class ErrorLog {
  ErrorLog(
    this.file, {
    this.maxBytes = kErrorLogMaxBytes,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final File file;
  final int maxBytes;
  final DateTime Function() _clock;
  Future<void> _pending = Future<void>.value();

  /// Registro en `<soporte de la app>/registro/errores.log` (fuera de la copia de seguridad del sistema).
  static Future<ErrorLog> open() async {
    final dir = await getApplicationSupportDirectory();
    return ErrorLog(File('${dir.path}/registro/errores.log'));
  }

  /// Añade una entrada con la hora, el origen, el error y su traza.
  Future<void> record(String origin, Object error, [StackTrace? stack]) {
    final entry = StringBuffer()
      ..writeln('[${_clock().toIso8601String()}] $origin: $error');
    if (stack != null) entry.writeln(stack.toString().trimRight());
    _pending = _pending.then((_) => _write(entry.toString()));
    return _pending;
  }

  Future<void> _write(String entry) async {
    try {
      await file.parent.create(recursive: true);
      if (await file.exists() &&
          await file.length() + entry.length > maxBytes) {
        await file.rename('${file.path}.1');
      }
      await file.writeAsString(entry, mode: FileMode.append, flush: true);
    } catch (error) {
      debugPrint('registro: no se pudo escribir: $error');
    }
  }
}

/// Instala los manejadores de errores no capturados: los de Flutter (construcción y pintado) y los de la
/// plataforma (Futures y callbacks sin `catch`). Se escriben en la consola y en [log]; la app sigue como siempre.
void installErrorHandlers(ErrorLog log) {
  final previous = FlutterError.onError;
  FlutterError.onError = (details) {
    previous?.call(details);
    unawaited(log.record('flutter', details.exception, details.stack));
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    debugPrint('error no capturado: $error\n$stack');
    unawaited(log.record('plataforma', error, stack));
    return true;
  };
}
