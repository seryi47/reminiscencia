import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/battery_saver.dart';

void main() {
  group('BatterySaver helpers (ADR-0052)', () {
    test('long-poll es 25 s normal y 10 s en ahorro', () {
      expect(catalogWaitSeconds(batterySaver: false), 25);
      expect(catalogWaitSeconds(batterySaver: true), 10);
    });

    test('prefetch de la siguiente canción solo en modo normal', () {
      expect(prefetchNextSong(batterySaver: false), isTrue);
      expect(prefetchNextSong(batterySaver: true), isFalse);
    });

    test('update check: Duration.zero en normal, 1 día en ahorro', () {
      expect(updateCheckMinInterval(batterySaver: false), Duration.zero);
      expect(
        updateCheckMinInterval(batterySaver: true),
        const Duration(days: 1),
      );
    });

    test('background pausa long-poll antes en ahorro que en normal', () {
      expect(backgroundPollPauseAfterMs(batterySaver: false), 60_000);
      expect(backgroundPollPauseAfterMs(batterySaver: true), 10_000);
    });

    test('bitrate preferido es 64 kbps normal y 48 kbps en ahorro', () {
      expect(preferredBitrateKbps(batterySaver: false), 64);
      expect(preferredBitrateKbps(batterySaver: true), 48);
    });
  });
}
