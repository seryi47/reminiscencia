import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/local_audio.dart';
import 'package:reminiscencia/song.dart';

/// Conversor falso: escribe un fichero de [bytes] bytes, o falla con el mensaje indicado para ciertos nombres.
class FakeConverter implements AudioConverter {
  FakeConverter({
    this.failures = const {},
    this.bytes = 1234,
    this.channels = 2,
  });

  /// Nombre del archivo de entrada → motivo del fallo. Antes de fallar deja un fichero parcial.
  final Map<String, String> failures;
  final int bytes;
  final int channels;
  final List<String> titles = [];

  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) async {
    titles.add(title);
    final name = inputPath.split('/').last;
    final failure = failures[name];
    if (failure != null) {
      await File(outputPath).writeAsBytes([1, 2, 3]);
      throw AppException(failure);
    }
    await File(outputPath).writeAsBytes(List<int>.filled(bytes, 7));
    return ConvertedAudio(
      durationS: 185.5,
      channels: channels,
      bitrate: localFormatFor(channels).bitrate,
      bytes: bytes,
    );
  }

  @override
  Future<void> cancel() async {}
}

void main() {
  group('título desde el nombre del archivo', () {
    test('quita solo la última extensión', () {
      expect(titleFromFileName('Charleston.mp3'), 'Charleston');
      expect(titleFromFileName('Mi canción.v2.flac'), 'Mi canción.v2');
      expect(titleFromFileName('Tema 1.WAV'), 'Tema 1');
    });

    test('sin extensión deja el nombre tal cual', () {
      expect(titleFromFileName('sin_extension'), 'sin_extension');
    });

    test('quita las carpetas de Windows y de Unix', () {
      expect(titleFromFileName(r'C:\Música\Tema 1.wav'), 'Tema 1');
      expect(titleFromFileName('/storage/emulated/0/Tema 2.m4a'), 'Tema 2');
    });

    test('sin nombre útil es «Sin título»', () {
      expect(titleFromFileName(null), 'Sin título');
      expect(titleFromFileName('   '), 'Sin título');
      expect(titleFromFileName('.mp3'), 'Sin título');
    });

    test('se corta a 200 caracteres contando emojis como uno', () {
      final long = '🎵' * 250;
      final title = titleFromFileName('$long.mp3');
      expect(title.runes.length, 200);
      expect(title, '🎵' * 200);
    });
  });

  group('tasa y tamaño', () {
    test(
      'mono a 32 kbps y estéreo a 48 kbps; más de dos canales se mezclan a estéreo',
      () {
        final mono = localFormatFor(1);
        expect(mono.channels, 1);
        expect(mono.bitrate, 32000);

        final stereo = localFormatFor(2);
        expect(stereo.channels, 2);
        expect(stereo.bitrate, 48000);

        final surround = localFormatFor(6);
        expect(surround.channels, 2);
        expect(surround.bitrate, 48000);

        expect(localFormatFor(0).channels, 1);
      },
    );

    test('los límites de tamaño y duración se comprueban con el motivo', () {
      expect(checkFileLimits(bytes: 0), 'El archivo está vacío.');
      expect(checkFileLimits(bytes: kMaxFileBytes), isNull);
      expect(
        checkFileLimits(bytes: kMaxFileBytes + 1),
        'El archivo pesa 60,0 MB y el límite es 60,0 MB.',
      );
      expect(checkFileLimits(bytes: 1000, durationS: 1200), isNull);
      expect(
        checkFileLimits(bytes: 1000, durationS: 1201),
        'La canción dura más de 20 minutos. Divídela en partes más cortas.',
      );
    });

    test('los megabytes llevan coma decimal', () {
      expect(formatMegabytes(1572864), '1,5 MB');
    });
  });

  group('identificadores y registros', () {
    test(
      'el id local es L más 16 hexadecimales y no choca con el catálogo',
      () {
        final id = localSongIdFromBytes([0, 1, 2, 3, 4, 5, 6, 255]);
        expect(id, 'L00010203040506ff');
        expect(id.length, 17);
        expect(isLocalSongId(id), isTrue);
        expect(isLocalSongId('S5aac103b6eb2ecf4'), isFalse);
        expect(() => localSongIdFromBytes([1, 2]), throwsArgumentError);
      },
    );

    test('el id aleatorio cumple el formato', () {
      final id = newLocalSongId(Random(7));
      expect(RegExp(r'^L[0-9a-f]{16}$').hasMatch(id), isTrue);
    });

    test('el registro ida y vuelta por JSON', () {
      const record = LocalSongRecord(
        id: 'L0102030405060708',
        title: 'Charleston',
        durationS: 185.5,
        channels: 2,
        bitrate: 48000,
        bytes: 1234,
        createdAt: 1700000000000,
      );
      final back = LocalSongRecord.fromJson(
        jsonDecode(jsonEncode(record.toJson())) as Map<String, dynamic>,
      );
      expect(back.id, record.id);
      expect(back.title, record.title);
      expect(back.durationS, 185.5);
      expect(back.bytes, 1234);
      expect(back.createdAt, record.createdAt);
    });

    test('un registro con id de catálogo o campos que faltan se rechaza', () {
      final base = {
        'id': 'L0102030405060708',
        'title': 'T',
        'duration_s': 1,
        'channels': 1,
        'bitrate': 32000,
        'bytes': 10,
        'created_at': 1,
      };
      expect(
        () => LocalSongRecord.fromJson({...base, 'id': 'S0102030405060708'}),
        throwsFormatException,
      );
      final missing = Map<String, dynamic>.from(base)..remove('bytes');
      expect(() => LocalSongRecord.fromJson(missing), throwsFormatException);
    });
  });

  group('resumen para el cuidador', () {
    test('cuenta las añadidas y explica el primer fallo', () {
      final song = songFromRecord(
        const LocalSongRecord(
          id: 'L0000000000000001',
          title: 'A',
          durationS: 1,
          channels: 1,
          bitrate: 32000,
          bytes: 1,
          createdAt: 1,
        ),
        '/x/L0000000000000001.opus',
      );
      expect(
        describeAddResult(
          LocalAddResult(added: [song, song], failed: const []),
        ),
        'Añadidas 2 canciones.',
      );
      expect(
        describeAddResult(LocalAddResult(added: [song], failed: const [])),
        'Añadida 1 canción.',
      );
      expect(
        describeAddResult(
          const LocalAddResult(
            added: [],
            failed: [
              LocalAddFailure(name: 'roto.wav', message: 'no se puede leer'),
            ],
          ),
        ),
        'No se pudo añadir «roto.wav»: no se puede leer',
      );
      expect(
        describeAddResult(
          const LocalAddResult(
            added: [],
            failed: [
              LocalAddFailure(name: 'a.wav', message: 'x'),
              LocalAddFailure(name: 'b.wav', message: 'y'),
            ],
          ),
        ),
        'No se pudo añadir «a.wav» y 1 más: x',
      );
    });
  });

  group('almacén en este teléfono', () {
    late Directory root;
    late LocalAudioStore store;

    setUp(() async {
      root = await Directory.systemTemp.createTemp('reminiscencia_local_');
      store = LocalAudioStore(root: () async => root);
    });

    tearDown(() async {
      if (await root.exists()) await root.delete(recursive: true);
    });

    LocalSongRecord recordFor(String id, String title) => LocalSongRecord(
      id: id,
      title: title,
      durationS: 60,
      channels: 1,
      bitrate: 32000,
      bytes: 4,
      createdAt: 1,
    );

    test('una canción registrada aparece como local con su fichero', () async {
      const id = 'L00000000000000aa';
      final file = await store.audioFile(id);
      await file.writeAsBytes([1, 2, 3, 4]);
      await store.commit(recordFor(id, 'Charleston'));

      final songs = await store.songs();
      expect(songs, hasLength(1));
      expect(songs.single.id, id);
      expect(songs.single.title, 'Charleston');
      expect(songs.single.local, isTrue);
      expect(songs.single.audio, file.path);
      expect(songs.single.license, kLocalLicense);
    });

    test('registrar sin fichero escrito falla y no toca el índice', () async {
      await expectLater(
        store.commit(recordFor('L00000000000000bb', 'Sin fichero')),
        throwsA(isA<AppException>()),
      );
      expect(await store.readRecords(), isEmpty);
    });

    test(
      'las entradas sin fichero no se muestran y las dañadas se omiten',
      () async {
        const kept = 'L00000000000000cc';
        await (await store.audioFile(kept)).writeAsBytes([9]);
        final index = File('${root.path}/$kLocalIndexName');
        await index.writeAsString(
          jsonEncode({
            'version': 1,
            'pistas': [
              recordFor(kept, 'Está').toJson(),
              recordFor('L00000000000000dd', 'No está').toJson(),
              {'id': 'S0000000000000000', 'title': 'Catálogo'},
              'basura',
            ],
          }),
        );

        final songs = await store.songs();
        expect(songs.map((song) => song.title), ['Está']);
        expect((await store.readRecords()).map((r) => r.id), [
          kept,
          'L00000000000000dd',
        ]);
      },
    );

    test('borrar quita el registro y el fichero', () async {
      const id = 'L00000000000000ee';
      final file = await store.audioFile(id);
      await file.writeAsBytes([1]);
      await store.commit(recordFor(id, 'Borrar'));

      await store.delete(id);
      expect(await file.exists(), isFalse);
      expect(await store.songs(), isEmpty);
      expect(await store.readRecords(), isEmpty);
    });

    test(
      'borrar solo acepta ids locales y no toca el índice si se rechaza',
      () async {
        const id = 'L00000000000000ff';
        await (await store.audioFile(id)).writeAsBytes([1]);
        await store.commit(recordFor(id, 'Se queda'));

        await expectLater(
          store.delete('S5aac103b6eb2ecf4'),
          throwsA(isA<AppException>()),
        );
        expect(await store.songs(), hasLength(1));
      },
    );
  });

  group('alta de archivos', () {
    late Directory root;
    late LocalAudioStore store;
    late int clock;

    setUp(() async {
      root = await Directory.systemTemp.createTemp('reminiscencia_alta_');
      store = LocalAudioStore(root: () async => root);
      clock = 1700000000000;
    });

    tearDown(() async {
      if (await root.exists()) await root.delete(recursive: true);
    });

    LocalAudioLibrary libraryWith(FakeConverter converter) => LocalAudioLibrary(
      store: store,
      converter: converter,
      random: Random(42),
      clock: () => DateTime.fromMillisecondsSinceEpoch(clock += 1000),
    );

    test('convierte, guarda y el título sale del nombre del archivo', () async {
      final converter = FakeConverter();
      final library = libraryWith(converter);
      final progress = <String>[];

      final result = await library.addFiles(
        const [
          PickedAudioFile(
            name: 'Charleston.mp3',
            path: '/musica/Charleston.mp3',
          ),
          PickedAudioFile(name: 'Blues.flac', path: '/musica/Blues.flac'),
        ],
        onProgress: (index, total, title) =>
            progress.add('$index/$total $title'),
      );

      expect(result.failed, isEmpty);
      expect(result.added.map((song) => song.title), ['Charleston', 'Blues']);
      expect(converter.titles, ['Charleston', 'Blues']);
      expect(progress, ['0/2 Charleston', '1/2 Blues']);
      for (final song in result.added) {
        expect(song.local, isTrue);
        expect(song.id.startsWith('L'), isTrue);
        expect(await File(song.audio).exists(), isTrue);
      }

      final records = await store.readRecords();
      expect(records.map((r) => r.title), ['Charleston', 'Blues']);
      expect(records.first.bytes, 1234);
      expect(records.first.bitrate, 48000);
      expect(records.first.channels, 2);
      expect(records.first.durationS, 185.5);
      expect(records.first.createdAt, greaterThan(0));
    });

    test('un archivo que falla no para a los demás y no deja restos', () async {
      final converter = FakeConverter(
        failures: {'roto.wav': 'No se puede leer este archivo.'},
      );
      final library = libraryWith(converter);

      final result = await library.addFiles(const [
        PickedAudioFile(name: 'roto.wav', path: '/musica/roto.wav'),
        PickedAudioFile(name: 'bien.mp3', path: '/musica/bien.mp3'),
      ]);

      expect(result.added.map((song) => song.title), ['bien']);
      expect(result.failed.single.name, 'roto.wav');
      expect(result.failed.single.message, 'No se puede leer este archivo.');
      final leftovers = (await Directory('${root.path}/audio').list().toList())
          .whereType<File>()
          .map((file) => file.path.split('/').last)
          .toList();
      expect(leftovers, hasLength(1));
      expect((await store.readRecords()).map((r) => r.title), ['bien']);
    });

    test(
      'el error inesperado se traduce a un mensaje para el cuidador',
      () async {
        final library = LocalAudioLibrary(
          store: store,
          converter: _ThrowingConverter(),
          random: Random(1),
        );
        final result = await library.addFiles(const [
          PickedAudioFile(name: 'x.wav', path: '/musica/x.wav'),
        ]);
        expect(result.added, isEmpty);
        expect(
          result.failed.single.message,
          'error inesperado al convertir el archivo.',
        );
      },
    );

    test(
      'el archivo añadido aparece en songs() y se puede borrar con su canción',
      () async {
        final library = libraryWith(FakeConverter());
        final result = await library.addFiles(const [
          PickedAudioFile(name: 'Tema.ogg', path: '/musica/Tema.ogg'),
        ]);
        final song = result.added.single;

        expect((await library.songs()).map((s) => s.id), [song.id]);
        await library.delete(song);
        expect(await library.songs(), isEmpty);
        expect(await File(song.audio).exists(), isFalse);
      },
    );

    test('no se puede borrar desde aquí una canción del catálogo', () async {
      final library = libraryWith(FakeConverter());
      const publica = Song(
        id: 'S5aac103b6eb2ecf4',
        title: 'Pública',
        artist: '',
        year: null,
        tags: [],
        folderId: null,
        durationS: 1,
        license: 'Dominio público',
        audio: 'audio/S5aac103b6eb2ecf4.opus',
      );
      await expectLater(library.delete(publica), throwsA(isA<AppException>()));
    });
  });
}

class _ThrowingConverter implements AudioConverter {
  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) {
    throw StateError('fallo interno');
  }

  @override
  Future<void> cancel() async {}
}
