import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/local_audio.dart';
import 'package:reminiscencia/shared_upload.dart';
import 'package:reminiscencia/upload_tracker.dart';

import 'support/fakes.dart';
import 'support/zips.dart';

/// Conversor falso que guarda qué archivo recibió y su contenido (para ver que es la canción del ZIP).
class RecordingConverter implements AudioConverter {
  final List<({String input, String title, List<int> bytes})> calls = [];

  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) async {
    calls.add((
      input: inputPath,
      title: title,
      bytes: await File(inputPath).readAsBytes(),
    ));
    await File(outputPath).writeAsBytes(List<int>.filled(16, 7));
    return const ConvertedAudio(
      durationS: 9,
      channels: 2,
      bitrate: kBitrateStereo,
      bytes: 16,
    );
  }

  @override
  Future<void> cancel() async {}
}

void main() {
  late Directory work;
  late Directory origin;
  late List<http.Request> requests;
  late RecordingConverter converter;
  late List<UploadTracker> trackers;

  setUp(() async {
    work = await Directory.systemTemp.createTemp('subida_zip');
    origin = Directory('${work.path}/origen')..createSync();
    requests = [];
    converter = RecordingConverter();
    trackers = [];
  });

  tearDown(() async {
    // Deja terminar las escrituras del índice que siguen en marcha: si no, el borrado choca con ellas.
    for (final t in trackers) {
      await t.idle();
    }
    if (await work.exists()) await work.delete(recursive: true);
  });

  Directory tmp() => Directory('${work.path}/tmp');

  UploadTracker tracker() {
    final t = UploadTracker(
      uploader: SharedUploader(
        client: MockClient((request) async {
          requests.add(request);
          return http.Response(
            jsonEncode({'ok': true, 'ruta': 'r', 'nombre': 'n'}),
            200,
          );
        }),
        converter: converter,
        hasConnection: () async => true,
        workDir: () async => tmp(),
        retryDelay: Duration.zero,
        random: Random(3),
      ),
      published: FakePublishedSongs(),
      store: UploadsStore(root: () async => Directory('${work.path}/subidas')),
      timer: FakePollTimer().call,
      random: Random(5),
    );
    trackers.add(t);
    return t;
  }

  test(
    'varios ZIP mezclados con sueltas: cada canción se sube con su nombre base y los temporales se borran',
    () async {
      final album = {
        'Álbum/01 Canción de cuna.mp3': fakeAudioBytes('1'),
        'Álbum/CD2/02 Pasodoble.wav': fakeAudioBytes('2'),
        '__MACOSX/Álbum/._01 Canción de cuna.mp3': fakeAudioBytes('x'),
        'Álbum/.DS_Store': fakeAudioBytes('y'),
        'Álbum/portada.jpg': fakeAudioBytes('z'),
      };
      final albumZip = await writeZip(
        origin,
        'Álbum.zip',
        buildZip(album, directories: ['Álbum/', 'Álbum/CD2/']),
      );
      final second = {'Jota.opus': fakeAudioBytes('3')};
      final secondZip = await writeZip(origin, 'Otro.zip', buildZip(second));
      final broken = await writeZip(
        origin,
        'Roto.zip',
        List<int>.filled(100, 1),
      );
      final loose = File('${origin.path}/Suelta.mp3')
        ..writeAsBytesSync(fakeAudioBytes('s'));

      final t = tracker();
      await t.start([
        PickedAudioFile(name: 'Álbum.zip', path: albumZip.path),
        PickedAudioFile(name: 'Suelta.mp3', path: loose.path),
        PickedAudioFile(name: 'Roto.zip', path: broken.path),
        PickedAudioFile(name: 'Otro.zip', path: secondZip.path),
      ]);

      // Se sube cada canción, en orden, con su nombre base (nunca el ZIP).
      expect(
        requests.map((r) => Uri.decodeComponent(r.headers[kUploadNameHeader]!)),
        [
          '01 Canción de cuna.mp3',
          '02 Pasodoble.wav',
          'Suelta.mp3',
          'Jota.opus',
        ],
      );
      expect(converter.calls.map((c) => c.title), [
        '01 Canción de cuna',
        '02 Pasodoble',
        'Suelta',
        'Jota',
      ]);
      // El conversor recibe la canción exacta, sacada a la carpeta temporal propia con un nombre de la app.
      expect(converter.calls[0].bytes, album['Álbum/01 Canción de cuna.mp3']);
      expect(converter.calls[1].bytes, album['Álbum/CD2/02 Pasodoble.wav']);
      expect(converter.calls[3].bytes, second['Jota.opus']);
      for (final call in [
        converter.calls[0],
        converter.calls[1],
        converter.calls[3],
      ]) {
        expect(call.input, startsWith('${tmp().path}/zip/'));
        expect(call.input, isNot(contains('Canción')));
      }
      expect(converter.calls[2].input, loose.path);
      // Los temporales del ZIP ya no están; los ZIP elegidos siguen donde estaban.
      expect(await Directory('${tmp().path}/zip').exists(), isFalse);
      expect(await albumZip.exists(), isTrue);

      // Grupos: uno por ZIP, con sus filas, en el orden elegido.
      final sections = t.sections;
      expect(sections, hasLength(4));
      expect(sections[0].group!.headline, 'Álbum.zip: 2 canciones');
      expect(
        sections[0].group!.ignoredText,
        'Se ignoraron 3 archivos que no son canciones.',
      );
      expect(sections[0].entries.map((e) => e.name), [
        '01 Canción de cuna.mp3',
        '02 Pasodoble.wav',
      ]);
      expect(sections[1].group, isNull);
      expect(sections[1].entries.single.name, 'Suelta.mp3');
      expect(sections[2].group!.headline, 'Roto.zip');
      expect(
        sections[2].group!.error,
        '«Roto.zip» está dañado o no es un ZIP válido.',
      );
      expect(sections[2].entries, isEmpty);
      expect(sections[3].group!.headline, 'Otro.zip: 1 canción');
      expect(sections[3].group!.ignoredText, isNull);
      expect(t.entries.map((e) => e.stage), everyElement(UploadStage.saved));
      expect(t.summary, '0 de 4 publicadas');
      t.dispose();
    },
  );

  test('solo un ZIP dañado: el grupo con el error y nada enviado', () async {
    final broken = await writeZip(origin, 'Roto.zip', List<int>.filled(80, 3));
    final t = tracker();
    final result = await t.start([
      PickedAudioFile(name: 'Roto.zip', path: broken.path),
    ]);
    expect(result.items, isEmpty);
    expect(requests, isEmpty);
    expect(t.entries, isEmpty);
    expect(t.sections.single.group!.error, contains('dañado'));
    expect(t.summary, 'Ninguna canción para subir');
    expect(t.busy, isFalse);
    t.dispose();
  });

  test(
    'una canción dañada dentro del ZIP falla con su motivo y las demás siguen',
    () async {
      final random = Random(7);
      final bad = List<int>.generate(40000, (_) => random.nextInt(256));
      final raw = buildZip({'Mala.mp3': bad});
      final good = buildZip({'Buena.mp3': fakeAudioBytes('b')});
      // Estropea los datos de «Mala.mp3» sin tocar el índice.
      for (var i = 200; i < 300; i += 1) {
        raw[i] ^= 0x33;
      }
      final badZip = await writeZip(origin, 'Mala.zip', raw);
      final goodZip = await writeZip(origin, 'Buena.zip', good);
      final t = tracker();
      await t.start([
        PickedAudioFile(name: 'Mala.zip', path: badZip.path),
        PickedAudioFile(name: 'Buena.zip', path: goodZip.path),
      ]);
      final mala = t.entries.firstWhere((e) => e.name == 'Mala.mp3');
      expect(mala.stage, UploadStage.failed);
      expect(mala.error, 'no se pudo sacar del ZIP «Mala.zip»: está dañado.');
      expect(
        t.entries.firstWhere((e) => e.name == 'Buena.mp3').stage,
        UploadStage.saved,
      );
      expect(requests, hasLength(1));
      expect(await Directory('${tmp().path}/zip').exists(), isFalse);
      t.dispose();
    },
  );

  test('los grupos se recuerdan al volver a abrir la app', () async {
    final zip = await writeZip(
      origin,
      'Álbum.zip',
      buildZip({
        'a/Uno.mp3': fakeAudioBytes('1'),
        'b/Dos.mp3': fakeAudioBytes('2'),
      }),
    );
    final first = tracker();
    await first.start([PickedAudioFile(name: 'Álbum.zip', path: zip.path)]);
    // El índice se termina de escribir en segundo plano: se espera a que acabe, no un tiempo fijo.
    await first.idle();
    first.dispose();

    final again = tracker();
    await again.restore();
    final section = again.sections.single;
    expect(section.group!.headline, 'Álbum.zip: 2 canciones');
    expect(section.entries.map((e) => e.title), ['Uno', 'Dos']);
    again.dispose();
  });
}
