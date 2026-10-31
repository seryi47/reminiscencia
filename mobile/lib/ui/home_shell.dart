import 'package:flutter/material.dart';

import '../layout.dart';
import '../services.dart';
import 'common.dart';
import 'favorites_page.dart';
import 'library_page.dart';
import 'player_views.dart';
import 'playlists_page.dart';
import 'settings_page.dart';

/// Secciones de la app. En modo paciente solo quedan Escuchar y Ajustes (Ajustes hace falta para desactivarlo).
enum AppSection { listen, favorites, lists, settings }

/// Estructura adaptativa. Ancho >= 720 dp: navegación lateral, lista y reproductor a la vez.
/// Teléfono: barra inferior con el mini reproductor. El contenido de cada sección es el mismo en ambos casos.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.services});

  final AppServices services;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  AppSection _section = AppSection.listen;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.services.library.ensureLoaded();
    });
  }

  /// Secciones visibles según el modo paciente.
  static List<AppSection> sectionsFor({required bool patient}) {
    if (patient) return const [AppSection.listen, AppSection.settings];
    return const [
      AppSection.listen,
      AppSection.favorites,
      AppSection.lists,
      AppSection.settings,
    ];
  }

  @override
  Widget build(BuildContext context) {
    final services = widget.services;
    return ListenableBuilder(
      listenable: Listenable.merge([services.settings, services.library]),
      builder: (context, _) {
        final patient = services.settings.value.patientMode;
        final sections = sectionsFor(patient: patient);
        final section = sections.contains(_section)
            ? _section
            : AppSection.listen;
        final selected = sections.indexOf(section);
        return LayoutBuilder(
          builder: (context, constraints) {
            final tablet = isTabletWidth(constraints.maxWidth);
            final content = _content(
              section,
              patient: patient,
              inlinePlayer: patient && !tablet,
            );
            void select(int index) =>
                setState(() => _section = sections[index]);
            final appBar = AppBar(
              title: Text(_titleOf(section)),
              actions: _actions(context, section, patient),
            );
            if (tablet) {
              return Scaffold(
                appBar: appBar,
                floatingActionButton: _fab(context, section),
                body: Row(
                  children: [
                    NavigationRail(
                      selectedIndex: selected,
                      labelType: NavigationRailLabelType.all,
                      onDestinationSelected: select,
                      destinations: [
                        for (final s in sections) _railDestination(s),
                      ],
                    ),
                    const VerticalDivider(width: 1),
                    Expanded(child: content),
                    const VerticalDivider(width: 1),
                    SizedBox(
                      width: kTabletPlayerWidth,
                      child: patient
                          ? Center(
                              child: SingleChildScrollView(
                                padding: const EdgeInsets.all(24),
                                child: PatientPlayer(
                                  playback: services.playback,
                                ),
                              ),
                            )
                          : PlayerPanel(playback: services.playback),
                    ),
                  ],
                ),
              );
            }
            return Scaffold(
              appBar: appBar,
              floatingActionButton: _fab(context, section),
              body: content,
              bottomNavigationBar: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (!patient) MiniPlayerBar(playback: services.playback),
                  NavigationBar(
                    selectedIndex: selected,
                    onDestinationSelected: select,
                    destinations: [
                      for (final s in sections) _barDestination(s),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _content(
    AppSection section, {
    required bool patient,
    required bool inlinePlayer,
  }) {
    final services = widget.services;
    return switch (section) {
      AppSection.listen => LibraryPage(
        services: services,
        patient: patient,
        inlinePlayer: inlinePlayer,
      ),
      AppSection.favorites => FavoritesPage(services: services),
      AppSection.lists => PlaylistsPage(services: services),
      AppSection.settings => SettingsPage(services: services),
    };
  }

  List<Widget> _actions(
    BuildContext context,
    AppSection section,
    bool patient,
  ) {
    if (section != AppSection.listen || patient) return const [];
    final library = widget.services.library;
    if (library.downloading) {
      return [
        Padding(
          padding: const EdgeInsets.only(right: 16),
          child: Text(library.progress),
        ),
      ];
    }
    return [
      IconButton(
        tooltip: 'Guardar para escuchar sin conexión',
        icon: const Icon(Icons.download_for_offline_outlined),
        onPressed: library.songs.isEmpty ? null : () => _download(context),
      ),
      IconButton(
        tooltip: 'Actualizar biblioteca',
        icon: const Icon(Icons.refresh),
        onPressed: library.loading ? null : () => library.load(),
      ),
    ];
  }

  Future<void> _download(BuildContext context) async {
    final library = widget.services.library;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final done = await library.downloadForOffline();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            done == 0
                ? 'Ya estaba todo guardado.'
                : 'Guardadas $done canciones para escuchar sin conexión.',
          ),
        ),
      );
    } catch (error) {
      messenger.showSnackBar(
        SnackBar(
          content: Text('No se pudo descargar: ${describeError(error)}'),
        ),
      );
    }
  }

  Widget? _fab(BuildContext context, AppSection section) {
    if (section != AppSection.lists) return null;
    final collections = widget.services.collections;
    return FloatingActionButton.extended(
      icon: const Icon(Icons.add),
      label: const Text('Nueva lista'),
      onPressed: () => createPlaylistFlow(context, collections),
    );
  }

  static String _titleOf(AppSection section) => switch (section) {
    AppSection.listen => 'Reminiscencia',
    AppSection.favorites => 'Favoritos',
    AppSection.lists => 'Listas',
    AppSection.settings => 'Ajustes',
  };

  static ({String label, IconData icon, IconData selectedIcon}) _meta(
    AppSection section,
  ) => switch (section) {
    AppSection.listen => (
      label: 'Escuchar',
      icon: Icons.library_music_outlined,
      selectedIcon: Icons.library_music,
    ),
    AppSection.favorites => (
      label: 'Favoritos',
      icon: Icons.favorite_border,
      selectedIcon: Icons.favorite,
    ),
    AppSection.lists => (
      label: 'Listas',
      icon: Icons.queue_music_outlined,
      selectedIcon: Icons.queue_music,
    ),
    AppSection.settings => (
      label: 'Ajustes',
      icon: Icons.settings_outlined,
      selectedIcon: Icons.settings,
    ),
  };

  static NavigationRailDestination _railDestination(AppSection section) {
    final meta = _meta(section);
    return NavigationRailDestination(
      icon: Icon(meta.icon),
      selectedIcon: Icon(meta.selectedIcon),
      label: Text(meta.label),
    );
  }

  static NavigationDestination _barDestination(AppSection section) {
    final meta = _meta(section);
    return NavigationDestination(
      icon: Icon(meta.icon),
      selectedIcon: Icon(meta.selectedIcon),
      label: meta.label,
    );
  }
}
