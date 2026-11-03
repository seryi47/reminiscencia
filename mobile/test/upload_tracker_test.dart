import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/local_audio.dart';
import 'package:reminiscencia/shared_upload.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/upload_tracker.dart';

import 'support/fakes.dart';

/// Conversor falso: escribe [bytes] bytes y cuenta las conversiones.
class CountingConverter implements AudioConverter {
  CountingConverter({this.bytes = 20});

  final int bytes;
  final List<String> titles = [];
  void Function()? onConvert;

  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) async {
    titles.add(title);
    onConvert?.call();
    await File(outputPath).writeAsBytes(List<int>.filled(bytes, 7));
    return ConvertedAudio(
      durationS: 12,
      channels: 2,
      bitrate: kBitrateStereo,
      bytes: bytes,
    );
  }

  @override
  Future<void> cancel() async {}
}

http.Response okReply() =>
    http.Response(jsonEncode({'ok': true, 'ruta': 'r', 'nombre': 'n'}), 200);

http.Response errorReply(int status, String message) =>
    http.Response(jsonEncode({'ok': false, 'error': message}), status);

PickedAudioFile picked(String name) =>
    PickedAudioFile(name: name, path: '/origen/$name');

/// Deja terminar la E/S real (escrituras del índice, ficheros).
Future<void> settleIo() =>
    Future<void>.delayed(const Duration(milliseconds: 60));

