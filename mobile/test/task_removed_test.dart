import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('al quitar la app de recientes el handler para la música', () {
    final source = File('lib/sonidos_audio_handler.dart').readAsStringSync();
    expect(source, contains('Future<void> onTaskRemoved() => stop();'));
  });
}
