import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/duplicates.dart';
import 'package:reminiscencia/library_match.dart';

// Contrato común de presencia en biblioteca (ADR-0046): los mismos datos y casos que la web (library-match.js).
Map<String, dynamic> _contract() {
  final file = File('../tests/contrato/biblioteca-match.json');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

DuplicateCandidate _side(Map<String, dynamic> json) => DuplicateCandidate(
  title: json['title'] as String,
  artist: (json['artist'] as String?) ?? '',
  durationS: (json['duration_s'] as num?)?.toDouble(),
);

void main() {
  final contract = _contract();

  test('los datos son los del contrato común', () {
    expect(kLibraryMatchToleranceS, (contract['tolerancia_s'] as num).toDouble());
    expect(kNeutralVersionTags, List<String>.from(contract['etiquetas_neutras'] as List));
  });

  test('la clave de título es la del contrato', () {
    final cases = contract['clave_titulo'] as List;
    expect(cases, isNotEmpty);
    for (final item in cases.cast<Map<String, dynamic>>()) {
      expect(libraryTitleKey(item['entrada'] as String), item['salida'],
          reason: 'clave de «${item['entrada']}»');
    }
  });

  test('los casos dan el resultado del contrato, en los dos sentidos', () {
    final cases = contract['casos'] as List;
    expect(cases, isNotEmpty);
    for (final item in cases.cast<Map<String, dynamic>>()) {
      final a = _side((item['a'] as Map).cast<String, dynamic>());
      final b = _side((item['b'] as Map).cast<String, dynamic>());
      expect(isSameLibraryTrack(a, b), item['esperado'], reason: '${item['nota']} (a,b)');
      expect(isSameLibraryTrack(b, a), item['esperado'], reason: '${item['nota']} (b,a)');
    }
  });

  test('regresión: un «Remastered» o un «feat.» no hacen que una canción tuya aparezca como que falta', () {
    expect(
      isSameLibraryTrack(
        const DuplicateCandidate(title: 'Clocks', artist: 'Coldplay', durationS: 307),
        const DuplicateCandidate(title: 'Clocks (Remastered 2011)', artist: 'Coldplay', durationS: 307),
      ),
      isTrue,
    );
    expect(
      isSameLibraryTrack(
        const DuplicateCandidate(title: 'Dakiti', artist: 'Bad Bunny', durationS: 205),
        const DuplicateCandidate(title: 'Dakiti', artist: 'Bad Bunny, Jhay Cortez', durationS: 208),
      ),
      isTrue,
    );
  });

  test('solape parcial de artista pero otra canción (duración muy distinta): NO la tienes', () {
    expect(
      isSameLibraryTrack(
        const DuplicateCandidate(title: 'Forever', artist: 'Drake', durationS: 357),
        const DuplicateCandidate(title: 'Forever', artist: 'Chris Brown, Lil Wayne, Drake', durationS: 290),
      ),
      isFalse,
    );
  });

  test('una versión en directo NO cuenta como que ya la tienes', () {
    expect(
      isSameLibraryTrack(
        const DuplicateCandidate(title: 'Fix You', artist: 'Coldplay', durationS: 295),
        const DuplicateCandidate(title: 'Fix You (Live)', artist: 'Coldplay', durationS: 300),
      ),
      isFalse,
    );
  });
}
