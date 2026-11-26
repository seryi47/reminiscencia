import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../auth_store.dart';

/// Pantalla simple para pegar la contraseña del Worker (ADR-0052). Solo aparece la primera vez
/// o cuando el Worker responde 401 (porque la contraseña no estaba o se rotó). La contraseña
/// nunca se le pide al usuario «de memoria»: hay un botón para pegar desde el portapapeles
/// (se asume que la pegó Claude Code ahí al proveerla; también se puede escribir a mano si
/// se quiere).
class AuthPromptScreen extends StatefulWidget {
  const AuthPromptScreen({
    super.key,
    required this.store,
    this.reason,
  });

  final AuthStore store;

  /// Texto opcional debajo del título (p.ej. «Falta la contraseña para publicar»).
  final String? reason;

  @override
  State<AuthPromptScreen> createState() => _AuthPromptScreenState();
}

class _AuthPromptScreenState extends State<AuthPromptScreen> {
  final TextEditingController _controller = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _pasteFromClipboard() async {
    final data = await Clipboard.getData('text/plain');
    final text = (data?.text ?? '').trim();
    if (text.isEmpty) {
      setState(() => _error = 'El portapapeles está vacío.');
      return;
    }
    setState(() {
      _controller.text = text;
      _error = null;
    });
  }

  Future<void> _save() async {
    final text = _controller.text.trim();
    if (text.isEmpty) {
      setState(() => _error = 'Pega la contraseña o escríbela.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    await widget.store.write(text);
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final reason = widget.reason;
    return Scaffold(
      appBar: AppBar(title: const Text('Contraseña del Worker')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (reason != null) ...[
              Text(reason),
              const SizedBox(height: 12),
            ],
            const Text(
              'Pega la contraseña que te pasaron. Se guarda en el teléfono y no se verá más.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _controller,
              obscureText: true,
              autofocus: true,
              decoration: InputDecoration(
                labelText: 'Contraseña',
                errorText: _error,
                suffixIcon: IconButton(
                  tooltip: 'Pegar',
                  icon: const Icon(Icons.content_paste),
                  onPressed: _saving ? null : _pasteFromClipboard,
                ),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: Text(_saving ? 'Guardando…' : 'Guardar'),
            ),
          ],
        ),
      ),
    );
  }
}
