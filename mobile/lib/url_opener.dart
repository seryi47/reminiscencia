import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

/// Abre una dirección en el navegador del teléfono. Devuelve false si no se pudo.
typedef UrlOpener = Future<bool> Function(Uri uri);

/// Implementación real: navegador externo (la app no guarda ni ve ninguna sesión de GitHub).
Future<bool> openInBrowser(Uri uri) async {
  try {
    return await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (error) {
    debugPrint('navegador: no se pudo abrir $uri: $error');
    return false;
  }
}
