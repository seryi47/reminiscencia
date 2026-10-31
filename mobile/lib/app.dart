import 'package:flutter/material.dart';

import 'services.dart';
import 'theme.dart';
import 'ui/home_shell.dart';

/// Raíz de la app. Aplica los ajustes a todo el MaterialApp: tema (alto contraste, animaciones)
/// y escala de texto con MediaQuery.textScaler.
class ReminiscenciaApp extends StatelessWidget {
  const ReminiscenciaApp({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: services.settings,
      builder: (context, _) {
        final settings = services.settings.value;
        return MaterialApp(
          title: 'Reminiscencia',
          debugShowCheckedModeBanner: false,
          theme: buildAppTheme(
            highContrast: settings.highContrast,
            reduceMotion: settings.reduceMotion,
          ),
          builder: (context, child) {
            final media = MediaQuery.of(context);
            return MediaQuery(
              data: media.copyWith(
                textScaler: TextScaler.linear(
                  media.textScaler.scale(1.0) * settings.textScale,
                ),
                disableAnimations:
                    media.disableAnimations || settings.reduceMotion,
              ),
              child: child ?? const SizedBox.shrink(),
            );
          },
          home: HomeShell(services: services),
        );
      },
    );
  }
}
