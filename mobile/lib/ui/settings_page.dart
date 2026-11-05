import 'package:flutter/material.dart';

import '../app_settings.dart';
import '../services.dart';
import '../settings_store.dart';
import '../theme.dart';
import 'common.dart';
import 'home_page.dart';

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
              ListTile(
                leading: const Icon(Icons.download_for_offline_outlined),
                title: const Text('Guardar para escuchar sin conexión'),
                subtitle: Text(
                  library.downloading
                      ? 'Guardando: ${library.progress}'
                      : library.offlineWanted
                      ? 'Activado: lo nuevo se guarda solo, también con datos móviles.'
                      : 'Descarga el catálogo en este teléfono.',
                ),
                enabled: !library.downloading && library.songs.isNotEmpty,
                onTap: () => downloadForOfflineFlow(context, services),
              ),
              const _SectionTitle('Acerca de'),
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
