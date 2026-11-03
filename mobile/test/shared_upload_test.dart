import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/local_audio.dart';
import 'package:reminiscencia/shared_upload.dart';

/// Conversor falso: escribe [bytes] bytes numerados (para comprobar el orden de los trozos) o falla para ciertos nombres.
class FakeOpusConverter implements AudioConverter {
  FakeOpusConverter({this.bytes = 20, this.failures = const {}});

  final int bytes;
  final Map<String, String> failures;
  final List<String> titles = [];
  final List<String> outputs = [];
  void Function()? onConvert;

  List<int> get content => List<int>.generate(bytes, (i) => i % 251);

  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) async {
    titles.add(title);
    outputs.add(outputPath);
    onConvert?.call();
    final failure = failures[inputPath.split('/').last];
    if (failure != null) {
      await File(outputPath).writeAsBytes([1]);
      throw AppException(failure);
    }
    await File(outputPath).writeAsBytes(content);
    return ConvertedAudio(
      durationS: 10,
      channels: 2,
      bitrate: kBitrateStereo,
      bytes: bytes,
    );
  }

  @override
  Future<void> cancel() async {}
}

/// Respuesta de la función simulada.
http.Response okReply() => http.Response(
  jsonEncode({'ok': true, 'ruta': 'audio-library/buzon/x.opus', 'nombre': 'x'}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

http.Response errorReply(int status, String message) => http.Response(
  jsonEncode({'ok': false, 'error': message}),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

PickedAudioFile picked(String name) =>
    PickedAudioFile(name: name, path: '/origen/$name');

void main() {
  late Directory work;
  late List<http.Request> requests;

  setUp(() async {
    work = await Directory.systemTemp.createTemp('subida_test');
    requests = [];
  });

  tearDown(() async {
    if (await work.exists()) await work.delete(recursive: true);
  });

  SharedUploader uploaderWith(
    Future<http.Response> Function(http.Request request, int n) reply, {
    FakeOpusConverter? converter,
    bool online = true,
    int chunkBytes = kUploadChunkBytes,
  }) {
    return SharedUploader(
      client: MockClient((request) {
        requests.add(request);
        return reply(request, requests.length);
      }),
      converter: converter ?? FakeOpusConverter(),
      hasConnection: () async => online,
      workDir: () async => work,
      retryDelay: Duration.zero,
      chunkBytes: chunkBytes,
      random: Random(7),
    );
  }

  final uuidPattern = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  );

  group('contrato de la función', () {
    test(
      'éxito: un archivo en un trozo, con las cabeceras del contrato',
      () async {
        final converter = FakeOpusConverter(bytes: 20);
        final uploader = uploaderWith(
          (_, _) async => okReply(),
          converter: converter,
        );

        final result = await uploader.upload([picked('Charleston.mp3')]);

        expect(requests, hasLength(1));
        final request = requests.single;
        expect(request.method, 'POST');
        expect(
          request.url,
          Uri.parse('https://reminiscencia.vercel.app/api/subir'),
        );
        expect(request.headers['Content-Type'], startsWith('audio/ogg'));
        expect(request.headers['X-Nombre-Archivo'], 'Charleston.mp3');
        expect(request.headers['X-Subida-Id'], matches(uuidPattern));
        expect(request.headers['X-Parte'], '0');
        expect(request.headers['X-Partes'], '1');
        expect(request.bodyBytes, converter.content);
        // Ningún token ni credencial en la petición.
        expect(
          request.headers.keys.map((k) => k.toLowerCase()),
          isNot(contains('authorization')),
        );

        final item = result.items.single;
        expect(item.outcome, UploadOutcome.uploaded);
        expect(item.title, 'Charleston');
        expect(item.message, kUploadedMessage);
        expect(converter.titles, ['Charleston']);
        expect(await File(converter.outputs.single).exists(), isFalse);
        expect(describeUploadResult(result), kUploadedMessage);
      },
    );

    test(
      'un archivo grande va en trozos de 4 MB como máximo, en orden y con el mismo id',
      () async {
        final converter = FakeOpusConverter(bytes: 25);
        final progress = <String>[];
        final uploader = uploaderWith(
          (_, _) async => okReply(),
          converter: converter,
          chunkBytes: 10,
        );

        final result = await uploader.upload([
          picked('Larga.flac'),
        ], onProgress: (p) => progress.add(p.describe()));

        expect(result.items.single.outcome, UploadOutcome.uploaded);
        expect(requests.map((r) => r.headers['X-Parte']), ['0', '1', '2']);
        expect(requests.map((r) => r.headers['X-Partes']).toSet(), {'3'});
        expect(
          requests.map((r) => r.headers['X-Subida-Id']).toSet(),
          hasLength(1),
        );
        expect(requests.map((r) => r.bodyBytes.length), [10, 10, 5]);
        expect(requests.expand((r) => r.bodyBytes).toList(), converter.content);
        expect(progress, [
          'Convirtiendo 1 de 1: Larga',
          'Subiendo 1 de 1: Larga (parte 1 de 3)',
          'Subiendo 1 de 1: Larga (parte 2 de 3)',
          'Subiendo 1 de 1: Larga (parte 3 de 3)',
        ]);
      },
    );

    test(
      'el trozo por defecto es de 4 MB (Vercel acepta 4,5 MB por petición)',
      () {
        expect(kUploadChunkBytes, 4 * 1024 * 1024);
        expect(kUploadChunkBytes, lessThan(4.5 * 1000 * 1000));
      },
    );

    test(
      'error 4xx: se muestra el mensaje de la web, sin reintentar, y sigue con el siguiente',
      () async {
        final uploader = uploaderWith(
          (request, n) async => n == 1
              ? errorReply(400, 'El archivo no es audio Ogg Opus.')
              : okReply(),
        );

        final result = await uploader.upload([
          picked('Mala.wav'),
          picked('Buena.mp3'),
        ]);

        expect(requests, hasLength(2), reason: 'un 400 no se reintenta');
        expect(result.items[0].outcome, UploadOutcome.failed);
        expect(result.items[0].message, 'El archivo no es audio Ogg Opus.');
        expect(result.items[1].outcome, UploadOutcome.uploaded);
        expect(describeUploadResult(result), 'Subidas 1 de 2 canciones.');
      },
    );

    test('error 5xx: un reintento por trozo como máximo', () async {
      final uploader = uploaderWith(
        (_, _) async =>
            errorReply(502, 'No se pudo guardar en el repositorio.'),
      );

      final result = await uploader.upload([picked('Tema.mp3')]);

      expect(requests, hasLength(2));
      expect(result.items.single.outcome, UploadOutcome.failed);
      expect(
        result.items.single.message,
        'No se pudo guardar en el repositorio.',
      );
    });

    test('error 5xx pasajero: el reintento lo sube', () async {
      final uploader = uploaderWith(
        (_, n) async => n == 1 ? http.Response('fallo', 500) : okReply(),
      );

      final result = await uploader.upload([picked('Tema.mp3')]);

      expect(requests, hasLength(2));
      expect(result.items.single.outcome, UploadOutcome.uploaded);
    });

    test('respuesta que no es JSON: mensaje con el código', () async {
      final uploader = uploaderWith(
        (_, _) async => http.Response('<html>', 413),
      );

      final result = await uploader.upload([picked('Tema.mp3')]);

      expect(requests, hasLength(1));
      expect(result.items.single.message, contains('código 413'));
    });

    test('2xx sin «ok: true» no cuenta como subida', () async {
      final uploader = uploaderWith((_, _) async => http.Response('{}', 200));

      final result = await uploader.upload([picked('Tema.mp3')]);

      expect(result.items.single.outcome, UploadOutcome.failed);
    });
  });

  group('sin red', () {
    test('sin conexión no se intenta nada', () async {
      final converter = FakeOpusConverter();
      final uploader = uploaderWith(
        (_, _) async => okReply(),
        converter: converter,
        online: false,
      );

      await expectLater(
        uploader.upload([picked('Tema.mp3')]),
        throwsA(
          isA<AppException>().having(
            (e) => e.message,
            'message',
            kOfflineMessage,
          ),
        ),
      );
      expect(requests, isEmpty);
      expect(converter.titles, isEmpty);
    });

    test(
      'si se cae la red: un reintento y el resto queda pendiente, sin más peticiones',
      () async {
        final uploader = uploaderWith(
          (_, _) async => throw const SocketException('sin red'),
        );

        final result = await uploader.upload([
          picked('Uno.mp3'),
          picked('Dos.mp3'),
          picked('Tres.mp3'),
        ]);

        expect(requests, hasLength(2), reason: 'un intento y un reintento');
        expect(result.items.map((i) => i.outcome), [
          UploadOutcome.failed,
          UploadOutcome.pending,
          UploadOutcome.pending,
        ]);
        expect(result.items[0].message, 'no hay conexión con la web.');
        expect(result.items[1].message, contains('se perdió la conexión'));
        expect(
          describeUploadResult(result),
          'No se pudo subir ninguno de los 3 archivos.',
        );
      },
    );

    test('ClientException también cuenta como falta de red', () async {
      final uploader = uploaderWith(
        (_, _) async => throw http.ClientException('Connection closed'),
      );

      final result = await uploader.upload([picked('Uno.mp3')]);

      expect(requests, hasLength(2));
      expect(result.items.single.outcome, UploadOutcome.failed);
    });
  });

  group('varios archivos', () {
    test(
      'se suben de uno en uno, cada uno con su id, y el resultado va en orden',
      () async {
        final converter = FakeOpusConverter(
          failures: {'Rota.wav': 'No se puede leer este archivo.'},
        );
        final uploader = uploaderWith(
          (_, _) async => okReply(),
          converter: converter,
        );

        final result = await uploader.upload([
          picked('Uno.mp3'),
          picked('Rota.wav'),
          picked('Tres.ogg'),
        ]);

        expect(
          requests,
          hasLength(2),
          reason: 'la que no se convierte no se envía',
        );
        expect(requests.map((r) => r.headers['X-Nombre-Archivo']), [
          'Uno.mp3',
          'Tres.ogg',
        ]);
        expect(
          requests.map((r) => r.headers['X-Subida-Id']).toSet(),
          hasLength(2),
        );
        expect(result.items.map((i) => i.title), ['Uno', 'Rota', 'Tres']);
        expect(result.items.map((i) => i.outcome), [
          UploadOutcome.uploaded,
          UploadOutcome.failed,
          UploadOutcome.uploaded,
        ]);
        expect(result.items[1].message, 'No se puede leer este archivo.');
        expect(work.listSync(), isEmpty, reason: 'no quedan temporales');
      },
    );

    test('al salir de la app se para y lo que falta queda pendiente', () async {
      final converter = FakeOpusConverter();
      late SharedUploader uploader;
      converter.onConvert = () {
        if (converter.titles.length == 2) uploader.cancel();
      };
      uploader = uploaderWith((_, _) async => okReply(), converter: converter);

      final result = await uploader.upload([
        picked('Uno.mp3'),
        picked('Dos.mp3'),
        picked('Tres.mp3'),
      ]);

      expect(result.items[0].outcome, UploadOutcome.uploaded);
      expect(result.items[2].outcome, UploadOutcome.pending);
      expect(result.items[2].message, contains('al salir de la app'));
      expect(converter.titles, ['Uno', 'Dos']);
    });

    test('todas bien: resumen en plural', () async {
      final uploader = uploaderWith((_, _) async => okReply());
      final result = await uploader.upload([picked('A.mp3'), picked('B.mp3')]);
      expect(
        describeUploadResult(result),
        'Subidas 2 canciones: llegarán a todos en un par de minutos.',
      );
    });
  });

  group('nombres', () {
    test(
      'acentos y eñes: el nombre va codificado como encodeURIComponent y el título sin extensión',
      () async {
        final converter = FakeOpusConverter();
        final uploader = uploaderWith(
          (_, _) async => okReply(),
          converter: converter,
        );

        final result = await uploader.upload([picked('Canción de cuna ñ.mp3')]);

        expect(
          requests.single.headers['X-Nombre-Archivo'],
          'Canci%C3%B3n%20de%20cuna%20%C3%B1.mp3',
        );
        expect(
          Uri.decodeComponent(requests.single.headers['X-Nombre-Archivo']!),
          'Canción de cuna ñ.mp3',
        );
        expect(result.items.single.title, 'Canción de cuna ñ');
        expect(converter.titles, ['Canción de cuna ñ']);
      },
    );

    test(
      'mismos caracteres sin codificar que encodeURIComponent de JavaScript',
      () {
        // encodeURIComponent("L'amour (1931) ¡olé! *~_-.mp3") en un navegador.
        expect(
          encodeUploadName("L'amour (1931) ¡olé! *~_-.mp3"),
          "L'amour%20(1931)%20%C2%A1ol%C3%A9!%20*~_-.mp3",
        );
        expect(encodeUploadName('a&b=c+d/e?.mp3'), 'a%26b%3Dc%2Bd%2Fe%3F.mp3');
        expect(encodeUploadName('🎵.mp3'), '%F0%9F%8E%B5.mp3');
      },
    );

    test('UUID versión 4', () {
      final random = Random(1);
      final a = uuidV4(random);
      final b = uuidV4(random);
      expect(a, matches(uuidPattern));
      expect(a, isNot(b));
    });
  });
}
