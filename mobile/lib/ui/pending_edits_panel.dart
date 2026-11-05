import 'package:flutter/material.dart';

import '../app_error.dart';
import '../pending_edits.dart';
import '../services.dart';
import '../theme.dart';

// Ediciones pendientes en la interfaz (ADR-0027): la marca «Pendiente» de filas y cabeceras, el botón de Tu biblioteca
// con la lista de cambios y el «Reintentar» de los que fallaron. Igual que la web.

/// Texto del botón de Tu biblioteca, o null si no hay nada que enseñar.
String? pendingEditsSummary(int pending, int failed) {
  if (failed > 0) {
    return failed == 1
        ? 'No se ha podido guardar 1 cambio'
        : 'No se ha podido guardar $failed cambios';
  }
  if (pending == 0) return null;
  return pending == 1 ? '1 cambio pendiente' : '$pending cambios pendientes';
}

/// Marca «Pendiente»: texto (no solo color) para lo que se ve con un cambio que aún no ha llegado a todos.
class PendingEditBadge extends StatelessWidget {
  const PendingEditBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final palette = paletteOf(context);
    return Semantics(
      label: 'Cambio pendiente de guardar',
      excludeSemantics: true,
      child: Container(
        key: const Key('pending-edit-badge'),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
        decoration: BoxDecoration(
          color: palette.inkMuted,
          borderRadius: BorderRadius.circular(2),
        ),
        child: Text(
          'Pendiente',
          style: TextStyle(
            color: palette.background,
            fontSize: 11,
            fontWeight: FontWeight.w700,
            height: 1.4,
          ),
        ),
      ),
    );
  }
}

/// Vuelve a enviar una edición fallida y avisa del resultado.
Future<void> retryPendingEdit(
  BuildContext context,
  AppServices services,
  String key,
) async {
  final messenger = ScaffoldMessenger.of(context);
  String text;
  try {
    text = await services.library.edits.retry(
      key,
      sendEdit: services.submitEdit,
      sendCover: services.submitCover,
    );
  } on AppException catch (error) {
    text = error.message;
  } catch (_) {
    text = 'No se pudo guardar. Inténtalo de nuevo.';
  }
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));
}

/// Botón de Tu biblioteca: «N cambios pendientes» o «No se ha podido guardar N cambios». Abre la lista.
class PendingEditsButton extends StatelessWidget {
  const PendingEditsButton({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    final edits = services.library.edits;
    return ListenableBuilder(
      listenable: edits,
      builder: (context, _) {
        final failed = edits.failedItems.length;
        final text = pendingEditsSummary(edits.pendingItems.length, failed);
        if (text == null) return const SizedBox.shrink();
        final palette = paletteOf(context);
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
          child: Semantics(
            liveRegion: true,
            child: OutlinedButton.icon(
              key: const Key('pending-edits-button'),
              onPressed: () => showPendingEditsSheet(context, services),
              icon: Icon(
                failed > 0 ? Icons.error_outline : Icons.schedule_rounded,
                color: failed > 0 ? palette.error : palette.inkMuted,
              ),
              label: Text(text),
            ),
          ),
        );
      },
    );
  }
}

/// Lista de cambios pendientes y fallidos, con «Reintentar» y «Descartar» en los fallidos.
Future<void> showPendingEditsSheet(BuildContext context, AppServices services) {
  return showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheetContext) =>
        _PendingEditsSheet(services: services, hostContext: context),
  );
}

class _PendingEditsSheet extends StatelessWidget {
  const _PendingEditsSheet({required this.services, required this.hostContext});

  final AppServices services;
  final BuildContext hostContext;

  @override
  Widget build(BuildContext context) {
    final edits = services.library.edits;
    final theme = Theme.of(context);
    final palette = paletteOf(context);
    return SafeArea(
      child: ListenableBuilder(
        listenable: edits,
        builder: (context, _) {
          final items = edits.items.reversed.toList();
          return ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(context).height * 0.8,
            ),
            child: ListView(
              key: const Key('pending-edits-sheet'),
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(0, 16, 0, 16),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
                  child: Semantics(
                    header: true,
                    child: Text(
                      'Cambios pendientes',
                      style: theme.textTheme.titleLarge,
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Text(
                    'Llegan a todos en un par de minutos. Mientras tanto se ven ya con la marca «Pendiente».',
                    style: theme.textTheme.bodySmall,
                  ),
                ),
                if (items.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('No hay cambios pendientes.'),
                  ),
                for (final edit in items)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
                    child: Row(
                      key: Key('pending-edit-${edit.key}'),
                      children: [
                        Icon(
                          edit.failed
                              ? Icons.error_outline
                              : Icons.schedule_rounded,
                          color: edit.failed ? palette.error : palette.inkMuted,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '«${edit.label}»',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.bodyLarge,
                              ),
                              Text(
                                '${edit.action} · ${edit.failed ? 'No se ha podido guardar' : 'Pendiente'}',
                                style: theme.textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                        if (edit.failed) ...[
                          TextButton(
                            onPressed: () => retryPendingEdit(
                              hostContext,
                              services,
                              edit.key,
                            ),
                            child: const Text('Reintentar'),
                          ),
                          TextButton(
                            onPressed: () => edits.discard(edit.key),
                            child: const Text('Descartar'),
                          ),
                        ],
                      ],
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// Aviso de una edición confirmada o fallida (en cualquier pestaña). Las fallidas llevan «Reintentar».
void showPendingEditNotice(
  BuildContext context,
  AppServices services,
  PendingEditNotice notice,
) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(notice.message),
      duration: notice.failed
          ? const Duration(seconds: 8)
          : const Duration(seconds: 4),
      action: notice.failed
          ? SnackBarAction(
              label: 'Reintentar',
              onPressed: () => retryPendingEdit(context, services, notice.key),
            )
          : null,
    ),
  );
}
