import 'package:flutter_test/flutter_test.dart';
import 'package:sonidos_recordar/song.dart';

void main() {
  test('Song lee el índice generado por build-web', () {
    final song = Song.fromJson({
      'id': 'S5aac103b6eb2ecf4',
      'title': 'Charleston (Fox Trot)',
      'duration_s': 242.416327,
      'license': 'Dominio público según Internet Archive',
      'audio': 'audio/S5aac103b6eb2ecf4.opus',
    });

    expect(song.title, 'Charleston (Fox Trot)');
    expect(song.durationS, closeTo(242.42, 0.01));
    expect(song.assetPath, 'assets/audio/S5aac103b6eb2ecf4.opus');
  });

  test('duration_s entero también se acepta', () {
    final song = Song.fromJson({
      'id': 'S1',
      'title': 'Pista',
      'duration_s': 180,
      'license': 'CC0',
      'audio': 'audio/S1.opus',
    });

    expect(song.durationS, 180.0);
  });
}
