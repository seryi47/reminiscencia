import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/duplicates.dart';

// Contrato común de «posible duplicado» (ADR-0026): los mismos datos y casos que el backend y la web.
Map<String, dynamic> _contract() {
  final file = File('../tests/contrato/duplicados.json');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

DuplicateCandidate _candidate(Map<String, dynamic> json) => DuplicateCandidate(
  title: json['title'] as String,
  artist: (json['artist'] as String?) ?? '',
  durationS: (json['duration_s'] as num?)?.toDouble(),
);

void main() {
  final contract = _contract();

  test('los datos son los del contrato común', () {
    expect(kDuplicateToleranceS, contract['tolerancia_s']);
    expect(kFoldFrom, contract['pliegue']['de']);
    expect(kFoldTo, contract['pliegue']['a']);
    expect(kFoldFrom.length, kFoldTo.length);
    expect(kDuplicateTags, List<String>.from(contract['etiquetas'] as List));
    expect(
      kFeaturingMarks,
      List<String>.from(contract['marcas_featuring'] as List),
    );
  });

  test('normaliza los títulos como el contrato', () {
    final cases = contract['normalizar_titulo'] as List;
    expect(cases, isNotEmpty);
    for (final item in cases.cast<Map<String, dynamic>>()) {
      expect(
        normalizeDuplicateTitle(item['entrada'] as String),
        item['salida'],
        reason: item['entrada'] as String,
      );
    }
  });

  test('normaliza los artistas como el contrato', () {
    for (final item
        in (contract['normalizar_artista'] as List)
            .cast<Map<String, dynamic>>()) {
      expect(
        normalizeDuplicateArtist(item['entrada'] as String),
        item['salida'],
        reason: item['entrada'] as String,
      );
    }
  });

  test('«artista título» como el contrato (ADR-0032)', () {
    final cases = (contract['titulo_con_artista'] as List)
        .cast<Map<String, dynamic>>();
    expect(cases, isNotEmpty);
    for (final item in cases) {
      final song = _candidate(item['entrada'] as Map<String, dynamic>);
      expect(titleWithArtist(song), item['salida'], reason: song.title);
    }
  });

  test('un archivo «Artista - Título» avisa de la canción ya limpia', () {
    final found = findUploadDuplicates(
      const [DuplicateCandidate(title: 'Bad Bunny - Monaco')],
      const [
        DuplicateCandidate(
          title: 'Monaco',
          artist: 'Bad Bunny',
          durationS: 201,
        ),
      ],
    );
    expect(found, hasLength(1));
    expect(found.single.inBatch, isFalse);
  });

  test('cada caso da lo mismo que el contrato, en los dos sentidos', () {
    final cases = (contract['casos'] as List).cast<Map<String, dynamic>>();
    expect(cases, isNotEmpty);
    for (final item in cases) {
      final a = _candidate(item['a'] as Map<String, dynamic>);
      final b = _candidate(item['b'] as Map<String, dynamic>);
      final reason = item['nota'] as String;
      expect(isPossibleDuplicate(a, b), item['duplicado'], reason: reason);
      expect(isPossibleDuplicate(b, a), item['duplicado'], reason: reason);
    }
  });

  group('findUploadDuplicates', () {
    const library = [
      DuplicateCandidate(
        title: 'Corazón de mimbre',
        artist: 'Marea',
        durationS: 201,
      ),
    ];

    test('avisa de la biblioteca antes que de la propia tanda', () {
      final found = findUploadDuplicates(const [
        DuplicateCandidate(title: 'Otra', durationS: 100),
        DuplicateCandidate(
          title: 'Corazon de mimbre (Official Video)',
          durationS: 202,
        ),
        DuplicateCandidate(title: 'otra [HD]', durationS: 101),
        DuplicateCandidate(title: 'Sin parecido', durationS: 50),
      ], library);
      expect(found.map((item) => item.index), [1, 2]);
      expect(found[0].inBatch, isFalse);
      expect(
        found[0].message,
        'Parece que ya está en la biblioteca: «Corazón de mimbre» (3:21). ¿Subirla igualmente?',
      );
      expect(found[1].inBatch, isTrue);
      expect(
        found[1].message,
        'Parece repetida en esta subida: «Otra» (1:40). ¿Subirla igualmente?',
      );
    });

    test('sin duración conocida el aviso no la muestra', () {
      final found = findUploadDuplicates(
        const [DuplicateCandidate(title: 'Pista', artist: '')],
        const [DuplicateCandidate(title: 'pista', artist: '')],
      );
      expect(
        found.single.message,
        'Parece que ya está en la biblioteca: «pista». ¿Subirla igualmente?',
      );
    });
  });
}
