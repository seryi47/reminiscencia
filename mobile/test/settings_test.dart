import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/app_settings.dart';
import 'package:reminiscencia/settings_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _UnreadableStore extends SettingsStore {
  @override
  Future<AppSettings> read() async => throw StateError('almacén dañado');
}

class _UnwritableStore extends SettingsStore {
  @override
  Future<void> write(AppSettings settings) async =>
      throw StateError('disco lleno');
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('modelo de ajustes', () {
    test('los valores por defecto son texto 1.0 y todo lo demás apagado', () {
      const settings = AppSettings();
      expect(settings.textScale, 1.0);
      expect(settings.patientMode, isFalse);
      expect(settings.highContrast, isFalse);
      expect(settings.reduceMotion, isFalse);
    });

    test('el tamaño de texto se acota entre 1.0 y 1.6', () {
      expect(AppSettings.clampTextScale(0.5), 1.0);
      expect(AppSettings.clampTextScale(2.0), 1.6);
      expect(AppSettings.clampTextScale(1.3), closeTo(1.3, 1e-9));
      expect(AppSettings.clampTextScale(double.nan), 1.0);
      expect(const AppSettings().copyWith(textScale: 9).textScale, 1.6);
    });

    test('copyWith cambia solo lo indicado y la igualdad compara valores', () {
      const base = AppSettings();
      final changed = base.copyWith(patientMode: true);
      expect(changed.patientMode, isTrue);
      expect(changed.textScale, base.textScale);
      expect(changed, const AppSettings(patientMode: true));
      expect(changed == base, isFalse);
    });
  });

  group('SettingsStore sobre shared_preferences', () {
    test('sin datos guardados se leen los valores por defecto', () async {
      expect(await SettingsStore().read(), AppSettings.defaults);
    });

    test('lo que se guarda se vuelve a leer igual', () async {
      final store = SettingsStore();
      const saved = AppSettings(
        textScale: 1.4,
        patientMode: true,
        highContrast: true,
        reduceMotion: true,
      );
      await store.write(saved);
      expect(await store.read(), saved);
    });

    test(
      'un valor de tipo incorrecto usa su valor por defecto sin tocar los demás',
      () async {
        SharedPreferences.setMockInitialValues({
          SettingsStore.keyTextScale: 'grande',
          SettingsStore.keyPatientMode: true,
        });
        final read = await SettingsStore().read();
        expect(read.textScale, 1.0);
        expect(read.patientMode, isTrue);
      },
    );

    test('un tamaño guardado fuera de rango se acota al leerlo', () async {
      SharedPreferences.setMockInitialValues({SettingsStore.keyTextScale: 3.0});
      expect((await SettingsStore().read()).textScale, 1.6);
    });
  });

  group('SettingsController', () {
    test('aplica el cambio al momento y lo guarda', () async {
      final store = SettingsStore();
      final controller = SettingsController(store: store);
      await controller.load();
      await controller.update(controller.value.copyWith(highContrast: true));
      expect(controller.value.highContrast, isTrue);
      expect((await store.read()).highContrast, isTrue);
    });

    test(
      'si no se pueden leer los ajustes, usa los de por defecto y deja el aviso',
      () async {
        final controller = SettingsController(store: _UnreadableStore());
        await controller.load();
        expect(controller.value, AppSettings.defaults);
        expect(controller.loadError, isNotNull);
      },
    );

    test(
      'si no se puede guardar, el cambio se aplica y el usuario recibe un aviso',
      () async {
        final controller = SettingsController(store: _UnwritableStore());
        await expectLater(
          controller.update(const AppSettings(reduceMotion: true)),
          throwsA(isA<AppException>()),
        );
        expect(controller.value.reduceMotion, isTrue);
      },
    );
  });
}
