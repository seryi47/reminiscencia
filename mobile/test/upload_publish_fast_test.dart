import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/api_config.dart';
import 'package:reminiscencia/auth_store.dart';
import 'package:reminiscencia/worker_catalog_client.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Publicación síncrona del buzón contra el Worker (ADR-0052): la APK ya no tiene que esperar a que la
/// canción aparezca en `data/songs.json` via polling; basta con un POST a `/api/buzon/publish` que devuelve
/// la nueva versión del catálogo. Este fichero prueba la primitiva que [UploadTracker] usará cuando se
/// integre el fast-path en la siguiente fase (la integración requiere además migrar `scripts/buzon.py` al
/// Worker, fuera del alcance de este commit).
final ApiRoutes _fakeRoutes = ApiRoutes(base: 'https://worker.test');

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      kAuthPreferenceKey: 'contraseña-worker',
    });
  });

  test('publish síncrono: 200 → nueva versión sin polling', () async {
    final client = MockClient((request) async {
      expect(request.url.path, '/api/buzon/publish');
      final body = jsonDecode(request.body);
      expect(body['if_match'], 7);
      expect((body['songs'] as List).length, 1);
      return http.Response(
        jsonEncode({'ok': true, 'version': 8, 'event': {'kind': 'buzon'}}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final catalog = WorkerCatalogClient(
      auth: SharedPreferencesAuthStore(),
      client: client,
      routes: _fakeRoutes,
    );
    final result = await catalog.buzonPublish(
      songs: [
        {
          'title': 'Nueva',
          'artist': 'Artista',
          'duration_s': 180,
          'audio': 'audio/pending.opus',
          'size_bytes': 1234,
          'sha256': 'abc',
        },
      ],
      ifMatch: 7,
    );
    expect(result.version, 8);
  });

  test('publish 412 → refetch + retry → publicación aceptada', () async {
    var step = 0;
    final client = MockClient((request) async {
      step++;
      if (step == 1) {
        expect(jsonDecode(request.body)['if_match'], 1);
        return http.Response(
          jsonEncode({
            'ok': false,
            'error': 'if_match desactualizado',
            'current_version': 2,
          }),
          412,
          headers: {'content-type': 'application/json'},
        );
      }
      expect(jsonDecode(request.body)['if_match'], 2);
      return http.Response(
        jsonEncode({'ok': true, 'version': 3, 'event': {}}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final catalog = WorkerCatalogClient(
      auth: SharedPreferencesAuthStore(),
      client: client,
      routes: _fakeRoutes,
    );
    final result = await catalog.buzonPublish(
      songs: [{'title': 'Carrera'}],
      ifMatch: 1,
    );
    expect(result.version, 3);
    expect(step, 2);
  });
}
