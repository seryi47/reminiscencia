import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/fingerprint.dart';

Float32List tone(double freq, double seconds, {double amplitude = 0.5}) {
  final n = (kFingerprintSampleRate * seconds).round();
  final out = Float32List(n);
  for (var i = 0; i < n; i++) {
    out[i] = amplitude * math.sin(2 * math.pi * freq * i / kFingerprintSampleRate);
  }
  return out;
}

void main() {
  group('fingerprint (Dart)', () {
    test('audio más corto que la ventana da lista vacía', () {
      expect(fingerprint(Float32List(kFingerprintWindowSize - 1)), isEmpty);
    });

    test('un tono de 8 s a 1 kHz genera muchos hashes y es determinista', () {
      final t = tone(1000, 8);
      final a = fingerprint(t);
      final b = fingerprint(t);
      expect(a.length, greaterThan(100));
      expect(a.length, equals(b.length));
      for (var i = 0; i < a.length; i++) {
        expect(a[i].hash, equals(b[i].hash));
        expect(a[i].offset, equals(b[i].offset));
      }
    });

    test('tonos distintos tienen muy pocos hashes en común', () {
      final a = fingerprint(tone(500, 4));
      final b = fingerprint(tone(1500, 4));
      final setA = a.map((h) => h.hash).toSet();
      final setB = b.map((h) => h.hash).toSet();
      final shared = setA.intersection(setB).length;
      final overlap = shared / math.min(setA.length, setB.length);
      expect(overlap, lessThan(0.6));
    });

    test('empaqueta/desempaqueta hash: (12, 25, 7) — 6b anchor | 6b target | 10b delta', () {
      const anchorBand = 12, targetBand = 25, delta = 7;
      final packed = (anchorBand & 0x3F) << 16 | (targetBand & 0x3F) << 10 | (delta & 0x3FF);
      final unpacked = unpackHash(packed);
      expect(unpacked.anchorBand, equals(anchorBand));
      expect(unpacked.targetBand, equals(targetBand));
      expect(unpacked.deltaFrames, equals(delta));
    });

    test('PCM 16-LE → Float32: 0, +1, -1', () {
      final buf = Uint8List.fromList([0x00, 0x00, 0xFF, 0x7F, 0x00, 0x80]);
      final f = pcm16leToFloat32(buf);
      expect(f[0], 0);
      expect((f[1] - 1.0).abs(), lessThan(0.001));
      expect(f[2], -1);
    });
  });
}
