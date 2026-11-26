import 'package:flutter/material.dart';

import '../worker_catalog_client.dart';

/// Lista de los últimos cambios en el catálogo (ADR-0052). Se lee del Worker, que a su vez
/// lo lee de `history/latest.jsonl` en R2. El Worker rota el fichero cada 1000 eventos; este
/// pide los últimos 200.
class CatalogHistoryScreen extends StatefulWidget {
  const CatalogHistoryScreen({
    super.key,
    required this.client,
    this.limit = 200,
  });

  final WorkerCatalogClient client;
  final int limit;

  @override
  State<CatalogHistoryScreen> createState() => _CatalogHistoryScreenState();
}

class _CatalogHistoryScreenState extends State<CatalogHistoryScreen> {
  late Future<List<Map<String, Object?>>> _events;

  @override
  void initState() {
    super.initState();
    _events = widget.client.historial(limit: widget.limit);
  }

  void _reload() {
    setState(() {
      _events = widget.client.historial(limit: widget.limit);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Historial del catálogo'),
        actions: [
          IconButton(
            tooltip: 'Actualizar',
            icon: const Icon(Icons.refresh),
            onPressed: _reload,
          ),
        ],
      ),
      body: FutureBuilder<List<Map<String, Object?>>>(
        future: _events,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Padding(
              padding: const EdgeInsets.all(16),
              child: Text('No se pudo leer el historial: ${snapshot.error}'),
            );
          }
          final events = snapshot.data ?? const [];
          if (events.isEmpty) {
            return const Center(child: Text('No hay eventos todavía.'));
          }
          return ListView.separated(
            itemCount: events.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, index) => _EventTile(event: events[index]),
          );
        },
      ),
    );
  }
}

class _EventTile extends StatelessWidget {
  const _EventTile({required this.event});
  final Map<String, Object?> event;

  @override
  Widget build(BuildContext context) {
    final action =
        (event['action'] ?? event['kind'] ?? 'cambio').toString();
    final actor = (event['by'] ?? event['actor'] ?? '').toString();
    final ts = (event['ts'] ?? event['at'] ?? '').toString();
    final target = _describeTarget(event);
    final subtitleParts = <String>[
      if (actor.isNotEmpty) actor,
      if (ts.isNotEmpty) ts,
    ];
    return ListTile(
      title: Text('$action${target.isEmpty ? '' : ' · $target'}'),
      subtitle: Text(subtitleParts.join(' · ')),
      isThreeLine: subtitleParts.isNotEmpty,
    );
  }

  String _describeTarget(Map<String, Object?> event) {
    final params = event['params'];
    if (params is Map) {
      final id = params['id'] ?? params['song_id'] ?? params['folder_id'];
      if (id is String && id.isNotEmpty) return id;
    }
    final target = event['target'];
    if (target is String && target.isNotEmpty) return target;
    return '';
  }
}
