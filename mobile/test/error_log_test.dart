import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/error_log.dart';

/// Registro de errores no capturados: entradas con hora y traza, tamaño acotado y nunca lanza.
void main() {
  late Directory tmp;
  setUp(() => tmp = Directory.systemTemp.createTempSync('registro_'));
  tearDown(() => tmp.deleteSync(recursive: true));

  ErrorLog logIn(String path, {int maxBytes = kErrorLogMaxBytes}) => ErrorLog(
    File(path),
    maxBytes: maxBytes,
    clock: () => DateTime(2026, 11, 10, 9, 30),
  );

  test('escribe hora, origen, error y traza, y crea la carpeta', () async {
    final log = logIn('${tmp.path}/registro/errores.log');
    await log.record('plataforma', StateError('roto'), StackTrace.current);
    final text = File('${tmp.path}/registro/errores.log').readAsStringSync();
    expect(
      text,
      contains('[2026-11-10T09:30:00.000] plataforma: Bad state: roto'),
    );
    expect(text, contains('error_log_test.dart'));
  });

  test(
    'rota al pasar del tamaño máximo: como mucho dos ficheros acotados',
    () async {
      final path = '${tmp.path}/errores.log';
      final log = logIn(path, maxBytes: 300);
      for (var i = 0; i < 40; i++) {
        await log.record('flutter', 'error número $i ${'x' * 40}');
      }
      final current = File(path);
      final previous = File('$path.1');
      expect(previous.existsSync(), isTrue);
      expect(current.lengthSync(), lessThanOrEqualTo(300));
      expect(previous.lengthSync(), lessThanOrEqualTo(300));
      expect(current.readAsStringSync(), contains('error número 39'));
      expect(tmp.listSync(), hasLength(2));
    },
  );

  test('si no puede escribir, no lanza', () async {
    // Una carpeta donde debería ir el fichero: escribir falla.
    Directory('${tmp.path}/ocupado').createSync();
    final log = logIn('${tmp.path}/ocupado');
    await expectLater(log.record('flutter', 'nada'), completes);
  });

  test(
    'los manejadores registran los errores de Flutter y de la plataforma',
    () async {
      final path = '${tmp.path}/errores.log';
      final log = logIn(path);
      final previousFlutter = FlutterError.onError;
      final previousPlatform = PlatformDispatcher.instance.onError;
      final seen = <FlutterErrorDetails>[];
      FlutterError.onError = seen.add;
      try {
        installErrorHandlers(log);
        FlutterError.onError!(
          FlutterErrorDetails(exception: Exception('al pintar')),
        );
        final handled = PlatformDispatcher.instance.onError!(
          Exception('Future sin catch'),
          StackTrace.empty,
        );
        expect(handled, isTrue);
        await log.record('fin', 'fin');
      } finally {
        FlutterError.onError = previousFlutter;
        PlatformDispatcher.instance.onError = previousPlatform;
      }
      // El manejador anterior de Flutter se sigue llamando (en depuración, la consola).
      expect(seen, hasLength(1));
      final text = File(path).readAsStringSync();
      expect(text, contains('flutter: Exception: al pintar'));
      expect(text, contains('plataforma: Exception: Future sin catch'));
    },
  );
}
