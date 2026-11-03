import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'services.dart';
import 'theme.dart';
import 'ui/home_shell.dart';

/// Añade la licencia de la tipografía Figtree (SIL OFL 1.1) a la página «Licencias».
void registerFontLicense() {
  LicenseRegistry.addLicense(() async* {
    final text = await rootBundle.loadString('assets/fonts/OFL-Figtree.txt');
    yield LicenseEntryWithLineBreaks(const ['Figtree'], text);
  });
}

/// Raíz de la app. Abre directamente en Inicio: no hay perfiles, cuentas ni modos.
/// Aplica los ajustes a todo el MaterialApp: tema (alto contraste, animaciones) y escala de texto.
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
          themeMode: ThemeMode.dark,
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
