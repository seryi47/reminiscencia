import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'app_version.dart';

/// Chequeo de actualización de la APK (ADR-0047). Como la app no está en Google Play, al abrir mira la última release de
/// GitHub (`android-vX.Y.Z`) y, si es más nueva que la instalada, ofrece descargarla (el usuario decide: actualizar o
/// seguir con la actual). No fuerza nada y nunca bloquea el arranque: ante cualquier fallo de red, no muestra aviso.

/// Interruptor global del chequeo al arrancar. Las pruebas lo apagan (flutter_test_config.dart) para no tocar la red ni
/// dejar temporizadores pendientes; `checkForUpdate` en sí se puede probar directamente con un cliente simulado.
bool updateCheckEnabled = true;

/// Última release publicada del repositorio (pública; no necesita token). 60 peticiones/hora por IP sin autenticar, de
/// sobra para un arranque ocasional.
final Uri kReleasesLatestUrl =
    Uri.parse('https://api.github.com/repos/seryi47/reminiscencia/releases/latest');

/// Arquitectura preferida del APK a descargar: arm64-v8a cubre la gran mayoría de móviles (y el del usuario). Si la
/// release no la trae, se cae a la página de la release para que elija.
const String _preferredAbi = 'arm64-v8a';

class UpdateInfo {
  const UpdateInfo({required this.version, required this.url, this.notes = ''});

  /// Nombre de versión de la release (X.Y.Z, sin el prefijo `android-v`).
  final String version;

  /// A dónde lleva «Actualizar»: el APK arm64 directo si está, o la página de la release.
  final String url;

  /// Texto de la release (novedades), recortado para el diálogo.
  final String notes;
}

/// ¿`remote` (X.Y.Z) es una versión mayor que `current`? Compara campo a campo como números; los que falten cuentan 0.
bool isNewerVersion(String remote, String current) {
  final a = _parts(remote);
  final b = _parts(current);
  final n = a.length > b.length ? a.length : b.length;
  for (var i = 0; i < n; i++) {
    final x = i < a.length ? a[i] : 0;
    final y = i < b.length ? b[i] : 0;
    if (x != y) return x > y;
  }
  return false;
}

List<int> _parts(String version) {
  // Quita un posible prefijo «android-v» o «v» y un sufijo de build «+N», y parte por puntos.
  final core = version.replaceFirst(RegExp(r'^android-v', caseSensitive: false), '')
      .replaceFirst(RegExp(r'^v', caseSensitive: false), '')
      .split('+')
      .first
      .trim();
  return core.split('.').map((p) => int.tryParse(p.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0).toList();
}

/// Mira la última release y devuelve la info de actualización si hay una más nueva que [currentVersion] (por defecto, la
/// de la app). Devuelve null si no hay actualización o si algo falla (sin red, respuesta rara, etc.): nunca lanza.
Future<UpdateInfo?> checkForUpdate({
  http.Client? client,
  String currentVersion = kAppVersionName,
  Uri? endpoint,
}) async {
  final own = client ?? http.Client();
  try {
    final response = await own
        .get(endpoint ?? kReleasesLatestUrl, headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'reminiscencia-app',
        })
        .timeout(const Duration(seconds: 10));
    if (response.statusCode != 200) return null;
    final data = jsonDecode(response.body);
    if (data is! Map<String, dynamic>) return null;
    final tag = data['tag_name'];
    if (tag is! String || tag.isEmpty) return null;
    final version = tag.replaceFirst(RegExp(r'^android-v', caseSensitive: false), '');
    if (!isNewerVersion(version, currentVersion)) return null;

    // Enlace de descarga: el APK de la arquitectura preferida si está entre los adjuntos; si no, la página de la release.
    String url = data['html_url'] is String ? data['html_url'] as String : '';
    final assets = data['assets'];
    if (assets is List) {
      for (final asset in assets) {
        if (asset is! Map) continue;
        final name = asset['name'];
        final link = asset['browser_download_url'];
        if (name is String && link is String && name.contains(_preferredAbi) && name.endsWith('.apk')) {
          url = link;
          break;
        }
      }
    }
    if (url.isEmpty) return null;

    final body = data['body'];
    final notes = body is String ? body.trim() : '';
    return UpdateInfo(version: version, url: url, notes: notes.length > 400 ? '${notes.substring(0, 400)}…' : notes);
  } catch (_) {
    return null;
  } finally {
    if (client == null) own.close();
  }
}
