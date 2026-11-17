import 'dart:async';

import 'package:flutter/material.dart';

import '../music_recognition.dart';
import '../services.dart';

/// Hoja «Reconocer canción» (ADR-0048): botón central grande, animación de escucha y resultado con portada/título. No
/// bloquea: el micrófono solo se activa al pulsar y se cierra en cuanto termina o el usuario cancela.

Future<void> openRecognizeSheet(BuildContext context, AppServices services) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useRootNavigator: true,
    builder: (_) => _RecognizeSheet(services: services),
  );
}

class _RecognizeSheet extends StatefulWidget {
  const _RecognizeSheet({required this.services});
  final AppServices services;
  @override
  State<_RecognizeSheet> createState() => _RecognizeSheetState();
}

class _RecognizeSheetState extends State<_RecognizeSheet> {
  final MusicRecognizer _recognizer = MusicRecognizer();
  Completer<void>? _cancel;
  RecognitionProgress _progress = const RecognitionProgress(RecognitionStatus.idle, message: 'Pulsa para reconocer la canción que suena a tu alrededor.');

  @override
  void dispose() {
    _recognizer.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    if (_isBusy(_progress.status)) return;
    _cancel = Completer<void>();
    await _recognizer.recognize(
      cancel: _cancel!.future,
      onProgress: (p) {
        if (mounted) setState(() => _progress = p);
      },
    );
    _cancel = null;
  }

  void _stop() {
    final c = _cancel;
    if (c != null && !c.isCompleted) c.complete();
  }

  bool _isBusy(RecognitionStatus s) =>
      s == RecognitionStatus.requestingPermission ||
      s == RecognitionStatus.listening ||
      s == RecognitionStatus.analyzing ||
      s == RecognitionStatus.querying;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = _progress.status;
    final busy = _isBusy(status);

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text('Reconocer canción', style: theme.textTheme.titleLarge),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 220,
              child: Center(
                child: _ListenButton(busy: busy, status: status, onTap: busy ? _stop : _start),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              _progress.message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge,
            ),
            const SizedBox(height: 24),
            if (status == RecognitionStatus.matched) _MatchResult(progress: _progress, onOpen: () => _openSong()),
            if (status == RecognitionStatus.notMatched) _NotFoundHint(onRetry: _start),
            if (status == RecognitionStatus.error)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: FilledButton(onPressed: _start, child: const Text('Volver a intentar')),
              ),
          ],
        ),
      ),
    );
  }

  void _openSong() {
    final id = _progress.songId;
    if (id == null) return;
    Navigator.of(context).pop();
    // La integración con el reproductor (abrir la pista) la hace la pantalla que esté detrás de la hoja. Un snack rápido:
    final msg = _progress.title != null ? 'Abriendo «${_progress.title}»…' : 'Abriendo canción…';
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }
}

class _ListenButton extends StatelessWidget {
  const _ListenButton({required this.busy, required this.status, required this.onTap});
  final bool busy;
  final RecognitionStatus status;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final primary = theme.colorScheme.primary;
    return GestureDetector(
      onTap: onTap,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (busy) _Pulse(color: primary),
          Container(
            width: 148,
            height: 148,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: busy ? primary.withValues(alpha: 0.9) : primary,
              boxShadow: [
                BoxShadow(color: primary.withValues(alpha: 0.35), blurRadius: 24, spreadRadius: 2),
              ],
            ),
            child: Icon(
              busy ? Icons.stop_rounded : Icons.mic_rounded,
              size: 64,
              color: theme.colorScheme.onPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _Pulse extends StatefulWidget {
  const _Pulse({required this.color});
  final Color color;
  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1500))..repeat();
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, _) {
        final t = _c.value;
        return Stack(
          alignment: Alignment.center,
          children: List.generate(3, (i) {
            final phase = ((t + i / 3) % 1.0);
            final size = 148 + 120 * phase;
            final opacity = (1.0 - phase) * 0.35;
            return Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: widget.color.withValues(alpha: opacity), width: 2),
              ),
            );
          }),
        );
      },
    );
  }
}

class _MatchResult extends StatelessWidget {
  const _MatchResult({required this.progress, required this.onOpen});
  final RecognitionProgress progress;
  final VoidCallback onOpen;
  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(progress.title ?? '', style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
        if ((progress.artist ?? '').isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(progress.artist!, style: Theme.of(context).textTheme.bodyMedium, textAlign: TextAlign.center),
        ],
        const SizedBox(height: 16),
        FilledButton.icon(onPressed: onOpen, icon: const Icon(Icons.play_arrow_rounded), label: const Text('Abrir en Reminiscencia')),
      ],
    );
  }
}

class _NotFoundHint extends StatelessWidget {
  const _NotFoundHint({required this.onRetry});
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text(
            'No la tenemos en tu biblioteca. Si sabes el nombre y el artista, impórtala desde «Transferir música» o «Homeostasia».',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton(onPressed: onRetry, child: const Text('Volver a intentar')),
      ],
    );
  }
}
