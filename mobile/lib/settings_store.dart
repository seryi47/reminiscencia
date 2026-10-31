import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_error.dart';
import 'app_settings.dart';

/// Guarda los ajustes con shared_preferences. Cada valor se lee por separado:
/// si uno está dañado, solo ese usa su valor por defecto.
class SettingsStore {
  static const String keyTextScale = 'ajustes.tamanoTexto';
  static const String keyPatientMode = 'ajustes.modoPaciente';
  static const String keyHighContrast = 'ajustes.altoContraste';
  static const String keyReduceMotion = 'ajustes.reducirAnimaciones';

  Future<AppSettings> read() async {
    final prefs = await SharedPreferences.getInstance();
    const defaults = AppSettings.defaults;
    return AppSettings(
      textScale: AppSettings.clampTextScale(
        _safely(() => prefs.getDouble(keyTextScale), defaults.textScale),
      ),
      patientMode: _safely(
        () => prefs.getBool(keyPatientMode),
        defaults.patientMode,
      ),
      highContrast: _safely(
        () => prefs.getBool(keyHighContrast),
        defaults.highContrast,
      ),
      reduceMotion: _safely(
        () => prefs.getBool(keyReduceMotion),
        defaults.reduceMotion,
      ),
    );
  }

  Future<void> write(AppSettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    final results = await Future.wait<bool>([
      prefs.setDouble(keyTextScale, settings.textScale),
      prefs.setBool(keyPatientMode, settings.patientMode),
      prefs.setBool(keyHighContrast, settings.highContrast),
      prefs.setBool(keyReduceMotion, settings.reduceMotion),
    ]);
    if (results.contains(false)) {
      throw const AppException('No se pudieron guardar los ajustes.');
    }
  }

  static T _safely<T>(T? Function() read, T fallback) {
    try {
      return read() ?? fallback;
    } catch (error) {
      debugPrint('ajustes: valor no válido, se usa el de por defecto: $error');
      return fallback;
    }
  }
}

/// Ajustes para toda la app. Cada cambio se aplica al momento y después se guarda.
class SettingsController extends ChangeNotifier {
  SettingsController({AppSettings initial = AppSettings.defaults, this.store})
    : _value = initial;

  /// Almacén de los ajustes. Si es null, los cambios viven solo mientras la app está abierta (pruebas).
  final SettingsStore? store;

  AppSettings _value;
  String? _loadError;

  AppSettings get value => _value;

  /// Aviso visible si no se pudieron leer los ajustes guardados.
  String? get loadError => _loadError;

  Future<void> load() async {
    final backing = store;
    if (backing == null) return;
    try {
      _value = await backing.read();
      _loadError = null;
    } catch (error) {
      debugPrint('ajustes: no se pudieron leer: $error');
      _loadError =
          'No se pudieron leer tus ajustes guardados. Se usan los valores por defecto.';
    }
    notifyListeners();
  }

  /// Aplica [next] al momento y lo guarda. Lanza AppException si no se pudo guardar.
  Future<void> update(AppSettings next) async {
    _value = next;
    notifyListeners();
    final backing = store;
    if (backing == null) return;
    try {
      await backing.write(next);
    } catch (error) {
      debugPrint('ajustes: no se pudieron guardar: $error');
      throw const AppException(
        'No se pudieron guardar los ajustes. Se mantendrán solo hasta cerrar la app.',
      );
    }
  }
}
