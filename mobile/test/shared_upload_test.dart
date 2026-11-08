import 'dart:async';
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

  /// Conversiones que esperan a que la prueba las deje terminar (por título).
  final Map<String, Future<void>> gates = {};

  /// Conversiones terminadas, en orden.
  final List<String> finished = [];

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
    final gate = gates[title];
    if (gate != null) await gate;
    final failure = failures[inputPath.split('/').last];
    if (failure != null) {
      await File(outputPath).writeAsBytes([1]);
      throw AppException(failure);
    }
    await File(outputPath).writeAsBytes(content);
    finished.add(title);
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
  // Los identificadores de subida son UUID versión 7, en el orden de la cola (ADR-0030).
  final uuid7Pattern = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
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
          Uri.parse('https://reminiscencia.cometia.es/api/subir'),
        );
        expect(request.headers['Content-Type'], startsWith('audio/ogg'));
        expect(request.headers['X-Nombre-Archivo'], 'Charleston.mp3');
        expect(request.headers['X-Subida-Id'], matches(uuid7Pattern));
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

    test('envía metadata de álbum de playlist en la subida pública', () async {
      final uploader = uploaderWith((_, _) async => okReply());
      await uploader.upload([
        const PickedAudioFile(
          name: 'Cada vez.wav',
          path: '/temporal/Cada vez.wav',
          youtubePlaylistId: 'PLVU-jIOit29A',
          youtubePlaylistName: 'Nuestro desacato',
          artist: 'Desakato',
        ),
      ]);

      expect(requests, hasLength(1));
      expect(requests.single.headers['X-Album-Id'], 'PLVU-jIOit29A');
      expect(requests.single.headers['X-Album-Name'], 'Nuestro%20desacato');
      expect(requests.single.headers['X-Artista-Cancion'], 'Desakato');
    });

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
          (request, n) async =>
              request.headers['X-Nombre-Archivo'] == 'Mala.wav'
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
        // «Dos» se convierte mientras se envía «Uno», pero no termina hasta saberse que «Uno» perdió la red: así lo
        // que aún no se ha empezado a enviar queda pendiente (lo que ya se envía termina solo; ADR-0030).
        final converter = FakeOpusConverter();
        final unoDone = Completer<void>();
        converter.gates['Dos'] = unoDone.future;
        final uploader = uploaderWith(
          (_, _) async => throw const SocketException('sin red'),
          converter: converter,
        );

        final result = await uploader.upload(
          [picked('Uno.mp3'), picked('Dos.mp3'), picked('Tres.mp3')],
          onItemDone: (index, _) {
            if (index == 0) unoDone.complete();
          },
        );

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
      'cada uno con su id, la que no se convierte no se envía y el resultado va en el orden de la lista',
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
        expect(
          requests.map((r) => r.headers['X-Nombre-Archivo']),
          unorderedEquals(['Uno.mp3', 'Tres.ogg']),
        );
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

  group('canalización (ADR-0030)', () {
    /// Cliente cuyas respuestas da la prueba: cada petición espera a que se complete su respuesta.
    ({
      MockClient client,
      List<({http.Request request, Completer<http.Response> reply})> pending,
      List<int> inFlight,
    })
    heldClient() {
      final pending =
          <({http.Request request, Completer<http.Response> reply})>[];
      final inFlight = <int>[0, 0]; // [ahora, máximo]
      final client = MockClient((request) async {
        requests.add(request);
        final reply = Completer<http.Response>();
        pending.add((request: request, reply: reply));
        inFlight[0] += 1;
        inFlight[1] = max(inFlight[1], inFlight[0]);
        try {
          return await reply.future;
        } finally {
          inFlight[0] -= 1;
        }
      });
      return (client: client, pending: pending, inFlight: inFlight);
    }

    /// Deja correr el bucle de eventos hasta que se cumpla [ready] (sin tiempos fijos: vueltas a la cola de eventos,
    /// con un tope para no colgar la prueba si no llega nunca).
    Future<void> until(bool Function() ready) async {
      for (var turn = 0; turn < 10000 && !ready(); turn += 1) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(ready(), isTrue, reason: 'la condición no llegó a cumplirse');
    }

    String name(http.Request request) =>
        Uri.decodeComponent(request.headers['X-Nombre-Archivo']!);

    test(
      'se convierte el siguiente mientras se envía el anterior, hasta dos envíos a la vez y uno convertido esperando',
      () async {
        final held = heldClient();
        final converter = FakeOpusConverter(bytes: 25);
        final uploader = SharedUploader(
          client: held.client,
          converter: converter,
          hasConnection: () async => true,
          workDir: () async => work,
          retryDelay: Duration.zero,
          chunkBytes: 10,
          random: Random(7),
        );
        final done = <int>[];
        final upload = uploader.upload([
          picked('Uno.mp3'),
          picked('Dos.mp3'),
          picked('Tres.mp3'),
          picked('Cuatro.mp3'),
        ], onItemDone: (index, _) => done.add(index));

        // El primer trozo de «Uno» espera respuesta; «Dos» ya se ha convertido y también se envía.
        await until(() => held.pending.length == 2);
        expect(held.pending.map((p) => name(p.request)), [
          'Uno.mp3',
          'Dos.mp3',
        ]);
        // «Tres» está convertido y espera hueco; «Cuatro» no se convierte todavía.
        await until(() => converter.finished.length == 3);
        for (var turn = 0; turn < 50; turn += 1) {
          await Future<void>.delayed(Duration.zero);
        }
        expect(converter.titles, ['Uno', 'Dos', 'Tres']);
        expect(
          held.pending,
          hasLength(2),
          reason: 'no hay una tercera petición',
        );

        // «Dos» termina antes que «Uno»: entra «Tres» y empieza a convertirse «Cuatro».
        var answered = 0;
        Future<void> answer(String file) async {
          final entry = held.pending.firstWhere(
            (p) => name(p.request) == file && !p.reply.isCompleted,
          );
          entry.reply.complete(okReply());
          answered += 1;
        }

        await answer('Dos.mp3');
        for (var part = 1; part < 3; part += 1) {
          await until(
            () => held.pending
                .where(
                  (p) => !p.reply.isCompleted && name(p.request) == 'Dos.mp3',
                )
                .isNotEmpty,
          );
          await answer('Dos.mp3');
        }
        await until(() => done.contains(1));
        await until(
          () => held.pending.any((p) => name(p.request) == 'Tres.mp3'),
        );
        await until(() => converter.titles.length == 4);
        // Se responde todo lo que quede, en el orden en que llega.
        while (answered < 12) {
          await until(() => held.pending.any((p) => !p.reply.isCompleted));
          held.pending
              .firstWhere((p) => !p.reply.isCompleted)
              .reply
              .complete(okReply());
          answered += 1;
        }
        final result = await upload;

        expect(result.items.map((i) => i.title), [
          'Uno',
          'Dos',
          'Tres',
          'Cuatro',
        ]);
        expect(result.items.map((i) => i.outcome).toSet(), {
          UploadOutcome.uploaded,
        });
        expect(done.first, 1, reason: '«Dos» terminó antes que «Uno»');
        expect(
          held.inFlight[1],
          2,
          reason: 'nunca más de dos peticiones a la vez',
        );
        // Por subida: un id v7, trozos 0, 1 y 2 en orden; los id, en el orden de la cola aunque acabaran en otro.
        final ids = <String, List<String>>{};
        for (final request in requests) {
          (ids[name(request)] ??= []).add(request.headers['X-Subida-Id']!);
        }
        final order = ['Uno.mp3', 'Dos.mp3', 'Tres.mp3', 'Cuatro.mp3'];
        final first = [for (final file in order) ids[file]!.first];
        for (final file in order) {
          expect(ids[file]!.toSet(), hasLength(1));
          expect(ids[file]!.first, matches(uuid7Pattern));
          expect(
            requests
                .where((r) => name(r) == file)
                .map((r) => r.headers['X-Parte']),
            ['0', '1', '2'],
          );
        }
        expect([...first]..sort(), first);
        expect(work.listSync(), isEmpty, reason: 'no quedan temporales');
      },
    );

    test(
      'con un solo envío a la vez se comporta como antes, en serie',
      () async {
        final held = heldClient();
        final uploader = SharedUploader(
          client: held.client,
          converter: FakeOpusConverter(),
          hasConnection: () async => true,
          workDir: () async => work,
          retryDelay: Duration.zero,
          maxParallelSends: 1,
          random: Random(7),
        );
        final upload = uploader.upload([picked('A.mp3'), picked('B.mp3')]);
        await until(() => held.pending.length == 1);
        for (var turn = 0; turn < 50; turn += 1) {
          await Future<void>.delayed(Duration.zero);
        }
        expect(held.pending, hasLength(1));
        held.pending.single.reply.complete(okReply());
        await until(() => held.pending.length == 2);
        held.pending.last.reply.complete(okReply());
        final result = await upload;
        expect(requests.map(name), ['A.mp3', 'B.mp3']);
        expect(held.inFlight[1], 1);
        expect(result.uploaded, 2);
      },
    );
  });

  group('identificadores de subida en orden (UUID v7)', () {
    test(
      'llevan el milisegundo delante y crecen aunque coincida el milisegundo o el reloj vaya hacia atrás',
      () {
        // Los mismos casos que la web (tests/web-unit/subida-estado.test.mjs).
        var now = 0x019a5b2c3d4e;
        final ids = OrderedUploadIds(
          now: () => DateTime.fromMillisecondsSinceEpoch(now),
          random: _MaxRandom(),
        );
        final first = ids.next();
        expect(first, '019a5b2c-3d4e-7000-bfff-ffffffffffff');
        final second = ids.next();
        expect(second, '019a5b2c-3d4e-7001-bfff-ffffffffffff');
        now -= 5000;
        final third = ids.next();
        expect(third, '019a5b2c-3d4e-7002-bfff-ffffffffffff');
        now += 10000;
        final fourth = ids.next();
        expect(
          fourth.substring(0, 18),
          '${(0x019a5b2c3d4e + 5000).toRadixString(16).padLeft(12, '0').replaceFirstMapped(RegExp(r'^(.{8})'), (m) => '${m[1]}-')}-7000',
        );
        final all = [first, second, third, fourth];
        expect([...all]..sort(), all);
      },
    );

    test(
      'con más de 4096 en el mismo milisegundo pasan al siguiente sin repetirse',
      () {
        final ids = OrderedUploadIds(
          now: () => DateTime.fromMillisecondsSinceEpoch(1000),
          random: Random(3),
        );
        final list = List<String>.generate(4100, (_) => ids.next());
        expect(list.toSet(), hasLength(list.length));
        expect([...list]..sort(), list);
        expect(list[4096].substring(0, 13), '00000000-03e9');
        for (final id in list.take(5)) {
          expect(id, matches(uuid7Pattern));
        }
      },
    );
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

/// Azar que siempre da el máximo: para comparar los identificadores con los de la web.
class _MaxRandom implements Random {
  @override
  int nextInt(int max) => max - 1;

  @override
  bool nextBool() => true;

  @override
  double nextDouble() => 0.999;
}
