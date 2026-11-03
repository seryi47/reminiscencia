import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme.dart';
import 'common.dart';

/// Acceso rápido de Inicio: portada pequeña a la izquierda y el nombre en negrita.
class QuickTile extends StatelessWidget {
  const QuickTile({
    super.key,
    required this.seed,
    required this.title,
    required this.icon,
    required this.onTap,
    this.color,
    this.image,
  });

  final String seed;
  final String title;
  final IconData icon;
  final Color? color;
  final ImageProvider? image;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = paletteOf(context);
    return Semantics(
      button: true,
      label: title,
      excludeSemantics: true,
      child: PressableSurface(
        color: palette.elevated,
        borderRadius: BorderRadius.circular(4),
        onTap: onTap,
        child: SizedBox.expand(
          child: Row(
            children: [
              CoverArt(
                seed: seed,
                size: 56,
                icon: icon,
                color: color,
                radius: 0,
                image: image,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
              const SizedBox(width: 8),
            ],
          ),
        ),
      ),
    );
  }
}

/// Tarjeta de un estante horizontal: portada cuadrada, título y subtítulo.
class ShelfCard extends StatelessWidget {
  const ShelfCard({
    super.key,
    required this.seed,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
    this.color,
    this.semanticHint,
    this.image,
  });

  static const double width = 156;

  final String seed;
  final String title;
  final String subtitle;
  final IconData icon;
  final Color? color;
  final ImageProvider? image;
  final VoidCallback onTap;

  /// Qué pasa al tocarla, para los lectores de pantalla (por ejemplo «reproducir»).
  final String? semanticHint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      button: true,
      label: subtitle.isEmpty ? title : '$title, $subtitle',
      hint: semanticHint,
      excludeSemantics: true,
      child: SizedBox(
        width: width,
        child: PressableSurface(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CoverArt(
                  seed: seed,
                  size: width - 20,
                  icon: icon,
                  color: color,
                  radius: 6,
                  image: image,
                ),
                const SizedBox(height: 8),
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall,
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Estante: título y una fila horizontal de tarjetas.
class Shelf extends StatelessWidget {
  const Shelf({super.key, required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeading(title),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final child in children)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: child,
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Tile de color de «Explorar todo» en Buscar.
class BrowseTile extends StatelessWidget {
  const BrowseTile({
    super.key,
    required this.title,
    required this.color,
    required this.icon,
    required this.onTap,
  });

  final String title;
  final Color color;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: title,
      excludeSemantics: true,
      child: PressableSurface(
        color: color,
        onTap: onTap,
        child: SizedBox.expand(
          child: Stack(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 40, 12),
                child: Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(
                    context,
                  ).textTheme.titleMedium?.copyWith(color: Colors.white),
                ),
              ),
              Positioned(
                right: 8,
                bottom: 8,
                child: Icon(
                  icon,
                  size: 36,
                  color: Colors.white.withValues(alpha: 0.85),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Alto de un acceso rápido: 56 dp, o lo que pidan dos líneas de texto ampliado.
double quickTileExtent(BuildContext context) =>
    math.max(56, MediaQuery.textScalerOf(context).scale(14) * 1.25 * 2 + 12);

/// Alto de un tile de «Explorar todo»: 96 dp, o lo que pidan dos líneas de texto ampliado.
double browseTileExtent(BuildContext context) =>
    math.max(96, MediaQuery.textScalerOf(context).scale(16) * 1.25 * 2 + 32);
