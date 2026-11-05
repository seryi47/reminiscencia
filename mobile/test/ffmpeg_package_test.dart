import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  // El paquete «_min» de ffmpeg-kit no incluye libopus: la conversión a Opus fallaba en el teléfono con
  // «No se pudo convertir este archivo a Opus» (y no se veía en las pruebas, que no ejecutan FFmpeg).
  test('FFmpeg viene con libopus (paquete _audio, no _min)', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    expect(pubspec, contains('ffmpeg_kit_flutter_new_audio'));
    expect(pubspec, isNot(contains('ffmpeg_kit_flutter_new_min')));
  });
}
