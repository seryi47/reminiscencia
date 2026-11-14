// «Guardar para escuchar sin conexión» más rápido (ADR-0033): varias canciones a la vez con límite, lo guardado no se
// vuelve a bajar, progreso «n de N» y bytes que no retrocede, cancelar sin dejar ficheros a medias y seguir después.
// Red simulada (MockClient); ninguna prueba habla con producción.
import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/api_config.dart';
import 'package:reminiscencia/library_store.dart';
import 'package:reminiscencia/offline_downloads.dart';
import 'package:reminiscencia/song.dart';

Song song(String id) => Song(
  id: id,
  title: 'Tema $id',
  artist: 'Artista',
  year: null,
  tags: const [],
  folderId: null,
  durationS: 60,
  license: 'Dominio público',
  audio: 'audio/$id.opus',
);

void main() {
  group('runLimited', () {
    test(
      'nunca más del límite a la vez y empieza en el orden de la lista',
      () async {
        var active = 0;
        var maxActive = 0;
        final started = <int>[];
        await runLimited(List.generate(10, (i) => i), 4, (i) async {
          started.add(i);
          active += 1;
          maxActive = active > maxActive ? active : maxActive;
          await Future<void>.delayed(Duration(milliseconds: 5 + (i % 3) * 3));
          active -= 1;
        });
        expect(maxActive, 4);
        expect(started, List.generate(10, (i) => i));
      },
    );

    test(
      'al cancelar no empieza ninguna más y un fallo no para a las demás',
      () async {
        final cancel = OfflineCancel();
        final done = <int>[];
        await runLimited(List.generate(8, (i) => i), 2, (i) async {
          await Future<void>.delayed(const Duration(milliseconds: 5));
          if (i == 1) throw StateError('rota');
          done.add(i);
          if (i == 2) cancel.cancel();
        }, cancel: cancel);
        expect(done, containsAll([0, 2]));
        expect(
          done.length,
          lessThan(5),
          reason: 'tras cancelar no se empieza ninguna nueva',
        );
      },
    );
  });

  group('OfflineProgress', () {
    test('textos y fracción', () {
      expect(OfflineProgress.preparing.text, 'Preparando…');
      expect(OfflineProgress.preparing.fraction, isNull);
      const p = OfflineProgress(done: 3, total: 8, bytes: 2621440, failed: 1);
      expect(p.text, 'Guardando 3 de 8 · 2,5 MB');
      expect(p.fraction, 0.5);
      expect(const OfflineProgress(done: 2, total: 8).text, 'Guardando 2 de 8');
    });
  });

  group('LibraryStore.downloadAll en paralelo', () {
    late Directory tmp;
    setUp(() => tmp = Directory.systemTemp.createTempSync('offline_'));
    tearDown(() => tmp.deleteSync(recursive: true));

    LibraryStore store(
      MockClientStreamHandler handler, {
      int concurrency = 4,
    }) => LibraryStore(
      root: () async => Directory('${tmp.path}/biblioteca'),
      // Sin Worker: el audio se pide a r2.dev (simulado aquí, nunca el real).
      routes: ApiRoutes(base: ''),
      client: MockClient.streaming(handler),
      concurrency: concurrency,
    );

    File audio(String id) => File('${tmp.path}/biblioteca/audio/$id.opus');

    test(
      'una descarga más corta que su Content-Length no se da por guardada ni deja «.part»',
      () async {
        var calls = 0;
        final s = store((request, _) async {
          calls += 1;
          // El servidor anuncia 10 bytes y la conexión se cierra a los 3.
          return http.StreamedResponse(
            Stream.value([1, 2, 3]),
            200,
            contentLength: 10,
          );
        });
        await expectLater(
          s.downloadAll([song('S1')], (_, _) {}),
          throwsA(isA<HttpException>()),
        );
        expect(calls, 3, reason: 'se reintenta como cualquier fallo');
        expect(audio('S1').existsSync(), isFalse);
        final leftovers = Directory(
          '${tmp.path}/biblioteca/audio',
        ).listSync().where((file) => file.path.endsWith('.part'));
        expect(leftovers, isEmpty);
      },
    );

    test(
      'sin Content-Length, un cuerpo demasiado corto para la duración NO se guarda (suelo por duración, ADR-0046)',
      () async {
        var calls = 0;
        final s = store((request, _) async {
          calls += 1;
          // Sin Content-Length y con solo 3 bytes para una canción de 60 s: es una descarga cortada.
          return http.StreamedResponse(Stream.value([1, 2, 3]), 200);
        });
        await expectLater(
          s.downloadAll([song('S1')], (_, _) {}),
          throwsA(isA<HttpException>()),
        );
        expect(calls, 3, reason: 'se reintenta como cualquier fallo');
        expect(audio('S1').existsSync(), isFalse, reason: 'no se guarda un fichero cortado que el reproductor saltaría solo');
      },
    );

    test('una descarga completa con Content-Length se guarda entera', () async {
      final s = store(
        (request, _) async => http.StreamedResponse(
          Stream.value([1, 2, 3, 4]),
          200,
          contentLength: 4,
        ),
      );
      expect(await s.downloadAll([song('S2')], (_, _) {}), 1);
      expect(audio('S2').readAsBytesSync(), [1, 2, 3, 4]);
    });

    test(
      'baja hasta 4 a la vez, se salta lo guardado y el progreso con bytes no retrocede',
      () async {
        var active = 0;
        var maxActive = 0;
        final requested = <String>[];
        final s = store((request, _) async {
          requested.add(request.url.pathSegments.last);
          active += 1;
          maxActive = active > maxActive ? active : maxActive;
          await Future<void>.delayed(const Duration(milliseconds: 20));
          active -= 1;
          return http.StreamedResponse(
            Stream.fromIterable([
              [1, 2, 3],
              [4, 5],
            ]),
            200,
            contentLength: 5,
          );
        });
        await audio('S0').create(recursive: true);
        final details = <OfflineProgress>[];
        final calls = <String>[];
        final done = await s.downloadAll(
          [for (var i = 0; i < 9; i++) song('S$i')],
          (d, t) => calls.add('$d/$t'),
          onDetail: details.add,
        );
        expect(done, 8);
        expect(maxActive, 4);
        expect(requested, isNot(contains('S0.opus')));
        expect(requested.toSet().length, 8, reason: 'cada una una sola vez');
        expect(details.first, const OfflineProgress(done: 1, total: 9));
        expect(
          details.last,
          const OfflineProgress(done: 9, total: 9, bytes: 40),
        );
        final dones = details.map((p) => p.done).toList();
        expect(dones, [...dones]..sort());
        expect(calls.last, '8/8');
        for (var i = 0; i < 9; i++) {
          expect(audio('S$i').existsSync(), isTrue);
        }
      },
    );

    test(
      'cancelar corta lo que se baja sin dejar «.part», conserva lo guardado y la siguiente vez solo baja lo que falta',
      () async {
        final cancel = OfflineCancel();
        final gates = <String, Completer<void>>{};
        var requests = 0;
        final s = store((request, _) async {
          requests += 1;
          final id = request.url.pathSegments.last;
          if (id == 'S0.opus') {
            return http.StreamedResponse(Stream.value([1, 2, 3]), 200, contentLength: 3);
          }
          // Las demás mandan un trozo y se quedan esperando: se cortan al cancelar.
          final gate = gates[id] = Completer<void>();
          final controller = StreamController<List<int>>();
          controller.add([9, 9]);
          unawaited(gate.future.then((_) => controller.close()));
          return http.StreamedResponse(controller.stream, 200);
        }, concurrency: 2);
        final details = <OfflineProgress>[];
        final run = s.downloadAll(
          [song('S0'), song('S1'), song('S2'), song('S3')],
          (_, _) {},
          onDetail: details.add,
          cancel: cancel,
        );
        while (gates.length < 2) {
          await Future<void>.delayed(const Duration(milliseconds: 5));
        }
        cancel.cancel();
        final done = await run;
        expect(done, 1);
        expect(audio('S0').existsSync(), isTrue);
        final dir = Directory('${tmp.path}/biblioteca/audio');
        expect(
          dir.listSync().map((f) => f.uri.pathSegments.last),
          ['S0.opus'],
          reason: 'sin ficheros a medias',
        );
        expect(details.last.bytes, 3, reason: 'lo cortado no cuenta');
        expect(requests, 3, reason: 'S3 no se llega a pedir');

        // Otra vez: solo lo que falta, sin volver a bajar S0.
        final again = <String>[];
        final s2 = store((request, _) async {
          again.add(request.url.pathSegments.last);
          return http.StreamedResponse(Stream.value([7]), 200, contentLength: 1);
        });
        expect(
          await s2.downloadAll([
            song('S0'),
            song('S1'),
            song('S2'),
            song('S3'),
          ], (_, _) {}),
          3,
        );
        expect(again..sort(), ['S1.opus', 'S2.opus', 'S3.opus']);
      },
    );
  });
}
