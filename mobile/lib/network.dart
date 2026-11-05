import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

/// True si hay alguna red (Wi-Fi, datos móviles, cable o VPN). Se consulta una vez antes de subir canciones.
/// Si no se puede saber, devuelve true y deja que la propia petición diga si hay conexión.
Future<bool> hasAnyConnection() async {
  try {
    final results = await Connectivity().checkConnectivity();
    return results.any((result) => result != ConnectivityResult.none);
  } catch (error) {
    debugPrint('red: no se pudo comprobar la conexión: $error');
    return true;
  }
}
