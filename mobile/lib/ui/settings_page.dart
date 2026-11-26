import 'package:flutter/material.dart';

import '../app_settings.dart';
import '../app_version.dart';
import '../offline_downloads.dart';
import '../services.dart';
import '../settings_store.dart';
import '../theme.dart';
import '../update_check.dart';
import 'catalog_history_screen.dart';
import 'common.dart';
import 'home_page.dart';
import 'update_flow.dart';

/// Ajustes: texto, alto contraste, animaciones, estado de la biblioteca y licencias.
/// Son de este teléfono y para cualquiera que lo use: la app no tiene usuarios ni modos.
class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    final controller = services.settings;
    final library = services.library;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ajustes'),
        leading: IconButton(
          tooltip: 'Volver',
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
      ),
      body: ListenableBuilder(
        listenable: Listenable.merge([controller, library]),
        builder: (context, _) {
          final settings = controller.value;
          final theme = Theme.of(context);
          final loadError = controller.loadError;
          return ListView(
            padding: const EdgeInsets.only(bottom: 24),
            children: [
              if (loadError != null)
                InlineBanner(icon: Icons.error_outline, message: loadError),
              const _SectionTitle('Texto'),
              Slider(
                value: settings.textScale,
                min: AppSettings.minTextScale,
                max: AppSettings.maxTextScale,
                divisions: AppSettings.textScaleDivisions,
                label: '${(settings.textScale * 100).round()} %',
                semanticFormatterCallback: (value) =>
                    'Tamaño del texto: ${(value * 100).round()} %',
                activeColor: paletteOf(context).accent,
                thumbColor: paletteOf(context).accent,
                onChanged: (value) => _apply(
                  context,
                  controller,
                  settings.copyWith(textScale: value),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  'Así se verá el texto de la aplicación.',
                  style: theme.textTheme.bodyLarge,
                ),
              ),
              const _SectionTitle('Pantalla'),
              SwitchListTile(
                title: const Text('Alto contraste'),
                subtitle: const Text(
                  'Fondo negro puro, texto secundario más claro y bordes visibles.',
                ),
                value: settings.highContrast,
                onChanged: (value) => _apply(
                  context,
                  controller,
                  settings.copyWith(highContrast: value),
                ),
              ),
              SwitchListTile(
                title: const Text('Reducir animaciones'),
                subtitle: const Text(
                  'Sin transiciones ni movimientos en la interfaz.',
                ),
                value: settings.reduceMotion,
                onChanged: (value) => _apply(
                  context,
                  controller,
                  settings.copyWith(reduceMotion: value),
                ),
              ),
              const _SectionTitle('Biblioteca'),
              ListTile(
                leading: Icon(
                  library.online
                      ? Icons.cloud_done_outlined
                      : Icons.cloud_off_outlined,
                ),
                title: Text(library.status),
                subtitle: const Text(
                  'Se actualiza al abrir la app y al volver a ella.',
                ),
              ),
              ListTile(
                leading: const Icon(Icons.refresh_rounded),
                title: const Text('Actualizar biblioteca'),
                enabled: !library.loading,
                onTap: () => library.load(),
              ),
              // Solo el subtítulo escucha el progreso (ADR-0033). Mientras guarda, tocar la fila cancela.
              ValueListenableBuilder<OfflineProgress?>(
                valueListenable: library.offlineProgress,
                builder: (context, progress, _) => ListTile(
                  key: const Key('settings-offline'),
                  leading: Icon(
                    progress != null
                        ? Icons.close_rounded
                        : Icons.download_for_offline_outlined,
                  ),
                  title: Text(
                    progress != null
                        ? 'Cancelar la descarga'
                        : 'Guardar para escuchar sin conexión',
                  ),
                  subtitle: Text(
                    progress != null
                        ? progress.text
                        : library.offlineWanted
                        ? 'Activado: lo nuevo se guarda solo, también con datos móviles.'
                        : 'Descarga el catálogo en este teléfono.',
                  ),
                  enabled: progress != null || library.songs.isNotEmpty,
                  onTap: progress != null
                      ? () => cancelOfflineFlow(context, services)
                      : () => downloadForOfflineFlow(context, services),
                ),
              ),
              if (services.workerCatalog != null)
                ListTile(
                  leading: const Icon(Icons.history_rounded),
                  title: const Text('Historial de cambios'),
                  subtitle: const Text(
                    'Últimos cambios del catálogo (ADR-0052).',
                  ),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => CatalogHistoryScreen(
                        client: services.workerCatalog!,
                      ),
                    ),
                  ),
                ),
              const _SectionTitle('Acerca de'),
              const UpdateCheckTile(),
              ListTile(
                leading: const Icon(Icons.article_outlined),
                title: const Text('Licencias'),
                subtitle: const Text('Tipografía Figtree (OFL) y bibliotecas.'),
                onTap: () => showLicensePage(
                  context: context,
                  applicationName: 'Reminiscencia',
                  useRootNavigator: true,
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<bool> _apply(
    BuildContext context,
    SettingsController controller,
    AppSettings next,
  ) {
    return runWithNotice(
      context,
      () => controller.update(next),
      failurePrefix: 'No se pudo aplicar el ajuste',
    );
  }
}

/// Botón manual «Buscar actualización» en Ajustes (ADR-0047). Ignora la memoria «ya avisado» que guarda el chequeo
/// del arranque: aquí el usuario pulsa EXPLÍCITAMENTE, así que volvemos a preguntar aunque antes dijera «Ahora no».
/// Mientras espera a GitHub muestra un spinner en el propio tile (no bloquea la pantalla).
class UpdateCheckTile extends StatefulWidget {
  const UpdateCheckTile({super.key, this.checker, this.onUpdateAvailable, this.onUpToDate, this.onError});

  /// Para pruebas: permite inyectar un chequeo distinto al real.
  final Future<CheckUpdateResult> Function()? checker;
  /// Para pruebas: dispara el flujo de descarga/instalación (por defecto, [promptAndInstallUpdate]).
  final Future<void> Function(BuildContext context, UpdateInfo info)? onUpdateAvailable;
  /// Para pruebas: diálogo de «al día» (por defecto, [showNoUpdateDialog]).
  final Future<void> Function(BuildContext context, String version)? onUpToDate;
  /// Para pruebas: aviso de error (por defecto, un SnackBar).
  final void Function(BuildContext context)? onError;

  @override
  State<UpdateCheckTile> createState() => _UpdateCheckTileState();
}

class _UpdateCheckTileState extends State<UpdateCheckTile> {
  bool _loading = false;

  Future<void> _check() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final checker = widget.checker ?? checkForUpdateWithStatus;
      final result = await checker();
      if (!mounted) return;
      if (result.hasUpdate) {
        final handler = widget.onUpdateAvailable ?? promptAndInstallUpdate;
        await handler(context, result.info!);
        return;
      }
      if (result.upToDate) {
        final handler = widget.onUpToDate ?? showNoUpdateDialog;
        await handler(context, kAppVersionName);
        return;
      }
      // Error de red / HTTP.
      final onError = widget.onError;
      if (onError != null) {
        onError(context);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No se ha podido comprobar la actualización (sin conexión o GitHub no responde).'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      key: const Key('settings-check-update'),
      leading: _loading
          ? const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.system_update_outlined),
      title: const Text('Buscar actualización'),
      subtitle: Text('Versión actual: $kAppVersionName'),
      enabled: !_loading,
      onTap: _check,
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
      child: Semantics(
        header: true,
        child: Text(text, style: Theme.of(context).textTheme.titleMedium),
      ),
    );
  }
}
