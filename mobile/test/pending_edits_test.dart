import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/edit_remote.dart';
import 'package:reminiscencia/library_requests.dart';
import 'package:reminiscencia/pending_edits.dart';
import 'package:reminiscencia/song.dart';

import 'support/fakes.dart';

// Ediciones pendientes (ADR-0027): el contrato común con la web (tests/contrato/ediciones-pendientes.json) y el
// controlador (guardar, recuperar, duplicados, sustitución, reintento, plazos y esperas).

final DateTime t0 = DateTime(2026, 11, 5, 10);

Map<String, dynamic> loadContract() {
  final file = File('../tests/contrato/ediciones-pendientes.json');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

PendingEdit editFromContract(Map<String, dynamic> json, [int index = 0]) {
  final created = json['createdAtMin'];
  final closed = json['closedAtMin'];
  return PendingEdit(
    key: 'k$index',
    kind: json['kind'] as String,
    payload: (json['payload'] as Map?)?.cast<String, Object?>(),
    targetId: json['targetId'] as String?,
    issue: json.containsKey('issue') ? json['issue'] as int? : 7,
    createdAt: t0.add(Duration(minutes: created is int ? created : 0)),
    closedAt: closed is int ? t0.add(Duration(minutes: closed)) : null,
    state: (json['state'] as String?) ?? kEditPending,
    hadCover: json['hadCover'] == true,
    preview: json['preview'] as String?,
    coverKey: json['coverKey'] as String?,
    knownFolderIds: [
      for (final id in (json['knownFolderIds'] as List? ?? const [])) '$id',
    ],
  );
}

({List<Song> songs, List<Folder> folders}) catalogFrom(
  Map<String, dynamic> contract, [
  Map<String, dynamic> changes = const {},
]) {
  final base = contract['catalogo'] as Map<String, dynamic>;
  final songPatches = (changes['canciones'] as Map?) ?? const {};
  final folderPatches = (changes['albumes'] as Map?) ?? const {};
  final songs = [
    for (final raw in base['songs'] as List)
      Song.fromJson({
        ...(raw as Map<String, dynamic>),
        ...((songPatches[raw['id']] as Map?)?.cast<String, dynamic>() ??
            const {}),
      }),
  ];
  final folders = [
    for (final raw in [
      ...base['folders'] as List,
      ...(changes['albumesNuevos'] as List? ?? const []),
    ])
      Folder.fromJson({
        ...(raw as Map<String, dynamic>),
        ...((folderPatches[raw['id']] as Map?)?.cast<String, dynamic>() ??
            const {}),
      }),
  ];
  return (songs: songs, folders: folders);
}

Object? songField(Song song, String field) => switch (field) {
  'title' => song.title,
  'artist' => song.artist,
  'year' => song.year,
  'tags' => song.tags,
  'folder_id' => song.folderId,
  'track' => song.track,
  'cover' => song.cover,
  _ => throw ArgumentError(field),
};

void main() {
  final contract = loadContract();

  group('contrato común', () {
    test('constantes', () {
      final constants = contract['constantes'] as Map<String, dynamic>;
      expect(kEditCheckDelaysS, constants['esperasSegundos']);
      expect(kEditMaxPending.inMinutes, constants['maxPendienteMin']);
      expect(kEditClosedGrace.inMinutes, constants['graciaCerradaMin']);
      expect(kEditCoverAssume.inMinutes, constants['portadaSupuestaMin']);
      final delays = constants['esperasSegundos'] as List;
      for (var i = 0; i < delays.length + 3; i++) {
        expect(
          editCheckDelay(i).inSeconds,
          delays[i.clamp(0, delays.length - 1)],
        );
      }
    });

    for (final raw in contract['aplicar'] as List) {
      final kase = raw as Map<String, dynamic>;
      test('aplicar: ${kase['nombre']}', () {
        final catalog = catalogFrom(contract);
        final edits = [
          for (final (i, e) in (kase['ediciones'] as List).indexed)
            editFromContract(e as Map<String, dynamic>, i),
        ];
        final view = applyPendingEdits(catalog.songs, catalog.folders, edits);
        final byId = {for (final song in view.songs) song.id: song};
        final expectedSongs = (kase['canciones'] as Map?) ?? const {};
        for (final entry in expectedSongs.entries) {
          final song = byId[entry.key]!;
          for (final field in (entry.value as Map).entries) {
            expect(
              songField(song, field.key as String),
              field.value,
              reason: '${entry.key}.${field.key}',
            );
          }
        }
        final folders = {for (final folder in view.folders) folder.id: folder};
        final expectedFolders = (kase['albumes'] as Map?) ?? const {};
        for (final entry in expectedFolders.entries) {
          final folder = folders[entry.key]!;
          final fields = entry.value as Map;
          if (fields.containsKey('name')) expect(folder.name, fields['name']);
          if (fields.containsKey('artist')) {
            expect(folder.artist, fields['artist']);
          }
        }
        if (kase['totalAlbumes'] != null) {
          expect(view.folders.length, kase['totalAlbumes']);
        }
        final marked = kase['marcadas'] as Map<String, dynamic>;
        expect(
          view.songIds.toList()..sort(),
          [...marked['canciones'] as List]..sort(),
        );
        expect(
          view.folderIds.toList()..sort(),
          [...marked['albumes'] as List]..sort(),
        );
        // La marca va en lo que se pinta y el catálogo de entrada no cambia.
        for (final song in view.songs) {
          expect(song.pendingEdit, view.songIds.contains(song.id));
        }
        for (final folder in view.folders) {
          expect(folder.pendingEdit, view.folderIds.contains(folder.id));
        }
        expect(catalog.songs.every((song) => !song.pendingEdit), isTrue);
        expect(
          catalogFrom(contract).songs.map((s) => s.title),
          catalog.songs.map((s) => s.title),
        );
      });
    }

    for (final raw in contract['reflejada'] as List) {
      final kase = raw as Map<String, dynamic>;
      test('reflejada: ${kase['nombre']}', () {
        final catalog = catalogFrom(
          contract,
          (kase['cambios'] as Map).cast<String, dynamic>(),
        );
        final edit = editFromContract(kase['edicion'] as Map<String, dynamic>);
        expect(
          isEditReflected(edit, catalog.songs, catalog.folders),
          kase['esperado'],
        );
      });
    }

    test('unpublish_song: quita la canción al instante y se confirma cuando ya no está (ADR-0041)', () {
      final catalog = catalogFrom(contract);
      const s1 = 'S0000000000000001';
      final edit = editFromContract({
        'kind': 'organize',
        'payload': {'op': 'unpublish_song', 'song_id': s1},
      });
      final view = applyPendingEdits(catalog.songs, catalog.folders, [edit]);
      expect(view.songs.any((s) => s.id == s1), isFalse,
          reason: 'la eliminada desaparece al instante');
      expect(view.songs.length, catalog.songs.length - 1);
      expect(view.songIds.contains(s1), isFalse,
          reason: 'una eliminada no se marca como pendiente, desaparece');
      expect(isEditReflected(edit, catalog.songs, catalog.folders), isFalse,
          reason: 'sigue en el catálogo → no reflejada');
      final sinS1 = catalog.songs.where((s) => s.id != s1).toList();
      expect(isEditReflected(edit, sinS1, catalog.folders), isTrue,
          reason: 'ya no está → reflejada');
    });

    for (final raw in contract['duplicado'] as List) {
      final kase = raw as Map<String, dynamic>;
      test('duplicado: ${kase['nombre']}', () {
        final a = editFromContract(kase['a'] as Map<String, dynamic>, 1);
        final b = editFromContract(kase['b'] as Map<String, dynamic>, 2);
        expect(isDuplicateEdit(a, b), kase['igual']);
        expect(isDuplicateEdit(b, a), kase['igual']);
      });
    }

    for (final raw in contract['sustituye'] as List) {
      final kase = raw as Map<String, dynamic>;
      test('sustituye: ${kase['nombre']}', () {
        final older = editFromContract(
          kase['anterior'] as Map<String, dynamic>,
          1,
        );
        final newer = editFromContract(
          kase['nueva'] as Map<String, dynamic>,
          2,
        );
        expect(supersedesEdit(newer, older), kase['esperado']);
      });
    }

    for (final raw in contract['revisar'] as List) {
      final kase = raw as Map<String, dynamic>;
      test('revisar: ${kase['nombre']}', () {
        final edit = editFromContract(kase['edicion'] as Map<String, dynamic>);
        final result = reviewEdit(
          edit,
          now: t0.add(Duration(minutes: kase['ahoraMin'] as int)),
          status: kase['estado'] as String?,
          reflected: kase['reflejada'] as bool,
          catalogOk: kase['catalogoOk'] as bool,
        );
        expect(result.outcome.name, switch (kase['esperado']) {
          'pendiente' => 'pending',
          'confirmada' => 'confirmed',
          _ => 'failed',
        });
        final closed = kase['closedAtMin'];
        expect(
          result.closedAt,
          closed is int ? t0.add(Duration(minutes: closed)) : null,
        );
      });
    }
  });

  group('textos', () {
    test('avisos y descripción de cada operación', () {
      expect(
        editFailedText('X'),
        'No se ha podido guardar «X». Inténtalo de nuevo.',
      );
      expect(editDuplicateText('X'), 'Ya está pendiente: «X».');
      expect(editConfirmedText('X'), 'Ya está guardado: «X».');
      final catalog = catalogFrom(contract);
      String describe(Map<String, Object?> payload) {
        final d = describeEdit(payload, catalog.songs, catalog.folders);
        return '${d.label} | ${d.action}';
      }

      const s1 = 'S0000000000000001';
      const f2 = 'F0000000000000002';
      expect(
        describe({'op': 'edit_song', 'song_id': s1, 'title': 'Nuevo'}),
        'Nuevo | Detalles de la canción',
      );
      expect(
        describe({'op': 'edit_song', 'song_id': s1, 'folder_id': f2}),
        'Uno | Añadir a «Álbum B»',
      );
      expect(
        describe({'op': 'edit_song', 'song_id': s1, 'folder_id': null}),
        'Uno | Quitar del álbum',
      );
      expect(
        describe({
          'op': 'move_songs',
          'song_ids': [s1, 'S0000000000000002'],
          'folder_id': f2,
        }),
        '2 canciones | Mover a «Álbum B»',
      );
      expect(
        describe({
          'op': 'move_songs',
          'song_ids': [s1],
          'folder_id': null,
        }),
        'Uno | Quitar del álbum',
      );
      expect(
        describe({'op': 'order_album', 'folder_id': f2, 'song_ids': []}),
        'Álbum B | Orden de las canciones',
      );
      expect(
        describe({'op': 'edit_folder', 'folder_id': f2, 'artist': 'Z'}),
        'Álbum B | Detalles del álbum',
      );
      expect(
        describe({'op': 'rename_folder', 'folder_id': f2, 'name': 'C'}),
        'C | Detalles del álbum',
      );
      expect(
        describe({'op': 'create_folder', 'name': 'Valses'}),
        'Valses | Álbum nuevo',
      );
      expect(coverLabel(f2, catalog.songs, catalog.folders), 'Álbum B');
    });
  });

  group('controlador', () {
    late MemoryPendingEditsStore store;
    late FakePollTimer timers;
    late FakeEditStatus status;
    late DateTime now;
    late ({List<Song> songs, List<Folder> folders}) catalog;
    late bool catalogOk;
    late List<LibraryRequest> sent;
    late int issues;
    Object? sendError;

    Future<EditReceipt> send(LibraryRequest request) async {
      if (sendError != null) throw sendError!;
      sent.add(request);
      return EditReceipt(message: 'Guardado.', issue: ++issues);
    }

    Future<EditReceipt> sendCover(String id, Uint8List jpeg) async {
      sent.add(LibraryRequest.resend({'op': 'cover', 'id': id}));
      return const EditReceipt(message: 'Guardado.');
    }

    PendingEditsController build() {
      final controller = PendingEditsController(
        fetchStatus: status.call,
        store: store,
        clock: () => now,
        timer: timers.call,
      );
      controller.currentCatalog = () =>
          (songs: catalog.songs, folders: catalog.folders, ok: true);
      controller.loadCatalog = () async =>
          (songs: catalog.songs, folders: catalog.folders, ok: catalogOk);
      addTearDown(controller.dispose);
      return controller;
    }

    final rename = LibraryRequest.editSong(
      songId: 'S0000000000000001',
      title: 'Uno nuevo',
      artist: 'Artista',
    );

    setUp(() {
      store = MemoryPendingEditsStore();
      timers = FakePollTimer();
      status = FakeEditStatus();
      now = t0;
      catalog = catalogFrom(contract);
      catalogOk = true;
      sent = [];
      issues = 0;
      sendError = null;
    });

    test('al enviar queda pendiente, se ve al momento y se guarda', () async {
      final edits = build();
      expect(await edits.submit(rename, send), 'Guardado.');
      expect(sent, hasLength(1));
      final [edit] = edits.items;
      expect(edit.issue, 1);
      expect(edit.label, 'Uno nuevo');
      expect(edit.action, 'Detalles de la canción');
      expect(edit.pending, isTrue);
      final view = edits.apply(catalog.songs, catalog.folders);
      expect(view.songs.first.title, 'Uno nuevo');
      expect(view.songs.first.pendingEdit, isTrue);
      expect(
        catalog.songs.first.title,
        'Uno',
        reason: 'El catálogo real no cambia.',
      );
      final saved = jsonDecode(store.body!) as Map<String, dynamic>;
      expect(saved['version'], 1);
      expect((saved['items'] as List).single['payload'], rename.payload);
    });

    test(
      'tras cerrar y volver a abrir, sigue pendiente y se revisa enseguida',
      () async {
        await build().submit(rename, send);
        final reopened = build();
        await reopened.restore();
        expect(reopened.items.single.payload, rename.payload);
        expect(reopened.items.single.issue, 1);
        await pumpEventQueue();
        expect(status.fetches, 1, reason: 'Revisión inmediata al abrir.');
      },
    );

    test('un fichero dañado se lee como vacío', () async {
      store.body = '{roto';
      expect(await store.read(), isEmpty);
      store.body = jsonEncode({
        'version': 1,
        'items': [
          {'key': 'x'},
          3,
        ],
      });
      expect(await store.read(), isEmpty);
    });

    test('sin duplicados: una edición igual pendiente no se reenvía', () async {
      final edits = build();
      await edits.submit(rename, send);
      expect(
        await edits.submit(rename, send),
        'Ya está pendiente: «Uno nuevo».',
      );
      expect(sent, hasLength(1));
      expect(edits.items, hasLength(1));
    });

    test('un error al enviar no deja nada pendiente', () async {
      final edits = build();
      sendError = const AppException('Sin permiso.');
      await expectLater(
        edits.submit(rename, send),
        throwsA(isA<AppException>()),
      );
      expect(edits.items, isEmpty);
    });

    test(
      'una edición que cambia los mismos campos sustituye a la anterior',
      () async {
        final edits = build();
        await edits.submit(rename, send);
        await edits.submit(
          LibraryRequest.editSong(
            songId: 'S0000000000000001',
            title: 'Otro',
            artist: 'Artista',
          ),
          send,
        );
        expect(edits.items.single.label, 'Otro');
      },
    );

    test(
      'confirmada cuando el catálogo la refleja: se quita y se avisa',
      () async {
        final edits = build();
        final notices = [];
        edits.notices.listen(notices.add);
        await edits.submit(rename, send);
        catalog = catalogFrom(contract, {
          'canciones': {
            'S0000000000000001': {'title': 'Uno nuevo'},
          },
        });
        now = t0.add(const Duration(seconds: 20));
        timers.fire();
        await pumpEventQueue();
        expect(edits.items, isEmpty);
        expect(notices.single.message, 'Ya está guardado: «Uno nuevo».');
        expect(notices.single.failed, isFalse);
        expect(
          timers.active,
          isEmpty,
          reason: 'Sin pendientes no se revisa más.',
        );
      },
    );

    test(
      'error del servidor: deja de verse, se avisa y se puede reintentar',
      () async {
        final edits = build();
        final notices = [];
        edits.notices.listen(notices.add);
        await edits.submit(rename, send);
        status.states[1] = 'error';
        await edits.check();
        await pumpEventQueue();
        final failed = edits.items.single;
        expect(failed.failed, isTrue);
        expect(
          notices.single.message,
          'No se ha podido guardar «Uno nuevo». Inténtalo de nuevo.',
        );
        expect(notices.single.failed, isTrue);
        expect(
          edits.apply(catalog.songs, catalog.folders).songs.first.title,
          'Uno',
        );
        // Reintentar: la misma operación, incidencia nueva, otra vez pendiente.
        expect(
          await edits.retry(failed.key, sendEdit: send, sendCover: sendCover),
          'Guardado.',
        );
        expect(sent.map((r) => r.payload), [rename.payload, rename.payload]);
        final retried = edits.items.single;
        expect(retried.pending, isTrue);
        expect(retried.issue, 2);
        expect(
          edits.apply(catalog.songs, catalog.folders).songs.first.title,
          'Uno nuevo',
        );
        // Descartar la quita.
        status.states[2] = 'error';
        await edits.check();
        await edits.discard(edits.items.single.key);
        expect(edits.items, isEmpty);
        expect(jsonDecode(store.body!)['items'], isEmpty);
      },
    );

    test('volver a pedir una fallida igual la sustituye', () async {
      final edits = build();
      await edits.submit(rename, send);
      status.states[1] = 'error';
      await edits.check();
      await edits.submit(rename, send);
      expect(edits.items.single.pending, isTrue);
    });

    test(
      'sin conexión nunca caduca; con conexión, a los 30 minutos falla',
      () async {
        final edits = build();
        await edits.submit(rename, send);
        status.error = Exception('sin red');
        catalogOk = false;
        now = t0.add(const Duration(hours: 5));
        await edits.check();
        expect(edits.items.single.pending, isTrue);
        catalogOk = true;
        await edits.check();
        expect(edits.items.single.failed, isTrue);
      },
    );

    test(
      'esperas crecientes entre revisiones y vuelta a 20 s con cada envío',
      () async {
        final edits = build();
        await edits.submit(rename, send);
        final delays = <int>[timers.active.single.period.inSeconds];
        for (var i = 0; i < 8; i++) {
          timers.fire();
          await pumpEventQueue();
          delays.add(timers.active.single.period.inSeconds);
        }
        expect(delays, [20, 30, 45, 60, 90, 120, 180, 180, 180]);
        await edits.submit(
          LibraryRequest.createAlbum(name: 'Valses', artist: ''),
          send,
        );
        expect(timers.active.single.period.inSeconds, 20);
      },
    );

    test(
      'portada: vista previa, sin duplicados y confirmada cuando aparece',
      () async {
        final edits = build();
        final jpeg = Uint8List.fromList([0xff, 0xd8, 1, 0xff, 0xd9]);
        const id = 'S0000000000000004';
        await edits.submitCover(id, jpeg, sendCover);
        expect(
          await edits.submitCover(id, jpeg, sendCover),
          'Ya está pendiente: «Cuatro».',
        );
        final edit = edits.items.single;
        expect(
          [edit.kind, edit.label, edit.action, edit.hadCover],
          ['cover', 'Cuatro', 'Portada nueva', false],
        );
        final view = edits.apply(catalog.songs, catalog.folders);
        expect(
          view.songs.firstWhere((s) => s.id == id).cover,
          'covers/$id.jpg',
        );
        expect(edits.previewFor('covers/$id.jpg'), isNotNull);
        final confirmed = <String>[];
        edits.onCoverConfirmed = confirmed.add;
        catalog = catalogFrom(contract, {
          'canciones': {
            id: {'cover': 'covers/$id.jpg'},
          },
        });
        await edits.check();
        expect(edits.items, isEmpty);
        expect(confirmed, ['covers/$id.jpg']);
        expect(edits.previewFor('covers/$id.jpg'), isNull);
      },
    );

    test(
      'portada por el Worker: guarda su fichero, se revisa a los 3 s y se confirma cuando el índice la refleja',
      () async {
        final edits = build();
        final jpeg = Uint8List.fromList([0xff, 0xd8, 2, 0xff, 0xd9]);
        const id = 'F0000000000000001';
        const key = 'portadas/$id-0123456789abcdef.jpg';
        await edits.submitCover(
          id,
          jpeg,
          (_, _) async => const EditReceipt(message: 'Hecho.', cover: key),
        );
        final edit = edits.items.single;
        expect([edit.hadCover, edit.coverKey], [true, key]);
        expect(timers.active.single.period, kEditCoverKeyCheck);
        expect(kEditCoverKeyCheck, const Duration(seconds: 3));
        // Se guarda con su fichero.
        final saved = await store.read();
        expect(saved.single.coverKey, key);
        // La vista previa también vale cuando el álbum ya apunta a un fichero del índice.
        expect(
          edits.previewFor('portadas/$id-1111111111111111.jpg'),
          isNotNull,
        );
        // A los 10 minutos no se supone nada: sigue pendiente.
        now = now.add(const Duration(minutes: 10));
        await edits.check();
        expect(edits.items, hasLength(1));
        final confirmed = <String>[];
        edits.onCoverConfirmed = confirmed.add;
        catalog = catalogFrom(contract, {
          'albumes': {
            id: {'cover': key},
          },
        });
        await edits.check();
        expect(edits.items, isEmpty);
        expect(confirmed, [key]);
      },
    );

    test('portada por el Worker: un fichero de otro id no se guarda', () async {
      final edits = build();
      await edits.submitCover(
        'F0000000000000001',
        Uint8List.fromList([0xff, 0xd8, 3, 0xff, 0xd9]),
        (_, _) async => const EditReceipt(
          message: 'Hecho.',
          cover: 'portadas/F0000000000000002-0123456789abcdef.jpg',
        ),
      );
      expect(edits.items.single.coverKey, isNull);
      expect(timers.active.single.period.inSeconds, 20);
    });

    test(
      'crear álbum: queda pendiente sin vista previa y se confirma con un álbum nuevo',
      () async {
        final edits = build();
        await edits.submit(
          LibraryRequest.createAlbum(name: 'Valses', artist: ''),
          send,
        );
        expect(edits.items.single.knownFolderIds, [
          'F0000000000000001',
          'F0000000000000002',
        ]);
        expect(
          edits.apply(catalog.songs, catalog.folders).folders,
          hasLength(2),
        );
        catalog = catalogFrom(contract, {
          'albumesNuevos': [
            {'id': 'F0000000000000003', 'name': 'Valses', 'parent_id': null},
          ],
        });
        await edits.check();
        expect(edits.items, isEmpty);
      },
    );

    test(
      'en segundo plano no se revisa (ahorro de batería) y al volver se retoma',
      () async {
        final edits = build();
        await edits.submit(rename, send);
        expect(timers.active, hasLength(1), reason: 'En primer plano revisa.');

        // La app pasa al fondo (pantalla apagada mientras suena música): se cancela la revisión.
        edits.setForeground(false);
        expect(edits.foreground, isFalse);
        expect(
          timers.active,
          isEmpty,
          reason: 'En segundo plano no gasta red ni batería revisando.',
        );

        // Aunque venza un temporizador anterior, no se programa otro mientras esté al fondo.
        timers.fire();
        await pumpEventQueue();
        expect(timers.active, isEmpty);
        expect(edits.items.single.pending, isTrue);

        // Al volver al primer plano se retoma la revisión enseguida.
        edits.setForeground(true);
        expect(edits.foreground, isTrue);
        expect(timers.active, hasLength(1));
        expect(
          timers.active.single.period,
          Duration.zero,
          reason: 'Al volver revisa de inmediato.',
        );
      },
    );

    test('la corrección se conserva: una edición caducada falla al volver', () async {
      final edits = build();
      await edits.submit(rename, send);
      edits.setForeground(false);
      // Pasan más de 30 min con la app al fondo (no se revisó nada en ese tiempo).
      now = t0.add(kEditMaxPending + const Duration(minutes: 5));
      edits.setForeground(true);
      await edits.check();
      expect(
        edits.items.single.failed,
        isTrue,
        reason: 'La antigüedad real desde createdAt se respeta pese a la pausa.',
      );
    });

    test('en segundo plano, un envío queda pendiente pero no programa revisión', () async {
      final edits = build();
      edits.setForeground(false);
      await edits.submit(rename, send);
      expect(edits.items.single.pending, isTrue);
      expect(timers.active, isEmpty);
    });
  });
}
