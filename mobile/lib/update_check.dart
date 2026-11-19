import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

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

/// Variantes de APK aceptables para la auto-actualización, ORDEN DE PREFERENCIA (ADR-0047).
///
/// SIEMPRE PRIMERO el `universal`: si el usuario instaló el universal (lleva los 3 ABIs), Android rechaza como «no
/// compatible» cualquier split de un solo ABI porque sería «perder librerías nativas» al actualizar. El universal
/// nunca pierde nada, así que funciona pase lo que pase. Las variantes de un solo ABI quedan como fallback por si en
/// el futuro algún cambio dejara de publicar el universal.
const List<String> _apkPreferences = ['universal', 'arm64-v8a', 'armeabi-v7a', 'x86_64'];

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

    // Enlace de descarga: recorremos las preferencias (universal primero, ADR-0047) y nos quedamos con el PRIMER APK que
    // cuadre. Si no hay ninguno, no hay actualización «instalable» desde la app: devolvemos null (no caemos al navegador).
    String url = '';
    final assets = data['assets'];
    if (assets is List) {
      for (final preference in _apkPreferences) {
        for (final asset in assets) {
          if (asset is! Map) continue;
          final name = asset['name'];
          final link = asset['browser_download_url'];
          if (name is String && link is String && name.contains(preference) && name.endsWith('.apk')) {
            url = link;
            break;
          }
        }
        if (url.isNotEmpty) break;
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

/// Descarga el APK de [info] a la caché interna de la app para instalarlo con el instalador del sistema (ADR-0047).
/// `onProgress(recibidos, total)` informa del avance (`total` puede ser -1 si el servidor no manda `Content-Length`).
/// Devuelve la ruta del fichero descargado, o null si falla. Nunca lanza.
///
/// La ruta queda bajo `getApplicationCacheDirectory()/updates/`, que es lo que publica el FileProvider del AndroidManifest:
/// es el único sitio desde el que podemos entregar el fichero al instalador vía `content://`.
Future<String?> downloadApk(
  UpdateInfo info, {
  http.Client? client,
  void Function(int received, int total)? onProgress,
}) async {
  if (!info.url.endsWith('.apk')) return null; // la URL llevaba a la página de la release, no al APK directo
  final own = client ?? http.Client();
  File? partial;
  try {
    final cacheDir = await getApplicationCacheDirectory();
    final updatesDir = Directory('${cacheDir.path}/updates');
    if (!await updatesDir.exists()) await updatesDir.create(recursive: true);
    // Limpia APKs viejos de otras versiones para no llenar la caché (si no queda espacio, Android limpia por su cuenta).
    for (final entry in updatesDir.listSync(followLinks: false)) {
      if (entry is File && entry.path.endsWith('.apk')) {
        try { await entry.delete(); } catch (_) {}
      }
    }
    final target = File('${updatesDir.path}/reminiscencia-${info.version}.apk');
    partial = File('${target.path}.part');
    final request = http.Request('GET', Uri.parse(info.url))..followRedirects = true;
    final response = await own.send(request).timeout(const Duration(seconds: 30));
    if (response.statusCode != 200) return null;
    final total = response.contentLength ?? -1;
    var received = 0;
    final sink = partial.openWrite();
    try {
      await for (final chunk in response.stream) {
        sink.add(chunk);
        received += chunk.length;
        onProgress?.call(received, total);
      }
    } finally {
      await sink.close();
    }
    // 1.4.15: NO renombrar como APK válida si la descarga está truncada. Antes, cualquier corte en la red
    // dejaba un `reminiscencia-X.Y.Z.apk` incompleto en caché y Android lo abría con «No se ha podido analizar el
    // paquete». Ahora exigimos que `received` coincida con el `Content-Length` del servidor (si lo da) y, en su
    // defecto, que el fichero tenga al menos la cabecera ZIP del APK (PK\x03\x04) y 1 MiB mínimo.
    if (total > 0 && received != total) {
      try { await partial.delete(); } catch (_) {}
      return null;
    }
    if (received < 1024 * 1024) {
      try { await partial.delete(); } catch (_) {}
      return null;
    }
    try {
      final raf = await partial.open();
      try {
        final header = await raf.read(4);
        if (header.length < 4 || header[0] != 0x50 || header[1] != 0x4B || header[2] != 0x03 || header[3] != 0x04) {
          try { await partial.delete(); } catch (_) {}
          return null;
        }
      } finally {
        await raf.close();
      }
    } catch (_) {
      try { await partial.delete(); } catch (_) {}
      return null;
    }
    await partial.rename(target.path);
    return target.path;
  } catch (_) {
    try { if (partial != null && await partial.exists()) await partial.delete(); } catch (_) {}
    return null;
  } finally {
    if (client == null) own.close();
  }
}
