import 'package:flutter/material.dart';

import 'auth_store.dart';
import 'ui/auth_prompt_screen.dart';

/// Envuelve [action] de forma que, si lanza [AuthRequiredException] (el Worker respondió
/// 401 porque la contraseña faltaba o no coincidía), abre [AuthPromptScreen] para que la
/// persona la pegue y reintenta [action] una vez.
///
/// Si la pantalla se cierra sin guardar (devuelve null/false) la excepción original sube y
/// la UI la trata como un fallo de envío normal.
Future<T> withAuthRetry<T>(
  BuildContext context,
  AuthStore store,
  Future<T> Function() action, {
  String? reason,
}) async {
  try {
    return await action();
  } on AuthRequiredException catch (error) {
    if (!context.mounted) rethrow;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => AuthPromptScreen(store: store, reason: reason ?? error.message),
        fullscreenDialog: true,
      ),
    );
    if (saved != true) rethrow;
    return action();
  }
}
