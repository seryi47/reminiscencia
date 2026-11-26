// Comprueba por grep estático que las listas potencialmente largas usan `ListView.builder`
// (virtualización nativa) en vez de `ListView(children: ...)` o `Column`+`SingleChildScrollView`.
// Este test no monta widgets: valida la invariante de arquitectura descrita en el ADR-0052.

import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('las pantallas con listas potencialmente largas usan ListView.builder', () {
    // Paths relativos al directorio del paquete Flutter (mobile/), que es el cwd de `flutter test`.
    const checkpoints = <_Checkpoint>[
      _Checkpoint('lib/ui/spotify_transfer_page.dart', expectedBuilderCount: 3),
      _Checkpoint('lib/ui/playlist_flows.dart', expectedBuilderCount: 1),
      _Checkpoint('lib/ui/library_edit.dart', expectedBuilderCount: 2),
    ];
    for (final c in checkpoints) {
      final f = File(c.path);
      expect(f.existsSync(), isTrue, reason: 'falta ${c.path}');
      final src = f.readAsStringSync();
      final builderCount = 'ListView.builder'.allMatches(src).length;
      expect(
        builderCount >= c.expectedBuilderCount,
        isTrue,
        reason: '${c.path}: se esperaban ≥${c.expectedBuilderCount} ListView.builder, encontrados $builderCount',
      );
      // No debe quedar `ListView(` sin virtualización en esos ficheros (excluyendo `ListView.builder`).
      final rawListView = RegExp(r'ListView\(\s*(?:shrinkWrap|children)').allMatches(src).length;
      expect(
        rawListView,
        0,
        reason: '${c.path}: aún hay ListView(children:...) sin virtualizar ($rawListView ocurrencias)',
      );
    }
  });
}

class _Checkpoint {
  const _Checkpoint(this.path, {required this.expectedBuilderCount});
  final String path;
  final int expectedBuilderCount;
}
