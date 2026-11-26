import 'dart:async';

import 'package:shared_preferences/shared_preferences.dart';

/// Contraseña del Worker (ADR-0052): se guarda en el teléfono y se añade como cabecera `X-Auth` a las
/// peticiones de escritura. Si la cabecera falta o no coincide, el Worker responde 401.
///
/// La contraseña nunca se le pide al usuario por diseño: la provisiona Claude Code desde el llavero
/// de la Mac (`reminiscencia-worker-auth`) o el propio usuario la pega una vez desde el portapapeles
/// en la pantalla de [AuthPromptScreen]; a partir de ahí, vive en SharedPreferences.
///
/// En las pruebas se inyecta otra implementación con `SharedPreferences.setMockInitialValues`.
abstract interface class AuthStore {
  /// Contraseña guardada ('' si no hay).
  Future<String> read();

  /// Guarda [value] (lo recorta) y la sustituye si ya había otra.
  Future<void> write(String value);

  /// Borra la contraseña: el siguiente intento abrirá [AuthPromptScreen].
  Future<void> clear();

  /// Añade `X-Auth` a [headers] si hay contraseña; añade `X-Actor: 'apk'` siempre.
  Future<Map<String, String>> withAuth([Map<String, String>? headers]);
}

/// Clave de SharedPreferences donde vive la contraseña (coincide con la de la web en localStorage).
const String kAuthPreferenceKey = 'reminiscenciaAuthPassword';

/// Valor fijo que viaja en `X-Actor` para que el Worker lo escriba en cada evento del historial.
const String kApkActor = 'apk';

/// Contraseña inyectada en el binario por el CI (`--dart-define=AUTH_PASSWORD=...`). Si viene no
/// vacía, el usuario NUNCA ve la pantalla de contraseña: la APK sale ya autenticada desde la
/// release firmada (android.yml). Si no viene (compilación local sin flag), se cae al flujo
/// de SharedPreferences + prompt.
const String kBuiltInAuthPassword = String.fromEnvironment('AUTH_PASSWORD', defaultValue: '');

class SharedPreferencesAuthStore implements AuthStore {
  SharedPreferencesAuthStore([Future<SharedPreferences> Function()? loader])
    : _loader = loader ?? SharedPreferences.getInstance;

  final Future<SharedPreferences> Function() _loader;

  @override
  Future<String> read() async {
    // Prioridad: la contraseña inyectada en el build gana sobre la guardada por el usuario.
    // Así una APK firmada por el CI sale ya autenticada sin pasar por AuthPromptScreen.
    final builtIn = kBuiltInAuthPassword.trim();
    if (builtIn.isNotEmpty) return builtIn;
    final prefs = await _loader();
    return (prefs.getString(kAuthPreferenceKey) ?? '').trim();
  }

  @override
  Future<void> write(String value) async {
    final prefs = await _loader();
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      await prefs.remove(kAuthPreferenceKey);
      return;
    }
    await prefs.setString(kAuthPreferenceKey, trimmed);
  }

  @override
  Future<void> clear() async {
    final prefs = await _loader();
    await prefs.remove(kAuthPreferenceKey);
  }

  @override
  Future<Map<String, String>> withAuth([Map<String, String>? headers]) async {
    final result = <String, String>{...?headers};
    result['X-Actor'] = kApkActor;
    final auth = await read();
    if (auth.isNotEmpty) result['X-Auth'] = auth;
    return result;
  }
}

/// Error que señala que la contraseña falta o no coincide: la UI responde pidiendo una nueva
/// (AuthPromptScreen) y, si el usuario la introduce, se reintenta la operación.
class AuthRequiredException implements Exception {
  const AuthRequiredException([this.message = 'Falta contraseña del Worker.']);
  final String message;
  @override
  String toString() => message;
}
