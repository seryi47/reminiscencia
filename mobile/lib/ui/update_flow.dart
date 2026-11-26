import 'dart:async';

import 'package:flutter/material.dart';

import '../apk_installer.dart';
import '../app_version.dart';
import '../update_check.dart';

/// Diálogos de actualización reutilizables entre el arranque automático (`home_shell`) y el botón manual de Ajustes
/// (`settings_page`) — ADR-0047. La política de «no insistir dos veces por la misma versión» se decide fuera: estos
/// helpers siempre preguntan.

/// Muestra el diálogo «Hay una actualización» con los botones «Ahora no» / «Actualizar». Si el usuario acepta,
/// descarga el APK y lanza el instalador del sistema. Devuelve `true` si llegó a disparar la instalación, `false`
/// en cualquier otro caso (declinada, sin red, cancelada, etc.). Nunca lanza.
Future<bool> promptAndInstallUpdate(BuildContext context, UpdateInfo info) async {
  final update = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Hay una actualización'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Versión ${info.version} disponible. Tienes la $kAppVersionName.'),
          if (info.notes.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(info.notes, style: Theme.of(dialogContext).textTheme.bodySmall),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Ahora no'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: const Text('Actualizar'),
        ),
      ],
    ),
  );
  if (update != true) return false;
  if (!context.mounted) return false;
  return _downloadAndInstall(context, info);
}

/// Diálogo «estás al día» que se usa cuando el botón manual confirma que no hay nada que instalar.
Future<void> showNoUpdateDialog(BuildContext context, String version) async {
  await showDialog<void>(
    context: context,
    builder: (dc) => AlertDialog(
      title: const Text('Al día'),
      content: Text('Estás en la versión más reciente ($version).'),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dc).pop(),
          child: const Text('Cerrar'),
        ),
      ],
    ),
  );
}

/// Descarga el APK a la caché y lanza el instalador del sistema (ADR-0047). Muestra un diálogo de progreso
/// cancelable; si falta el permiso de «instalar fuentes desconocidas», ofrece ir a Ajustes antes.
Future<bool> _downloadAndInstall(BuildContext context, UpdateInfo info) async {
  bool canInstall = true;
  try { canInstall = await ApkInstaller.canRequestInstall(); } catch (_) { canInstall = true; }
  if (!canInstall) {
    if (!context.mounted) return false;
    final go = await showDialog<bool>(
      context: context,
      builder: (dc) => AlertDialog(
        title: const Text('Permiso para instalar'),
        content: const Text(
          'Android pide permiso para instalar la actualización. Ábrelo en Ajustes, activa «Permitir desde esta fuente» '
          'y vuelve a la app para seguir.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dc).pop(false), child: const Text('Ahora no')),
          FilledButton(onPressed: () => Navigator.of(dc).pop(true), child: const Text('Ir a Ajustes')),
        ],
      ),
    );
    if (go == true) {
      try { await ApkInstaller.openInstallPermissionSettings(); } catch (_) {}
    }
    return false;
  }

  final progress = ValueNotifier<double?>(0);
  bool cancelled = false;
  if (!context.mounted) return false;
  unawaited(showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (dc) => AlertDialog(
      title: const Text('Descargando actualización…'),
      content: ValueListenableBuilder<double?>(
        valueListenable: progress,
        builder: (_, value, _) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            LinearProgressIndicator(value: value),
            const SizedBox(height: 12),
            Text(value == null
                ? 'Bajando…'
                : 'Bajando ${(value * 100).clamp(0, 100).toStringAsFixed(0)} %'),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () { cancelled = true; Navigator.of(dc).pop(); },
          child: const Text('Cancelar'),
        ),
      ],
    ),
  ));

  final path = await downloadApk(info, onProgress: (received, total) {
    if (cancelled) return;
    progress.value = total > 0 ? received / total : null;
  });
  if (cancelled) return false;
  if (context.mounted && Navigator.of(context, rootNavigator: true).canPop()) {
    Navigator.of(context, rootNavigator: true).pop();
  }

  if (path == null) {
    if (context.mounted) {
      await showDialog<void>(
        context: context,
        builder: (dc) => AlertDialog(
          title: const Text('No se pudo bajar la actualización'),
          content: const Text('Comprueba la conexión y vuelve a intentarlo.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(dc).pop(), child: const Text('Ahora no')),
            FilledButton(
              onPressed: () {
                Navigator.of(dc).pop();
                unawaited(_downloadAndInstall(context, info));
              },
              child: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }
    return false;
  }
  try {
    await ApkInstaller.install(path);
    return true;
  } catch (_) {
    if (context.mounted) {
      await showDialog<void>(
        context: context,
        builder: (dc) => AlertDialog(
          title: const Text('No se pudo abrir el instalador'),
          content: const Text(
            'Android no ha dejado abrir el instalador. Prueba a comprobar en Ajustes → Apps → Reminiscencia que la '
            'opción «Instalar aplicaciones desconocidas» está activada, y vuelve a intentarlo.',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(dc).pop(), child: const Text('Cerrar')),
            FilledButton(
              onPressed: () async {
                Navigator.of(dc).pop();
                try { await ApkInstaller.openInstallPermissionSettings(); } catch (_) {}
              },
              child: const Text('Abrir Ajustes'),
            ),
          ],
        ),
      );
    }
    return false;
  }
}
