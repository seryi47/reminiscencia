import 'edit_remote.dart';
import 'library_requests.dart';
import 'worker_catalog_client.dart';

/// Adaptador de [LibraryRequest] (modelo antiguo del backend) al Worker (ADR-0052).
///
/// Intenta aplicar la petición al Worker con una o varias acciones del contrato nuevo
/// (`/api/catalogo/edit`). Si la petición no cuaja todavía con las acciones del Worker,
/// delega automáticamente al submitter antiguo (`/api/editar`). Esto permite ir retirando
/// workflows de GitHub pieza a pieza sin perder funcionalidad por el camino.
///
/// Las acciones soportadas HOY por el Worker (fixes críticos ADR-0052): `rename_song`,
/// `rename_folder` (con `artist` opcional), `move_song`, `move_folder`, `set_cover`,
/// `delete_song`, `delete_folder`, `create_folder` (con `artist` opcional), `set_year`,
/// `set_artist`, `set_tags`, `set_track_index`, `reorder_folder`, `set_song_fields` y
/// `unpublish_song`. Todas las operaciones del backend antiguo ya tienen equivalente nativo
/// en el Worker; el fallback a `/api/editar` queda sólo como salvavidas por si el Worker
/// no está disponible (401, error de red), ya que `/api/editar` responde 410 Gone.
class WorkerBackedEditSubmitter {
  WorkerBackedEditSubmitter({
    required this.worker,
    required this.fallback,
  });

  final WorkerCatalogClient worker;

  /// Submitter antiguo (`/api/editar`), al que se cae si el Worker no soporta la petición
  /// o si no hay AUTH_PASSWORD (401).
  final EditSubmitter fallback;

  /// Función con la firma de [EditSubmitter]: la deja usar `services.submitEdit`.
  Future<EditReceipt> submit(LibraryRequest request) async {
    final plan = _planWorkerActions(request);
    if (plan == null) return fallback(request);
    try {
      var ifMatch = await _currentVersion();
      for (final step in plan) {
        final result = await worker.edit(
          action: step.action,
          params: step.params,
          ifMatch: ifMatch,
        );
        ifMatch = result.version;
      }
      return const EditReceipt(message: kEditSavedText);
    } catch (error) {
      // Cualquier fallo contra el Worker (incluido AuthRequiredException) sube.
      // La UI lo captura y, si es auth, abre AuthPromptScreen y reintenta.
      rethrow;
    }
  }

  Future<int> _currentVersion() async {
    final latest = await worker.getLatest();
    if (latest == null) return 0;
    final version = latest.body['version'];
    return version is int ? version : 0;
  }

  /// Traduce la operación del backend antiguo a acciones del Worker. Devuelve null si
  /// la petición NO cabe en el modelo nuevo (y debe irse por el fallback).
  static List<_WorkerStep>? _planWorkerActions(LibraryRequest request) {
    final payload = request.payload;
    switch (payload['op']) {
      case 'edit_song':
        return _planEditSong(payload);
      case 'move_songs':
        return _planMoveSongs(payload);
      case 'order_album':
        return [
          _WorkerStep('reorder_folder', {
            'folder_id': payload['folder_id'],
            'order': payload['song_ids'],
          }),
        ];
      case 'create_folder':
        if (payload['name'] is! String) return null;
        return [
          _WorkerStep('create_folder', {
            'name': payload['name'],
            if (payload['artist'] is String &&
                (payload['artist'] as String).trim().isNotEmpty)
              'artist': payload['artist'],
            if (payload['parent_id'] is String)
              'parent_id': payload['parent_id'],
          }),
        ];
      case 'edit_folder':
        if (payload['name'] is! String) return null;
        return [
          _WorkerStep('rename_folder', {
            'folder_id': payload['folder_id'],
            'new_name': payload['name'],
            if (payload['artist'] is String) 'artist': payload['artist'],
          }),
        ];
      case 'delete_folder':
        return [
          _WorkerStep('delete_folder', {
            'folder_id': payload['folder_id'],
          }),
        ];
      case 'delete_song':
        if (payload['song_id'] is! String) return null;
        return [
          _WorkerStep('delete_song', {
            'song_id': payload['song_id'],
          }),
        ];
      case 'unpublish_song':
        if (payload['song_id'] is! String) return null;
        return [
          _WorkerStep('unpublish_song', {
            'song_id': payload['song_id'],
          }),
        ];
    }
    return null;
  }

  static List<_WorkerStep>? _planEditSong(Map<String, Object?> payload) {
    final songId = payload['song_id'];
    if (songId is! String) return null;
    final steps = <_WorkerStep>[];
    // Los campos de contenido van agrupados en `set_song_fields` (atómicos en un POST).
    final fields = <String, Object?>{};
    if (payload.containsKey('title')) fields['title'] = payload['title'];
    if (payload.containsKey('artist')) fields['artist'] = payload['artist'];
    if (payload.containsKey('year')) fields['year'] = payload['year'];
    if (payload.containsKey('tags')) fields['tags'] = payload['tags'];
    if (fields.isNotEmpty) {
      steps.add(
        _WorkerStep('set_song_fields', {
          'song_id': songId,
          'fields': fields,
        }),
      );
    }
    // Un cambio de álbum va aparte como `move_song` (puede ir con o sin cambio de campos).
    if (payload.containsKey('folder_id')) {
      steps.add(
        _WorkerStep('move_song', {
          'song_id': songId,
          'folder_id': payload['folder_id'],
        }),
      );
    }
    return steps.isEmpty ? null : steps;
  }

  static List<_WorkerStep>? _planMoveSongs(Map<String, Object?> payload) {
    final ids = payload['song_ids'];
    if (ids is! List || ids.isEmpty) return null;
    final target = payload['folder_id'];
    final steps = <_WorkerStep>[];
    for (final id in ids) {
      if (id is! String) return null;
      steps.add(
        _WorkerStep('move_song', {
          'song_id': id,
          'folder_id': target,
        }),
      );
    }
    return steps;
  }
}

class _WorkerStep {
  const _WorkerStep(this.action, this.params);
  final String action;
  final Map<String, Object?> params;
}
