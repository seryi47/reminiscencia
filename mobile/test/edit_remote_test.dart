import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/edit_remote.dart';
import 'package:reminiscencia/library_requests.dart';

void main() {
  final request = LibraryRequest.createAlbum(name: 'Boleros', artist: '');

  test('envía el payload a /api/editar y devuelve el mensaje', () async {
    late http.Request seen;
    final client = MockClient((r) async {
      seen = r;
      return http.Response(
        jsonEncode({'ok': true, 'mensaje': 'Hecho', 'incidencia': 42}),
        200,
      );
    });
    final receipt = await submitLibraryEdit(request, client: client);
    expect(receipt.message, 'Hecho');
    expect(receipt.issue, 42);
    expect(seen.url, kEditEndpoint);
    expect(seen.method, 'POST');
    expect(jsonDecode(seen.body), {
      'action': 'organize',
      'payload': request.payload,
    });
  });

  test('sin mensaje usa el texto por defecto', () async {
    final client = MockClient((_) async => http.Response('{"ok":true}', 200));
    final receipt = await submitLibraryEdit(request, client: client);
    expect(receipt.message, kEditSavedText);
    expect(receipt.issue, isNull);
  });

  test('un rechazo lanza el motivo; sin motivo, el código', () async {
    final rejected = MockClient(
      (_) async => http.Response('{"ok":false,"error":"Mal."}', 400),
    );
    await expectLater(
      submitLibraryEdit(request, client: rejected),
      throwsA(isA<AppException>().having((e) => e.message, 'message', 'Mal.')),
    );
    final broken = MockClient((_) async => http.Response('x', 502));
    await expectLater(
      submitLibraryEdit(request, client: broken),
      throwsA(
        isA<AppException>().having(
          (e) => e.message,
          'message',
          contains('502'),
        ),
      ),
    );
  });

  test('un fallo de red da un mensaje en español', () async {
    final client = MockClient((_) async => throw http.ClientException('x'));
    await expectLater(
      submitLibraryEdit(request, client: client),
      throwsA(
        isA<AppException>().having(
          (e) => e.message,
          'message',
          contains('conectar'),
        ),
      ),
    );
  });

  test('la portada va como JPEG con el ID en la cabecera', () async {
    late http.Request seen;
    final client = MockClient((r) async {
      seen = r;
      return http.Response('{"ok":true}', 200);
    });
    final jpeg = Uint8List.fromList([0xff, 0xd8, 0xff, 0xd9]);
    await submitCatalogCover('S0000000000000004', jpeg, client: client);
    expect(seen.headers['Content-Type'], 'image/jpeg');
    expect(seen.headers['X-Portada-Id'], 'S0000000000000004');
    expect(seen.bodyBytes, jpeg);
  });

  test(
    'el estado de una edición se pide con GET y el número de incidencia',
    () async {
      late http.Request seen;
      final client = MockClient((r) async {
        seen = r;
        return http.Response(
          jsonEncode({'ok': true, 'incidencia': 7, 'estado': 'cerrada'}),
          200,
        );
      });
      expect(await fetchEditStatus(7, client: client), 'cerrada');
      expect(seen.method, 'GET');
      expect(seen.url.path, '/api/editar');
      expect(seen.url.queryParameters, {'incidencia': '7'});
    },
  );

  test(
    'un estado desconocido, un código de error o un fallo de red lanzan',
    () async {
      final odd = MockClient(
        (_) async => http.Response('{"ok":true,"estado":"rara"}', 200),
      );
      await expectLater(
        fetchEditStatus(7, client: odd),
        throwsA(isA<AppException>()),
      );
      final missing = MockClient((_) async => http.Response('{}', 404));
      await expectLater(
        fetchEditStatus(7, client: missing),
        throwsA(isA<AppException>()),
      );
      final offline = MockClient((_) async => throw http.ClientException('x'));
      await expectLater(fetchEditStatus(7, client: offline), throwsA(anything));
      await expectLater(fetchEditStatus(0), throwsArgumentError);
    },
  );
}
