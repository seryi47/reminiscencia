import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Si se guarda la biblioteca para escuchar sin conexión (activo por defecto, el usuario puede desactivarlo). Con esa opción, la sincronización
/// descarga las canciones nuevas, con cualquier conexión, también con datos móviles.
abstract interface class OfflineChoice {
  Future<bool> read();
  Future<void> write(bool value);
}

class SharedPrefsOfflineChoice implements OfflineChoice {
  static const String key = 'biblioteca.sinConexion';

  @override
  Future<bool> read() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getBool(key) ?? true;
    } catch (error) {
      debugPrint('biblioteca: no se pudo leer la opción sin conexión: $error');
      return true;
    }
  }

  @override
  Future<void> write(bool value) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(key, value);
    } catch (error) {
      debugPrint(
        'biblioteca: no se pudo guardar la opción sin conexión: $error',
      );
    }
  }
}
