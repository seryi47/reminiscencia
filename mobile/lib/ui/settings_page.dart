import 'package:flutter/material.dart';

import '../app_settings.dart';
import '../services.dart';
import '../settings_store.dart';
import 'common.dart';

/// Pantalla «Ajustes»: tamaño de texto, modo paciente, alto contraste y reducir animaciones.
/// Cada cambio se aplica a toda la app al momento.
class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    final controller = services.settings;
    return ListenableBuilder(
      listenable: controller,
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
            const _SectionTitle('Accesibilidad'),
            SwitchListTile(
              title: const Text('Modo paciente'),
              subtitle: const Text(
                'Botones grandes y la canción en primer plano. Oculta carpetas, favoritos y listas.',
              ),
              value: settings.patientMode,
              onChanged: (value) => _apply(
                context,
                controller,
                settings.copyWith(patientMode: value),
              ),
            ),
            SwitchListTile(
              title: const Text('Alto contraste'),
              subtitle: const Text('Fondo negro y letras blancas.'),
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
          ],
        );
      },
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
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(text, style: Theme.of(context).textTheme.titleMedium),
    );
  }
}
