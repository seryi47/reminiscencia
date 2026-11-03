import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/local_audio.dart';
import 'package:reminiscencia/zip_audio.dart';

import 'support/zips.dart';

void main() {
  late Directory work;

  setUp(() async {
    work = await Directory.systemTemp.createTemp('zip_audio');
  });

  tearDown(() async {
    if (await work.exists()) await work.delete(recursive: true);
  });

  group('qué se saca', () {
    test(
      'audio en subcarpetas sí; carpetas, __MACOSX, ocultos y no-audio no',
      () {
        expect(isZipAudioEntry('Uno.mp3'), isTrue);
        expect(isZipAudioEntry('CD1/Dos.WAV'), isTrue);
        expect(isZipAudioEntry('a/b/c/Tres.flac'), isTrue);
        for (final ext in kZipAudioExtensions) {
          expect(isZipAudioEntry('x/pista.$ext'), isTrue, reason: ext);
        }
        expect(isZipAudioEntry('CD1/'), isFalse);
        expect(isZipAudioEntry('__MACOSX/CD1/._Dos.wav'), isFalse);
        expect(isZipAudioEntry('CD1/.oculta.mp3'), isFalse);
        expect(isZipAudioEntry('.ocultos/Uno.mp3'), isFalse);
        expect(isZipAudioEntry('.DS_Store'), isFalse);
        expect(isZipAudioEntry('../../Uno.mp3'), isTrue);
        expect(isZipAudioEntry('..'), isFalse);
        expect(isZipAudioEntry('portada.jpg'), isFalse);
        expect(isZipAudioEntry('notas.txt'), isFalse);
        expect(isZipAudioEntry('sin-extension'), isFalse);
        expect(isZipName('Álbum.ZIP'), isTrue);
        expect(isZipName('Álbum.mp3'), isFalse);
      },
    );

    test('nombre base y título sin ruta ni extensión', () {
      expect(
        zipEntryBaseName('CD1/sub/Canción de cuna.mp3'),
        'Canción de cuna.mp3',
      );
      expect(zipEntryBaseName(r'CD1\Vals.flac'), 'Vals.flac');
      expect(
        titleFromFileName(zipEntryBaseName('a/b/Año viejo.ogg')),
        'Año viejo',
      );
    });
  });

  group('listZipAudio', () {
    test(
      'lista las canciones (también de subcarpetas) y cuenta las ignoradas',
      () async {
        final zip = await writeZip(
          work,
          'Álbum.zip',
          buildZip(
            {
              'Álbum/01 Canción de cuna.mp3': fakeAudioBytes('1'),
              'Álbum/CD2/02 Pasodoble.WAV': fakeAudioBytes('2'),
              'Álbum/CD2/más/03 Jota.opus': fakeAudioBytes('3'),
              'Ñandú.m4a': fakeAudioBytes('4'),
              '__MACOSX/Álbum/._01 Canción de cuna.mp3': fakeAudioBytes('5'),
              'Álbum/.DS_Store': fakeAudioBytes('6'),
              'Álbum/.oculta.ogg': fakeAudioBytes('7'),
              'Álbum/portada.jpg': fakeAudioBytes('8'),
              'Álbum/léeme.txt': fakeAudioBytes('9'),
            },
            directories: [
              'Álbum/',
              'Álbum/CD2/',
              'Álbum/CD2/más/',
              '__MACOSX/',
            ],
          ),
        );
        final listing = await listZipAudio(zip.path, 'Álbum.zip');
        expect(listing.songs.map((s) => s.name), [
          '01 Canción de cuna.mp3',
          '02 Pasodoble.WAV',
          '03 Jota.opus',
          'Ñandú.m4a',
        ]);
        expect(listing.songs.map((s) => titleFromFileName(s.name)), [
          '01 Canción de cuna',
          '02 Pasodoble',
          '03 Jota',
          'Ñandú',
        ]);
        expect(listing.ignored, 5, reason: 'las carpetas no cuentan');
        expect(listing.songs.first.zipName, 'Álbum.zip');
      },
    );

    test('un ZIP dañado o que no es ZIP da un error claro', () async {
      final junk = await writeZip(work, 'Roto.zip', List<int>.filled(500, 42));
      await expectLater(
        listZipAudio(junk.path, 'Roto.zip'),
        throwsA(
          isA<AppException>().having(
            (e) => e.message,
            'message',
            '«Roto.zip» está dañado o no es un ZIP válido.',
          ),
        ),
      );
      final full = buildZip({'Uno.mp3': fakeAudioBytes('1')});
      final cut = await writeZip(
        work,
        'Cortado.zip',
        full.sublist(0, full.length - 30),
      );
      await expectLater(
        listZipAudio(cut.path, 'Cortado.zip'),
        throwsA(isA<AppException>()),
      );
      await expectLater(
        listZipAudio('${work.path}/no-existe.zip', 'No.zip'),
        throwsA(isA<AppException>()),
      );
    });

    test('un ZIP con contraseña da un error claro', () async {
      final zip = await writeZip(
        work,
        'Cifrado.zip',
        buildZip({'Uno.mp3': fakeAudioBytes('1')}, password: 'secreta'),
      );
      await expectLater(
        listZipAudio(zip.path, 'Cifrado.zip'),
        throwsA(
          isA<AppException>().having(
            (e) => e.message,
            'message',
            '«Cifrado.zip» está protegido con contraseña; no se puede abrir.',
          ),
        ),
      );
    });

    test('un ZIP sin canciones no es un error', () async {
      final zip = await writeZip(
        work,
        'Fotos.zip',
        buildZip({'a.jpg': fakeAudioBytes('1'), 'b.txt': fakeAudioBytes('2')}),
      );
      final listing = await listZipAudio(zip.path, 'Fotos.zip');
      expect(listing.songs, isEmpty);
      expect(listing.ignored, 2);
    });
  });

  group('extractZipSong', () {
    test(
      'saca cada canción, con su contenido exacto, a la ruta que da la app',
      () async {
        final bytes = {
          'CD1/Canción ñ.mp3': fakeAudioBytes('a', length: 200000),
          'CD2/sub/Vals.flac': fakeAudioBytes('b', length: 5000),
        };
        final zip = await writeZip(work, 'Álbum.zip', buildZip(bytes));
        final listing = await listZipAudio(zip.path, 'Álbum.zip');
        final out = Directory('${work.path}/salida')..createSync();
        for (final song in listing.songs) {
          final target = '${out.path}/x${song.dotExtension}';
          await extractZipSong(song, target);
          expect(await File(target).readAsBytes(), bytes[song.entryName]);
          await File(target).delete();
        }
        expect(listing.songs.map((s) => s.dotExtension), ['.mp3', '.flac']);
        expect(await zip.exists(), isTrue, reason: 'el ZIP no se toca');
      },
    );

    test(
      'zip-slip: una entrada con «../» o ruta absoluta no escribe fuera',
      () async {
        final raw = buildZip({
          'XX/XX/fuera.mp3': fakeAudioBytes('f'),
          'XXXabs/evil.wav': fakeAudioBytes('e'),
        });
        var zipBytes = renameInZip(raw, 'XX/XX/fuera.mp3', '../../fuera.mp3');
        zipBytes = renameInZip(zipBytes, 'XXXabs/evil.wav', '/tmp/a/evil.wav');
        final inner = Directory('${work.path}/a/b')
          ..createSync(recursive: true);
        final zip = await writeZip(inner, 'Malo.zip', zipBytes);
        final listing = await listZipAudio(zip.path, 'Malo.zip');
        expect(listing.songs.map((s) => s.entryName), [
          '../../fuera.mp3',
          '/tmp/a/evil.wav',
        ]);
        expect(listing.songs.map((s) => s.name), ['fuera.mp3', 'evil.wav']);

        final out = Directory('${inner.path}/salida')..createSync();
        for (final song in listing.songs) {
          await extractZipSong(song, '${out.path}/cancion${song.dotExtension}');
        }
        final written = work
            .listSync(recursive: true)
            .whereType<File>()
            .map((f) => f.uri.pathSegments.last)
            .toSet();
        expect(written, {'Malo.zip', 'cancion.mp3', 'cancion.wav'});
        expect(File('/tmp/a/evil.wav').existsSync(), isFalse);
      },
    );

    test(
      'una canción dañada dentro del ZIP da un error claro y no deja nada',
      () async {
        final random = Random(1);
        final song = List<int>.generate(50000, (_) => random.nextInt(256));
        final raw = buildZip({'Dañada.mp3': song});
        // Estropea los datos comprimidos (detrás de la cabecera local), no el índice.
        final broken = Uint8List.fromList(raw);
        for (var i = 200; i < 400; i += 1) {
          broken[i] = broken[i] ^ 0x5a;
        }
        final zip = await writeZip(work, 'Roto.zip', broken);
        final listing = await listZipAudio(zip.path, 'Roto.zip');
        final target = '${work.path}/salida.mp3';
        await expectLater(
          extractZipSong(listing.songs.single, target),
          throwsA(
            isA<AppException>().having(
              (e) => e.message,
              'message',
              'no se pudo sacar del ZIP «Roto.zip»: está dañado.',
            ),
          ),
        );
        expect(File(target).existsSync(), isFalse);
      },
    );

    test('si el ZIP ya no está, lo dice', () async {
      final zip = await writeZip(
        work,
        'Uno.zip',
        buildZip({'Uno.mp3': fakeAudioBytes('1')}),
      );
      final listing = await listZipAudio(zip.path, 'Uno.zip');
      await zip.delete();
      await expectLater(
        extractZipSong(listing.songs.single, '${work.path}/x.mp3'),
        throwsA(
          isA<AppException>().having(
            (e) => e.message,
            'message',
            'ya no está «Uno.zip». Vuelve a elegirlo.',
          ),
        ),
      );
    });
  });
}