void main() {
  late Directory work;
  late Directory storeDir;
  late List<http.Request> requests;
  late FakePollTimer timers;
  late FakePublishedSongs published;
  late DateTime now;
  late CountingConverter converter;
  late http.Response Function(int n) reply;
  late bool online;

  setUp(() async {
    work = await Directory.systemTemp.createTemp('subida_tracker');
    storeDir = Directory('${work.path}/subidas');
    requests = [];
    timers = FakePollTimer();
    published = FakePublishedSongs([const PublishedSong('S1', 'Charleston')]);
    now = DateTime(2026, 11, 3, 10);
    converter = CountingConverter();
    reply = (_) => okReply();
    online = true;
  });

  tearDown(() async {
    // Deja terminar las escrituras del índice que siguen en marcha.
    await settleIo();
    if (await work.exists()) await work.delete(recursive: true);
  });

  SharedUploader uploader({int chunkBytes = kUploadChunkBytes}) =>
      SharedUploader(
        client: MockClient((request) async {
          requests.add(request);
          return reply(requests.length);
        }),
        converter: converter,
        hasConnection: () async => online,
        workDir: () async => Directory('${work.path}/tmp'),
        retryDelay: Duration.zero,
        chunkBytes: chunkBytes,
        random: Random(3),
      );

  UploadsStore store() => UploadsStore(root: () async => storeDir);

  UploadTracker tracker({
    int chunkBytes = kUploadChunkBytes,
    List<UploadEntry>? publishedLog,
  }) => UploadTracker(
    uploader: uploader(chunkBytes: chunkBytes),
    published: published,
    store: store(),
    clock: () => now,
    timer: timers.call,
    random: Random(5),
    onPublished: publishedLog?.add,
  );

  group('estados', () {
    test(
      'cada paso hasta «Guardada en GitHub», con porcentaje por trozos',
      () async {
        converter = CountingConverter(bytes: 25);
        final t2 = tracker(chunkBytes: 10);
        final seen = <String>[];
        Song? duringSend;
        t2.addListener(() {
          if (t2.entries.isEmpty) return;
          final entry = t2.entries.single;
          if (seen.isEmpty || seen.last != entry.statusText) {
            seen.add(entry.statusText);
          }
          if (entry.stage == UploadStage.sending) {
            duringSend ??= t2.provisionalSongs().singleOrNull;
          }
        });

        await t2.start([picked('Larga.flac')]);

        expect(seen, [
          'En espera',
          'Convirtiendo a Opus…',
          'Subiendo… 0 %',
          'Subiendo… 33 %',
          'Subiendo… 67 %',
          'Guardada en GitHub',
        ]);
        expect(requests, hasLength(3));
        // En cuanto termina la conversión ya es una canción que suena desde su copia local.
        expect(duringSend, isNotNull);
        expect(duringSend!.title, 'Larga');
        expect(duringSend!.uploadStatus, kPublishingLabel);
        expect(duringSend!.local, isTrue);
        expect(await File(duringSend!.audio).exists(), isTrue);
        expect(t2.summary, '0 de 1 publicada');
        expect(t2.busy, isFalse);
        t2.dispose();
      },
    );

    test('textos de cada estado y resumen en plural', () {
      final entry = UploadEntry(key: 'P0', name: 'a.mp3', title: 'a');
      expect(entry.statusText, 'En espera');
      entry
        ..stage = UploadStage.sending
        ..part = 9
        ..parts = 20;
      expect(entry.statusText, 'Subiendo… 45 %');
      expect(entry.progress, closeTo(0.45, 1e-9));
      entry.stage = UploadStage.publishing;
      expect(entry.statusText, 'Publicándose… (suele tardar 2–3 minutos)');
      expect(entry.progress, isNull, reason: 'barra indeterminada');
      entry.stage = UploadStage.published;
      expect(entry.statusText, 'Publicada');
      entry.stage = UploadStage.slow;
      expect(entry.statusText, kSlowPublishMessage);
      entry
        ..stage = UploadStage.failed
        ..error = 'no hay conexión con la web.';
      expect(entry.statusText, 'Error: no hay conexión con la web.');
      expect(
        failureReason(
          'pendiente: la subida se paró al salir de la app. Vuelve a subirlo.',
        ),
        'la subida se paró al salir de la app.',
      );
    });

    test('sin red no crea filas ni envía nada', () async {
      online = false;
      final t = tracker();
      await expectLater(
        t.start([picked('Tema.mp3')]),
        throwsA(isA<AppException>()),
      );
      expect(t.entries, isEmpty);
      expect(requests, isEmpty);
      expect(converter.titles, isEmpty);
      t.dispose();
    });
  });

  group('publicación (songs.json simulado)', () {
    test(
      'cada 20 s hasta que aparece una canción nueva con ese título',
      () async {
        final log = <UploadEntry>[];
        final t = tracker(publishedLog: log);
        final notices = <UploadNotice>[];
        t.notices.listen(notices.add);

        await t.start([picked('Charleston.mp3')]);
        await settleIo();

        final entry = t.entries.single;
        expect(entry.stage, UploadStage.saved);
        expect(entry.baseline, {'S1'});
        expect(timers.active, hasLength(1));
        expect(timers.active.single.period, const Duration(seconds: 20));

        // Primera comprobación: solo está la «Charleston» que ya había (mismo título, id conocido).
        timers.fire();
        await settleIo();
        expect(entry.stage, UploadStage.publishing);
        expect(published.fetches, 2, reason: 'la de antes de subir y esta');

        published.songs.add(const PublishedSong('S9', '  charleston '));
        timers.fire();
        await settleIo();

        expect(entry.stage, UploadStage.published);
        expect(entry.publishedId, 'S9');
        expect(entry.statusText, 'Publicada');
        expect(t.summary, '1 de 1 publicada');
        expect(log, [entry]);
        expect(notices.single.message, '«Charleston» ya está publicada.');
        expect(timers.active, isEmpty, reason: 'nada más que comprobar');
        // Ya no se recuerda: no queda nada por publicar.
        final saved = await store().read();
        expect(saved, isEmpty);
        t.dispose();
      },
    );

    test(
      'dos archivos con el mismo título se quedan cada uno con la suya',
      () async {
        final t = tracker();
        await t.start([picked('Tango.mp3'), picked('Tango.wav')]);
        await settleIo();
        published.songs.addAll(const [
          PublishedSong('S20', 'Tango'),
          PublishedSong('S21', 'Tango'),
        ]);
        timers.fire();
        await settleIo();
        expect(t.entries.map((e) => e.publishedId), ['S20', 'S21']);
        expect(t.summary, '2 de 2 publicadas');
        t.dispose();
      },
    );

    test(
      'a los 10 minutos: «Sigue procesándose» y deja de comprobar; la biblioteca lo reconoce después',
      () async {
        final t = tracker();
        await t.start([picked('Lenta.mp3')]);
        await settleIo();
        timers.fire();
        await settleIo();
        expect(t.entries.single.stage, UploadStage.publishing);

        now = now.add(const Duration(minutes: 10));
        timers.fire();
        await settleIo();

        final entry = t.entries.single;
        expect(entry.stage, UploadStage.slow);
        expect(entry.statusText, kSlowPublishMessage);
        expect(timers.active, isEmpty);
        final fetches = published.fetches;

        // Más tarde, una sincronización normal de la biblioteca (sin peticiones extra) la encuentra.
        t.reconcile([
          Song(
            id: 'S30',
            title: 'Lenta',
            artist: '',
            year: null,
            tags: const [],
            folderId: null,
            durationS: 12,
            license: 'x',
            audio: 'audio/S30.opus',
          ),
        ]);
        expect(entry.stage, UploadStage.published);
        expect(entry.publishedId, 'S30');
        expect(published.fetches, fetches);
        t.dispose();
      },
    );

    test('un fallo al leer songs.json no corta la comprobación', () async {
      final t = tracker();
      await t.start([picked('Uno.mp3')]);
      await settleIo();
      published.error = const SocketException('sin red');
      timers.fire();
      await settleIo();
      expect(t.entries.single.stage, UploadStage.publishing);
      expect(timers.active, hasLength(1));
      published.error = null;
      published.songs.add(const PublishedSong('S2', 'Uno'));
      timers.fire();
      await settleIo();
      expect(t.entries.single.stage, UploadStage.published);
      t.dispose();
    });

    test('parsePublishedSongs lee id y título y omite lo raro', () {
      final songs = parsePublishedSongs(
        jsonEncode([
          {'id': 'S1', 'title': 'Uno', 'audio': 'a'},
          {'id': 2, 'title': 'mal'},
          'nada',
        ]),
      );
      expect(songs.map((s) => s.id), ['S1']);
      expect(foldTitle('Canción  de  CUNA'), foldTitle('cancion de cuna'));
      expect(foldTitle('Canción'), foldTitle('Canción'));
    });

    test('HttpPublishedSongs pide data/songs.json sin caché', () async {
      final seen = <http.Request>[];
      final source = HttpPublishedSongs(
        client: MockClient((request) async {
          seen.add(request);
          return http.Response.bytes(
            utf8.encode(
              jsonEncode([
                {'id': 'S1', 'title': 'Canción'},
              ]),
            ),
            200,
          );
        }),
      );
      final songs = await source.fetch();
      expect(
        seen.single.url,
        Uri.parse('https://reminiscencia.vercel.app/data/songs.json'),
      );
      expect(seen.single.headers['Cache-Control'], 'no-cache');
      expect(songs.single.title, 'Canción');
    });
  });

  group('error y reintento', () {
    test(
      'un rechazo deja «Error» y «Reintentar» reenvía el mismo Opus sin convertir de nuevo',
      () async {
        reply = (n) => n == 1
            ? errorReply(400, 'El archivo no es audio Ogg Opus.')
            : okReply();
        final t = tracker();
        await t.start([picked('Rara.wav')]);

        final entry = t.entries.single;
        expect(entry.stage, UploadStage.failed);
        expect(entry.statusText, 'Error: El archivo no es audio Ogg Opus.');
        expect(entry.canRetry, isTrue);
        // Sigue en la biblioteca, con «Error», y suena desde su copia.
        final song = t.provisionalSongs().single;
        expect(song.uploadStatus, kUploadErrorLabel);
        expect(await File(song.audio).exists(), isTrue);

        await t.retry(entry.key);

        expect(entry.stage, UploadStage.saved);
        expect(converter.titles, ['Rara'], reason: 'no se convierte otra vez');
        expect(requests, hasLength(2));
        expect(requests.last.headers['X-Nombre-Archivo'], 'Rara.wav');
        t.dispose();
      },
    );

    test('reintentar sin red deja el error con el motivo', () async {
      reply = (_) => errorReply(400, 'No.');
      final t = tracker();
      await t.start([picked('Uno.mp3')]);
      online = false;
      await t.retry(t.entries.single.key);
      expect(t.entries.single.statusText, 'Error: $kNoConnectionReason');
      expect(requests, hasLength(1));
      t.dispose();
    });

    test(
      'al salir de la app se para: lo que falta queda con error y se puede reintentar',
      () async {
        final t = tracker();
        converter.onConvert = () {
          if (converter.titles.length == 2) t.pause();
        };
        await t.start([
          picked('Uno.mp3'),
          picked('Dos.mp3'),
          picked('Tres.mp3'),
        ]);

        expect(t.entries.map((e) => e.stage), [
          UploadStage.saved,
          UploadStage.saved,
          UploadStage.failed,
        ]);
        expect(
          t.entries.last.statusText,
          'Error: la subida se paró al salir de la app.',
        );
        expect(
          timers.active,
          isEmpty,
          reason: 'en segundo plano no se comprueba',
        );

        t.setForeground(true);
        converter.onConvert = null;
        await t.retry(t.entries.last.key);
        expect(t.entries.last.stage, UploadStage.saved);
        expect(converter.titles, ['Uno', 'Dos', 'Tres']);
        t.dispose();
      },
    );
  });

  group('primer plano y segundo plano', () {
    test('sin nada que publicar no hay temporizador', () async {
      final t = tracker();
      expect(timers.timers, isEmpty);
      t.setForeground(false);
      t.setForeground(true);
      expect(timers.timers, isEmpty);
      t.dispose();
    });

    test(
      'en segundo plano no hay temporizador ni peticiones; al volver comprueba enseguida',
      () async {
        final t = tracker();
        await t.start([picked('Uno.mp3')]);
        await settleIo();
        expect(timers.active, hasLength(1));

        t.setForeground(false);
        expect(timers.active, isEmpty);
        final fetches = published.fetches;
        timers.fire();
        await t.checkNow();
        await settleIo();
        expect(published.fetches, fetches, reason: 'nada en segundo plano');

        published.songs.add(const PublishedSong('S5', 'Uno'));
        t.setForeground(true);
        await settleIo();
        expect(published.fetches, fetches + 1);
        expect(t.entries.single.stage, UploadStage.published);
        expect(timers.active, isEmpty);
        t.dispose();
      },
    );

    test(
      'al volver tras 10 minutos fuera, mira una vez y, si no está, «Sigue procesándose»',
      () async {
        final t = tracker();
        await t.start([picked('Uno.mp3')]);
        await settleIo();
        t.setForeground(false);
        now = now.add(const Duration(minutes: 12));
        t.setForeground(true);
        await settleIo();
        expect(t.entries.single.stage, UploadStage.slow);
        expect(timers.active, isEmpty);
        t.dispose();
      },
    );

    test(
      'lo pendiente se guarda y se sigue comprobando al volver a abrir la app',
      () async {
        final first = tracker();
        await first.start([picked('Uno.mp3')]);
        await settleIo();
        final key = first.entries.single.key;
        first.dispose();
        // Un Opus que ya no es de ninguna subida se borra al recuperar.
        await File('${storeDir.path}/Pdeadbeefdeadbeef.opus').writeAsBytes([1]);

        timers = FakePollTimer();
        final second = tracker();
        await second.restore();
        await settleIo();

        final entry = second.entries.single;
        expect(entry.key, key);
        expect(entry.stage, UploadStage.publishing);
        expect(second.provisionalSongs().single.title, 'Uno');
        expect(
          await File('${storeDir.path}/Pdeadbeefdeadbeef.opus').exists(),
          isFalse,
        );
        expect(timers.active, hasLength(1));

        published.songs.add(const PublishedSong('S7', 'Uno'));
        timers.fire();
        await settleIo();
        expect(entry.stage, UploadStage.published);
        second.dispose();
      },
    );
  });

  group('biblioteca', () {
    Song catalogSong(String id, String title) => Song(
      id: id,
      title: title,
      artist: 'Artista',
      year: null,
      tags: const [],
      folderId: null,
      durationS: 100,
      license: 'Dominio público',
      audio: 'audio/$id.opus',
    );

    test(
      'aparece al terminar la conversión y la pública la sustituye sin cortar la reproducción',
      () async {
        final t = buildTestServices(
          songs: [catalogSong('S1', 'Charleston')],
          uploader: uploader(),
          published: published,
          uploadsStore: store(),
          pollTimer: timers.call,
          clock: () => now,
        );
        final library = t.services.library;
        await library.load();
        List<Song>? recentWhileSending;
        reply = (_) {
          recentWhileSending ??= library.recentSongs();
          return okReply();
        };

        await library.uploadShared([picked('Vals nuevo.mp3')]);
        await settleIo();

        expect(recentWhileSending!.first.title, 'Vals nuevo');
        expect(recentWhileSending!.first.uploadStatus, kPublishingLabel);
        final provisional = library.songs.last;
        expect(provisional.title, 'Vals nuevo');
        expect(isProvisionalSongId(provisional.id), isTrue);
        final opus = File(provisional.audio);
        expect(await opus.exists(), isTrue);

        // Suena desde la copia local.
        await library.playSong(provisional);
        expect(t.playback.nowPlaying.value.songId, provisional.id);
        final log = List.of(t.playback.log);

        published.songs.add(const PublishedSong('S2', 'Vals nuevo'));
        t.source.songs = [
          catalogSong('S1', 'Charleston'),
          catalogSong('S2', 'Vals nuevo'),
        ];
        timers.fire();
        await settleIo();

        // La biblioteca se sincronizó sola: la pública sustituye a la provisional.
        expect(library.songs.map((s) => s.id), ['S1', 'S2']);
        expect(library.recentSongs().first.id, 'S2');
        expect(library.songOrNull(provisional.id)?.id, 'S2');
        // Sin cortar: no se tocó el reproductor y la copia sigue mientras suena.
        expect(t.playback.log, log);
        expect(t.playback.nowPlaying.value.songId, provisional.id);
        expect(await opus.exists(), isTrue);

        // Al pasar a otra canción, la copia local se borra.
        await library.playSong(library.songs.first);
        await settleIo();
        expect(await opus.exists(), isFalse);
        library.dispose();
      },
    );

    test('si falla queda en la biblioteca con «Error»', () async {
      reply = (_) => errorReply(400, 'No vale.');
      final t = buildTestServices(
        songs: [catalogSong('S1', 'Charleston')],
        uploader: uploader(),
        published: published,
        uploadsStore: store(),
        pollTimer: timers.call,
      );
      final library = t.services.library;
      await library.load();
      await library.uploadShared([picked('Mala.mp3')]);
      final song = library.recentSongs().first;
      expect(song.title, 'Mala');
      expect(song.uploadStatus, kUploadErrorLabel);
      reply = (_) => okReply();
      await library.retryUpload(song.id);
      expect(library.recentSongs().first.uploadStatus, kPublishingLabel);
      library.dispose();
    });
  });
}
