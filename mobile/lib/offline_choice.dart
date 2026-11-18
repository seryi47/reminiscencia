import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Si se guarda la biblioteca para escuchar sin conexión. Por defecto **desactivado** (ADR-0051, 1.4.11): auto-bajar
/// cientos de canciones al primer arranque, o cada vez que el bitrate del catálogo cambia, saturaba el hilo UI y
/// provocaba ANR («System UI isn't responding») en móviles sensibles. El usuario lo activa a mano desde Inicio o
/// Ajustes.
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
