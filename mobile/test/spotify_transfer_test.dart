// Pruebas de la lógica de «Transferir música» en la APK (ADR-0044): espejo de las de la web. http simulado, sin red.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/duplicates.dart';
import 'package:reminiscencia/spotify_transfer.dart';

class _MemStore implements SpotifyStore {
  SpotifySession? _s;
  @override
  Future<SpotifySession?> read() async => _s;
  @override
  Future<void> write(SpotifySession s) async => _s = s;
  @override
  Future<void> clear() async => _s = null;
}

http.Response _json(Object data, [int status = 200]) =>
    http.Response(jsonEncode(data), status, headers: {'content-type': 'application/json'});

Map<String, dynamic> _candidate(String url, String title, double dur, [String source = 'official']) =>
    {'candidate': {'url': url, 'title': title, 'durationS': dur, 'source': source}};

Map<String, dynamic> _result(int index, String tier, String title, {Map<String, dynamic>? best}) => {
      'index': index, 'tier': tier,
      'track': {'title': title, 'artists': ['A'], 'durationMs': 200000},
      'best': best, 'alternatives': const [],
    };

void main() {
  final base = Uri.parse('https://reminiscencia.cometia.es');

  test('login devuelve url/verifier/state y completeLogin guarda la sesión', () async {
    final store = _MemStore();
    final client = MockClient((req) async {
      if (req.url.path == '/api/spotify/login') return _json({'url': 'https://accounts.spotify.com/authorize?x', 'verifier': 'V', 'state': 'S'});
      if (req.url.path == '/api/spotify/token') return _json({'accessToken': 'AT', 'refreshToken': 'RT', 'expiresAt': 999});
      return _json({}, 404);
    });
    final t = SpotifyTransfer(client: client, store: store, base: base);
    final login = await t.login();
    expect(login.verifier, 'V');
    expect(await t.isConnected(), isFalse);
    await t.completeLogin(code: 'C', verifier: 'V');
    expect(await t.isConnected(), isTrue);
    await t.disconnect();
    expect(await t.isConnected(), isFalse);
  });

  test('resolve acumula páginas en orden', () async {
    final store = _MemStore()..write(SpotifySession(accessToken: 'AT', refreshToken: 'RT', expiresAt: DateTime.now().millisecondsSinceEpoch + 3600000));
    final client = MockClient((req) async {
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      final offset = body['offset'] as int;
      if (offset == 0) {
        return _json({'album': {'id': 'spotify:playlist:P', 'name': 'Lista'}, 'total': 3, 'hasMore': true,
          'results': [_result(0, 'alta', 'Uno', best: _candidate('u0', 'Uno', 200))]});
      }
      return _json({'album': {'id': 'spotify:playlist:P', 'name': 'Lista'}, 'total': 3, 'hasMore': false,
        'results': [_result(1, 'media', 'Dos', best: _candidate('u1', 'Dos', 201)), _result(2, 'baja', 'Tres')]});
    });
    final t = SpotifyTransfer(client: client, store: store, base: base, pageLimit: 1);
    final out = await t.resolve('https://open.spotify.com/playlist/P');
    expect(out.results.map((r) => r.index), [0, 1, 2]);
    expect(out.album?.id, 'spotify:playlist:P');
    expect(out.total, 3);
    expect(out.results[0].tier, 'alta');
  });

  test('resolve refresca el token si caduca a mitad', () async {
    final store = _MemStore()..write(SpotifySession(accessToken: 'OLD', refreshToken: 'RT', expiresAt: DateTime.now().millisecondsSinceEpoch + 3600000));
    var threw = false;
    final client = MockClient((req) async {
      if (req.url.path == '/api/spotify/refresh') return _json({'accessToken': 'NEW', 'expiresAt': DateTime.now().millisecondsSinceEpoch + 3600000});
      if (req.url.path == '/api/spotify/resolve') {
        final body = jsonDecode(req.body) as Map<String, dynamic>;
        if (body['accessToken'] == 'OLD' && !threw) { threw = true; return _json({'error': 'caducado', 'needsAuth': true}, 401); }
        return _json({'total': 1, 'hasMore': false, 'results': [_result(0, 'alta', 'Uno', best: _candidate('u0', 'Uno', 200))]});
      }
      return _json({}, 404);
    });
    final t = SpotifyTransfer(client: client, store: store, base: base);
    final out = await t.resolve('u');
    expect(out.results.length, 1);
    expect((await store.read())!.accessToken, 'NEW');
  });

  test('markTransferDuplicates y selectedTransferTracks', () {
    final results = [
      TransferMatch(index: 0, tier: 'alta', track: const SpotifyTrackMeta(title: 'Uno', artists: ['A'], durationMs: 200000), best: const TransferCandidate(url: 'u0', title: 'Uno', durationS: 200)),
      TransferMatch(index: 1, tier: 'media', track: const SpotifyTrackMeta(title: 'Dos', artists: ['A'], durationMs: 201000), best: const TransferCandidate(url: 'u1', title: 'Dos', durationS: 201)),
      TransferMatch(index: 2, tier: 'baja', track: const SpotifyTrackMeta(title: 'Tres', artists: ['A'], durationMs: 202000)),
      TransferMatch(index: 3, tier: 'alta', track: const SpotifyTrackMeta(title: 'YaEstá', artists: ['A'], durationMs: 203000), best: const TransferCandidate(url: 'u3', title: 'YaEstá', durationS: 203)),
    ];
    final album = const TransferAlbum(id: 'spotify:playlist:P', name: 'Lista');
    markTransferDuplicates(results, [const DuplicateCandidate(title: 'YaEstá', artist: 'A', durationS: 203)]);
    expect(results[3].inLibrary, isTrue);

    // Alta entra sola; media sin override fuera; baja fuera; YaEstá (biblioteca) fuera.
    expect(selectedTransferTracks(results, album: album).map((t) => t.url), ['u0']);

    // Con override en la media y exclusión de la 0.
    results[0].excluded = true;
    results[1].override = const TransferCandidate(url: 'alt1', title: 'Dos alt', durationS: 201);
    final chosen = selectedTransferTracks(results, album: album);
    expect(chosen.map((t) => t.url), ['alt1']);
    expect(chosen.first.playlistId, 'spotify:playlist:P');
    expect(chosen.first.title, 'Dos');
  });
}
