import 'package:flutter/services.dart';

/// Lanzador del instalador de paquetes de Android para la auto-actualización (ADR-0047). Descargado el APK a la caché
/// interna, abrimos el instalador del sistema con FileProvider; el usuario sigue siendo quien aprueba la instalación.
class ApkInstaller {
  static const MethodChannel _channel = MethodChannel('reminiscencia/installer');

  /// Entrega el APK al instalador del sistema. Lanza una `PlatformException` si falla (sin permiso, sin actividad que
  /// maneje el intent, etc.); la vista decide si caer a abrir el navegador.
  static Future<void> install(String apkPath) async {
    await _channel.invokeMethod<void>('install', {'path': apkPath});
  }

  /// ¿El usuario ya autorizó instalar desde esta app? En Android 8+ (API 26) hace falta permiso explícito; antes, siempre
  /// true. Útil para decidir si enviamos al usuario a Ajustes antes de descargar.
  static Future<bool> canRequestInstall() async {
    final result = await _channel.invokeMethod<bool>('canRequestInstall');
    return result ?? false;
  }

  /// Abre la pantalla de «permitir instalar aplicaciones desconocidas» para esta app.
  static Future<void> openInstallPermissionSettings() async {
    await _channel.invokeMethod<void>('openInstallPermissionSettings');
  }
}
