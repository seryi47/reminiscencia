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

/// Conversor falso: escribe un Opus de 16 bytes y apunta el título.
class _Converter implements AudioConverter {
  final List<String> titles = [];

  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) async {
    titles.add(title);
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

// La revisión de la tanda antes de la cola (aviso de duplicados, ADR-0026): lo que se quita no se sube ni deja fila.
void main() {
  late Directory work;
  late _Converter converter;
  late List<http.Request> requests;

  setUp(() async {
    work = await Directory.systemTemp.createTemp('revision_subida');
    converter = _Converter();
    requests = [];
  });

  tearDown(() async {
    await Future<void>.delayed(const Duration(milliseconds: 60));
    if (await work.exists()) await work.delete(recursive: true);
  });

  UploadTracker tracker() => UploadTracker(
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
      workDir: () async => Directory('${work.path}/tmp'),
      retryDelay: Duration.zero,
      random: Random(3),
    ),
    published: FakePublishedSongs(),
    store: UploadsStore(root: () async => Directory('${work.path}/subidas')),
    timer: FakePollTimer().call,
    random: Random(5),
  );

  File audio(String name) =>
      File('${work.path}/$name')..writeAsBytesSync(fakeAudioBytes(name));

  test(
    'la revisión ve las canciones ya sacadas del ZIP y quita las elegidas',
    () async {
      final zip = await writeZip(
        work,
        'Disco.zip',
        buildZip({
          'Disco/Uno.mp3': fakeAudioBytes('1'),
          'Disco/Dos.mp3': fakeAudioBytes('2'),
        }),
      );
      final suelta = audio('Suelta.mp3');
      final repetida = audio('Repetida.mp3');
      List<String>? reviewed;
      final t = tracker();
      await t.start(
        [
          PickedAudioFile(name: 'Suelta.mp3', path: suelta.path),
          PickedAudioFile(name: 'Disco.zip', path: zip.path),
          PickedAudioFile(name: 'Repetida.mp3', path: repetida.path),
        ],
        review: (songs) async {
          reviewed = [for (final song in songs) song.name];
          return {1, 3};
        },
      );
      expect(reviewed, ['Suelta.mp3', 'Uno.mp3', 'Dos.mp3', 'Repetida.mp3']);
      expect(converter.titles, ['Suelta', 'Dos']);
      expect(t.entries.map((entry) => entry.name), ['Suelta.mp3', 'Dos.mp3']);
      final sections = t.sections;
      expect(sections, hasLength(2));
      expect(sections[0].entries.single.name, 'Suelta.mp3');
      expect(sections[1].group!.name, 'Disco.zip');
      expect(sections[1].entries.single.name, 'Dos.mp3');
      t.dispose();
    },
  );

  test(
    'si se quitan todas las de un ZIP, su grupo no queda vacío en la lista',
    () async {
      final zip = await writeZip(
        work,
        'Disco.zip',
        buildZip({'Disco/Uno.mp3': fakeAudioBytes('1')}),
      );
      final suelta = audio('Suelta.mp3');
      final t = tracker();
      await t.start([
        PickedAudioFile(name: 'Disco.zip', path: zip.path),
        PickedAudioFile(name: 'Suelta.mp3', path: suelta.path),
      ], review: (songs) async => {0});
      expect(converter.titles, ['Suelta']);
      expect(t.sections, hasLength(1));
      expect(t.sections.single.group, isNull);
      t.dispose();
    },
  );

  test('si se quitan todas, no se sube nada', () async {
    final suelta = audio('Suelta.mp3');
    final t = tracker();
    final result = await t.start([
      PickedAudioFile(name: 'Suelta.mp3', path: suelta.path),
    ], review: (songs) async => {0});
    expect(result.items, isEmpty);
    expect(t.entries, isEmpty);
    expect(requests, isEmpty);
    t.dispose();
  });
}
