import 'dart:async';

import 'package:reminiscencia/api_config.dart';

/// Lo ejecuta flutter test antes de cada fichero de pruebas. Las pruebas nunca hablan con el Worker real (ADR-0029):
/// usan rutas sin Worker, aunque kWorkerApiBase tenga la dirección de producción. Las que prueban el Worker pasan sus
/// propias ApiRoutes.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  apiRoutes = ApiRoutes(base: '');
  await testMain();
}
