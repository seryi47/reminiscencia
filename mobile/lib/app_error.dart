/// Error con un mensaje en español pensado para el usuario. La interfaz lo muestra tal cual.
class AppException implements Exception {
  const AppException(this.message);

  final String message;

  @override
  String toString() => message;
}
