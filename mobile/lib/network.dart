import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

/// Estado de red que usa la app. Solo se consulta cuando hace falta (al sincronizar o descargar), nunca en bucle.
abstract interface class NetworkInfo {
  /// True si hay Wi-Fi o cable. False si hay datos móviles, nada o no se sabe.
  Future<bool> onUnmeteredNetwork();
}

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

class ConnectivityNetworkInfo implements NetworkInfo {
  const ConnectivityNetworkInfo();

  @override
  Future<bool> onUnmeteredNetwork() async {
    try {
      final results = await Connectivity().checkConnectivity();
      return results.contains(ConnectivityResult.wifi) ||
          results.contains(ConnectivityResult.ethernet);
    } catch (error) {
      debugPrint('red: no se pudo comprobar la conexión: $error');
      return false;
    }
  }
}
