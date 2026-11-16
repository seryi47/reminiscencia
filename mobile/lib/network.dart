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

/// Emite `true` cuando hay alguna red y `false` cuando no, cada vez que cambia la conectividad.
/// Lo usa el reproductor para reanudar una canción transmitida cuando vuelve la cobertura (ADR-0036/0046),
/// en vez de saltar a la siguiente.
Stream<bool> connectionChanges() => Connectivity().onConnectivityChanged.map(
  (results) => results.any((result) => result != ConnectivityResult.none),
);
