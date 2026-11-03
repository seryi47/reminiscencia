import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../app_error.dart';
import '../collections.dart';
import '../layout.dart';
import '../theme.dart';

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
              const SizedBox(height: 24),
              FilledButton(onPressed: action, child: Text(label)),
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
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        decoration: BoxDecoration(
          color: paletteOf(context).elevated,
          borderRadius: BorderRadius.circular(8),
        ),
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

/// Etiqueta «N canciones».
String songCountLabel(int count) =>
    count == 1 ? '1 canción' : '$count canciones';

/// Duración total en texto corto: «35 min» o «1 h 12 min».
String formatTotalDuration(double seconds) {
  final minutes = (seconds / 60).round();
  if (minutes < 60) return '$minutes min';
  return '${minutes ~/ 60} h ${minutes % 60} min';
}

/// Portada generada: las canciones no traen imagen, así que se pinta un degradado estable
/// a partir del identificador, con un icono encima. Es decorativa: no se anuncia.
class CoverArt extends StatelessWidget {
  const CoverArt({
    super.key,
    required this.seed,
    required this.size,
    this.icon = Icons.music_note_rounded,
    this.color,
    this.radius,
    this.circle = false,
  });

  final String seed;
  final double size;
  final IconData icon;

  /// Color base; si es null, se calcula a partir de [seed].
  final Color? color;
  final double? radius;
  final bool circle;

  @override
  Widget build(BuildContext context) {
    final base = color ?? coverColorFor(seed);
    final dark = Color.lerp(base, Colors.black, 0.55)!;
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: circle ? BoxShape.circle : BoxShape.rectangle,
          borderRadius: circle
              ? null
              : BorderRadius.circular(radius ?? (size >= 120 ? 8 : 4)),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [base, dark],
          ),
          boxShadow: size >= 120
              ? const [
                  BoxShadow(
                    color: Color(0x80000000),
                    blurRadius: 24,
                    offset: Offset(0, 8),
                  ),
                ]
              : null,
        ),
        child: Icon(icon, size: size * 0.42, color: Colors.white),
      ),
    );
  }
}

/// Superficie pulsable con el color de tarjeta y el de pulsado (#181818 y #282828).
class PressableSurface extends StatelessWidget {
  const PressableSurface({
    super.key,
    required this.child,
    required this.onTap,
    this.color,
    this.borderRadius = const BorderRadius.all(Radius.circular(8)),
  });

  final Widget child;
  final VoidCallback? onTap;
  final Color? color;
  final BorderRadius borderRadius;

  @override
  Widget build(BuildContext context) {
    final palette = paletteOf(context);
    final highContrast = palette.outline == Colors.white;
    return Material(
      color: color ?? palette.card,
      shape: RoundedRectangleBorder(
        borderRadius: borderRadius,
        side: highContrast
            ? BorderSide(color: palette.outline)
            : BorderSide.none,
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        highlightColor: palette.cardPressed,
        hoverColor: palette.cardPressed,
        splashColor: Colors.transparent,
        child: child,
      ),
    );
  }
}

/// Botón redondo verde de reproducir (o pausar) de las cabeceras de carpeta y lista.
class PlayCircleButton extends StatelessWidget {
  const PlayCircleButton({
    super.key,
    required this.playing,
    required this.label,
    required this.onPressed,
    this.size = 56,
  });

  final bool playing;

  /// Lo que se anuncia, por ejemplo «Reproducir «Jazz»».
  final String label;
  final VoidCallback? onPressed;
  final double size;

  @override
  Widget build(BuildContext context) {
    final palette = paletteOf(context);
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: Tooltip(
        message: label,
        child: SizedBox.square(
          dimension: size < kMinTouchTarget ? kMinTouchTarget : size,
          child: Material(
            color: palette.accent,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onPressed,
              child: Icon(
                playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
                color: palette.onAccent,
                size: size * 0.55,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Título de un estante o sección (por ejemplo «Tus listas»).
class SectionHeading extends StatelessWidget {
  const SectionHeading(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 12),
      child: Semantics(
        header: true,
        child: Text(text, style: Theme.of(context).textTheme.titleLarge),
      ),
    );
  }
}
