import 'dart:async';
import 'dart:io';

import 'package:reminiscencia/api_config.dart';

/// Lo ejecuta flutter test antes de cada fichero de pruebas. Las pruebas nunca hablan con el Worker real (ADR-0029):
/// usan rutas sin Worker, aunque kWorkerApiBase tenga la dirección de producción. Las que prueban el Worker pasan sus
/// propias ApiRoutes.
///
/// Además (ADR-0034), un cliente HTTP real que intentara llegar a producción (la web y el API en cometia.es, Vercel,
/// workers.dev, r2.dev o GitHub) va a un proxy que no existe y falla sin salir del equipo.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  apiRoutes = ApiRoutes(base: '');
  HttpOverrides.global = _NoProductionHttp();
  await testMain();
}

const List<String> _productionHosts = [
  'cometia.es',
  'vercel.app',
  'workers.dev',
  'r2.dev',
  'github.com',
];

bool _isProductionHost(String host) => _productionHosts.any(
  (suffix) => host == suffix || host.endsWith('.$suffix'),
);

class _NoProductionHttp extends HttpOverrides {
  @override
  String findProxyFromEnvironment(Uri url, Map<String, String>? environment) =>
      _isProductionHost(url.host)
      ? 'PROXY 127.0.0.1:9'
      : super.findProxyFromEnvironment(url, environment);
}
