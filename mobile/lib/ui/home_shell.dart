import 'package:flutter/material.dart';

import '../layout.dart';
import '../services.dart';
import '../theme.dart';
import 'home_page.dart';
import 'library_page.dart';
import 'player.dart';
import 'search_page.dart';

/// Pestañas de la app. No hay perfiles, cuentas ni modos: la app abre siempre en Inicio.
enum AppTab { home, search, library }

/// Estructura con la de Spotify: cada pestaña tiene su propia pila de páginas, el minirreproductor
/// va encima de la barra inferior y las páginas de carpeta o lista se abren sin taparlos.
/// A partir de 720 dp la barra inferior pasa a ser una navegación lateral.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.services});

  final AppServices services;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  AppTab _tab = AppTab.home;
  final Map<AppTab, GlobalKey<NavigatorState>> _navigators = {
    for (final tab in AppTab.values) tab: GlobalKey<NavigatorState>(),
  };
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.services.library.ensureLoaded();
    });
    // Sin temporizadores: la biblioteca se sincroniza al volver a primer plano (si pasó un tiempo)
    // y la conversión de archivos locales se para al salir de la app.
    _lifecycle = AppLifecycleListener(
      onResume: () => widget.services.library.syncIfStale(),
      onPause: () => widget.services.library.pauseImport(),
    );
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  void _select(int index) {
    final tab = AppTab.values[index];
    if (tab == _tab) {
      // Volver a tocar la pestaña activa vuelve a su página principal.
      _navigators[tab]!.currentState?.popUntil((route) => route.isFirst);
      return;
    }
    setState(() => _tab = tab);
  }

  Widget _root(BuildContext context, AppTab tab) {
    final services = widget.services;
    // Fondo opaco: durante las transiciones de página no se ve lo que hay debajo.
    return Material(
      color: paletteOf(context).background,
      child: switch (tab) {
        AppTab.home => HomePage(services: services),
        AppTab.search => SearchPage(services: services),
        AppTab.library => LibraryPage(services: services),
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = paletteOf(context);
    final tabs = IndexedStack(
      index: _tab.index,
      children: [
        for (final tab in AppTab.values)
          TickerMode(
            enabled: tab == _tab,
            child: ExcludeSemantics(
              excluding: tab != _tab,
              child: NavigatorPopHandler(
                enabled: tab == _tab,
                onPopWithResult: (_) =>
                    _navigators[tab]!.currentState?.maybePop(),
                child: Navigator(
                  key: _navigators[tab],
                  onGenerateRoute: (settings) => MaterialPageRoute<void>(
                    settings: settings,
                    builder: (context) => _root(context, tab),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
    final miniPlayer = MiniPlayer(services: widget.services);
    return LayoutBuilder(
      builder: (context, constraints) {
        if (isTabletWidth(constraints.maxWidth)) {
          return Scaffold(
            backgroundColor: palette.black,
            body: SafeArea(
              child: Row(
                children: [
                  NavigationRail(
                    selectedIndex: _tab.index,
                    labelType: NavigationRailLabelType.all,
                    minWidth: kTabletRailWidth,
                    onDestinationSelected: _select,
                    destinations: [
                      for (final tab in AppTab.values)
                        NavigationRailDestination(
                          icon: Icon(_meta(tab).icon),
                          selectedIcon: Icon(_meta(tab).selectedIcon),
                          label: Text(_meta(tab).label),
                        ),
                    ],
                  ),
                  Expanded(
                    child: Column(
                      children: [
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: ColoredBox(
                              color: palette.background,
                              child: tabs,
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                        miniPlayer,
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        }
        return Scaffold(
          backgroundColor: palette.background,
          body: tabs,
          bottomNavigationBar: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [palette.background, palette.black],
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                miniPlayer,
                NavigationBar(
                  selectedIndex: _tab.index,
                  onDestinationSelected: _select,
                  backgroundColor: Colors.transparent,
                  surfaceTintColor: Colors.transparent,
                  indicatorColor: Colors.transparent,
                  elevation: 0,
                  height: 64,
                  labelTextStyle: WidgetStateProperty.resolveWith(
                    (states) =>
                        Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: states.contains(WidgetState.selected)
                              ? palette.ink
                              : palette.inkMuted,
                        ),
                  ),
                  destinations: [
                    for (final tab in AppTab.values)
                      NavigationDestination(
                        icon: Icon(_meta(tab).icon, color: palette.inkMuted),
                        selectedIcon: Icon(
                          _meta(tab).selectedIcon,
                          color: palette.ink,
                        ),
                        label: _meta(tab).label,
                      ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  static ({String label, IconData icon, IconData selectedIcon}) _meta(
    AppTab tab,
  ) => switch (tab) {
    AppTab.home => (
      label: 'Inicio',
      icon: Icons.home_outlined,
      selectedIcon: Icons.home_rounded,
    ),
    AppTab.search => (
      label: 'Buscar',
      icon: Icons.search_rounded,
      selectedIcon: Icons.manage_search_rounded,
    ),
    AppTab.library => (
      label: 'Tu biblioteca',
      icon: Icons.library_music_outlined,
      selectedIcon: Icons.library_music_rounded,
    ),
  };
}
