import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

/// Estado de red que usa la app. Solo se consulta cuando hace falta (al sincronizar o descargar), nunca en bucle.
abstract interface class NetworkInfo {
  /// True si hay Wi-Fi o cable. False si hay datos móviles, nada o no se sabe.
  Future<bool> onUnmeteredNetwork();
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
