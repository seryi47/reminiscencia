import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../app_error.dart';
import '../collections.dart';

/// Texto para el usuario de cualquier error de una acción (reproducción, descargas, listas).
String describeError(Object error) {
  if (error is AppException) return error.message;
  if (error is SocketException ||
      error is TimeoutException ||
      error is http.ClientException) {
    return 'sin conexión. Vuelve a intentarlo.';
  }
  if (error is HttpException) return error.message;
  return 'error inesperado ($error)';
}

/// Ejecuta una acción. Si falla, muestra el motivo en un aviso: ningún error queda en silencio.
/// Devuelve true si la acción terminó bien.
Future<bool> runWithNotice(
  BuildContext context,
  Future<void> Function() action, {
  required String failurePrefix,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    await action();
    return true;
  } catch (error) {
    messenger.showSnackBar(
      SnackBar(content: Text('$failurePrefix: ${describeError(error)}')),
    );
    return false;
  }
}

/// Mensaje a pantalla completa con icono y, si hace falta, un botón (por ejemplo «Reintentar»).
class MessagePanel extends StatelessWidget {
  const MessagePanel({
    super.key,
    required this.icon,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = actionLabel;
    final action = onAction;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ExcludeSemantics(
              child: Icon(
                icon,
                size: 48,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge,
            ),
            if (label != null && action != null) ...[
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: action,
                icon: const Icon(Icons.refresh),
                label: Text(label),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Franja con un aviso y, si hace falta, una acción. Se anuncia a los lectores de pantalla.
class InlineBanner extends StatelessWidget {
  const InlineBanner({
    super.key,
    required this.message,
    this.icon = Icons.info_outline,
    this.actionLabel,
    this.onAction,
  });

  final String message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = actionLabel;
    final action = onAction;
    return Semantics(
      liveRegion: true,
      child: ColoredBox(
        color: theme.colorScheme.surfaceContainerHighest,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
          child: Row(
            children: [
              Icon(icon, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(width: 12),
              Expanded(child: Text(message, style: theme.textTheme.bodyMedium)),
              if (label != null && action != null)
                TextButton(onPressed: action, child: Text(label)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Pide el nombre de una lista. Valida con las mismas reglas que el modelo.
/// Devuelve el nombre ya limpio, o null si se cancela.
Future<String?> showNameDialog(
  BuildContext context, {
  required String title,
  required String confirmLabel,
  String initial = '',
}) {
  return showDialog<String>(
    context: context,
    builder: (_) =>
        _NameDialog(title: title, confirmLabel: confirmLabel, initial: initial),
  );
}

/// Pide confirmación antes de una acción destructiva.
Future<bool> showConfirmDialog(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result ?? false;
}

/// Duración en m:ss.
String formatDuration(double seconds) {
  final total = seconds.round();
  return '${total ~/ 60}:${(total % 60).toString().padLeft(2, '0')}';
}

class _NameDialog extends StatefulWidget {
  const _NameDialog({
    required this.title,
    required this.confirmLabel,
    required this.initial,
  });

  final String title;
  final String confirmLabel;
  final String initial;

  @override
  State<_NameDialog> createState() => _NameDialogState();
}

class _NameDialogState extends State<_NameDialog> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.initial,
  );
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    try {
      final name = cleanPlaylistName(_controller.text);
      Navigator.of(context).pop(name);
    } on AppException catch (error) {
      setState(() => _error = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        controller: _controller,
        autofocus: true,
        maxLength: kMaxPlaylistNameLength,
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => _submit(),
        decoration: InputDecoration(labelText: 'Nombre', errorText: _error),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(onPressed: _submit, child: Text(widget.confirmLabel)),
      ],
    );
  }
}
