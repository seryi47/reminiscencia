import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_settings.dart';
import 'package:reminiscencia/settings_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('AppSettings (ADR-0052)', () {
    test('defaults OFF para los flags nuevos', () {
      const s = AppSettings.defaults;
      expect(s.batterySaver, isFalse);
      expect(s.oledTheme, isFalse);
    });

    test('copyWith conserva lo demás y cambia solo lo pedido', () {
      const base = AppSettings(textScale: 1.3, highContrast: true);
      final a = base.copyWith(batterySaver: true);
      expect(a.batterySaver, isTrue);
      expect(a.oledTheme, isFalse);
      expect(a.highContrast, isTrue);
      expect(a.textScale, 1.3);

      final b = a.copyWith(oledTheme: true);
      expect(b.oledTheme, isTrue);
      expect(b.batterySaver, isTrue);
    });

    test('equals / hashCode distinguen los dos flags', () {
      const base = AppSettings.defaults;
      final withBattery = base.copyWith(batterySaver: true);
      final withOled = base.copyWith(oledTheme: true);
      expect(withBattery == withOled, isFalse);
      expect(withBattery.hashCode, isNot(withOled.hashCode));
      expect(withBattery.copyWith() == withBattery, isTrue);
    });
  });

  group('SettingsStore persistencia (ADR-0052)', () {
    test('escribir + leer recupera batterySaver y oledTheme', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final store = SettingsStore();
      await store.write(
        const AppSettings(
          textScale: 1.2,
          highContrast: false,
          reduceMotion: true,
          batterySaver: true,
          oledTheme: true,
        ),
      );
      final back = await store.read();
      expect(back.batterySaver, isTrue);
      expect(back.oledTheme, isTrue);
      expect(back.reduceMotion, isTrue);
      expect(back.textScale, 1.2);
    });

    test(
      'leer sin valores persistidos devuelve los defaults OFF para los flags nuevos',
      () async {
        SharedPreferences.setMockInitialValues(<String, Object>{});
        final store = SettingsStore();
        final result = await store.read();
        expect(result.batterySaver, isFalse);
        expect(result.oledTheme, isFalse);
      },
    );
  });
}
