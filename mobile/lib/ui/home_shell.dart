import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../layout.dart';
import '../pending_edits.dart';
import '../services.dart';
import '../theme.dart';
import '../playback.dart';
import '../upload_tracker.dart';
import '../youtube_embed.dart';
import 'youtube_results.dart';
import 'common.dart';
import 'home_page.dart';
import 'library_page.dart';
import 'pending_edits_panel.dart';
import 'player.dart';
import 'search_page.dart';
import 'youtube_embed_dock.dart';

/// Pestañas de la app. No hay perfiles, cuentas ni modos: la app abre siempre en Inicio.
enum AppTab { home, search, library }

/// Estructura con la de Spotify: cada pestaña tiene su propia pila de páginas, el minirreproductor
/// va encima de la barra inferior y las páginas de álbum o lista se abren sin taparlos.
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
  StreamSubscription<UploadNotice>? _notices;
  StreamSubscription<PendingEditNotice>? _editNotices;
  late final ValueListenable<NowPlaying> _nowPlaying;

  // La música y el vídeo incrustado no suenan a la vez.
  void _closeEmbedWhenMusicPlays() {
    if (_nowPlaying.value.playing) youtubeEmbed.close();
  }

  @override
  void initState() {
    super.initState();
    final library = widget.services.library;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      library.ensureLoaded();
      // Reanuda las descargas de YouTube que quedaron a medias si el sistema cerró la app (ADR-0039).
      youtubeDownloads.restore(widget.services);
    });
    // La biblioteca se sincroniza al volver a primer plano (si pasó un tiempo). Al salir de la app se para la
    // conversión y la comprobación de lo que se está publicando; al volver, se comprueba enseguida.
    final state = WidgetsBinding.instance.lifecycleState;
    final foreground = state == null || state == AppLifecycleState.resumed;
    library.uploads.setForeground(foreground);
    library.edits.setForeground(foreground);
    _lifecycle = AppLifecycleListener(
      onResume: () {
        library.resumeUploads();
        library.syncIfStale();
      },
      onPause: () => library.pauseImport(),
    );
    _nowPlaying = widget.services.playback.nowPlaying;
    _nowPlaying.addListener(_closeEmbedWhenMusicPlays);
    // Aviso en cualquier pestaña cuando se publica una subida.
    _notices = library.uploads.notices.listen(_showNotice);
    // Aviso cuando un cambio enviado llega a todos o no se ha podido guardar (ADR-0027).
    _editNotices = library.edits.notices.listen((notice) {
      if (mounted) showPendingEditNotice(context, widget.services, notice);
    });
  }

  void _showNotice(UploadNotice notice) {
    if (!mounted) return;
    final library = widget.services.library;
    final messenger = ScaffoldMessenger.of(context);
    // Un aviso cada vez: el nuevo sustituye al anterior (sin apilar ni duplicar). Se puede descartar deslizando a un lado.
    messenger.clearSnackBars();
    messenger.showSnackBar(
      SnackBar(
        content: Text(notice.message),
        dismissDirection: DismissDirection.horizontal,
        action: SnackBarAction(
          label: 'Reproducir',
          onPressed: () => runWithNotice(
            context,
            () => library.playUpload(notice.key),
            failurePrefix: 'No se pudo reproducir',
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _notices?.cancel();
    _editNotices?.cancel();
    _nowPlaying.removeListener(_closeEmbedWhenMusicPlays);
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
                        const YoutubeEmbedDock(),
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
                const YoutubeEmbedDock(),
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
