import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Si el usuario pidió escuchar la biblioteca sin conexión. Con esa opción, la sincronización
/// descarga las canciones nuevas, pero solo en Wi-Fi (ver NetworkInfo).
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
      return prefs.getBool(key) ?? false;
    } catch (error) {
      debugPrint('biblioteca: no se pudo leer la opción sin conexión: $error');
      return false;
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
