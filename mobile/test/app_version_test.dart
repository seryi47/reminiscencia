// Sincroniza `mobile/pubspec.yaml` con `mobile/lib/app_version.dart::kAppVersionName`. Si uno de los dos se cambia
// y el otro se olvida (como paso 2026-11-24 con 1.4.22 y 2026-11-25 con 1.4.23 — el tag `android-v…` quedo
// bloqueado en CI y la release no se publico), este test lo caza EN LOCAL antes del push y nunca mas pasa
// desapercibido. Se ejecuta con `flutter test` dentro de `mobile/`.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:reminiscencia/app_version.dart';

void main() {
  test('app_version.dart::kAppVersionName coincide con la version de pubspec.yaml', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    final match = RegExp(r'^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$', multiLine: true).firstMatch(pubspec);
    expect(match, isNotNull,
        reason: 'pubspec.yaml debe declarar `version: X.Y.Z+B` en una sola linea.');
    final pubspecVersion = match!.group(1);
    expect(
      kAppVersionName,
      equals(pubspecVersion),
      reason: 'Sincronicen antes de pushear: '
          'pubspec.yaml -> $pubspecVersion / app_version.dart -> $kAppVersionName.'
          ' El workflow android.yml tambien lo valida antes de publicar la release.',
    );
  });
}
