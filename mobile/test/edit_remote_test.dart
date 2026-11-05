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
      return http.Response(jsonEncode({'ok': true, 'mensaje': 'Hecho'}), 200);
    });
    expect(await submitLibraryEdit(request, client: client), 'Hecho');
    expect(seen.url, kEditEndpoint);
    expect(seen.method, 'POST');
    expect(jsonDecode(seen.body), {
      'action': 'organize',
      'payload': request.payload,
    });
  });

  test('sin mensaje usa el texto por defecto', () async {
    final client = MockClient((_) async => http.Response('{"ok":true}', 200));
    expect(await submitLibraryEdit(request, client: client), kEditSavedText);
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
}
