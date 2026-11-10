import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Las reglas de copia de Android deben dejar fuera TODA la carpeta de canciones locales (audio y metadatos),
/// igual que la web (ADR-0012 y ADR-0013). Sin esto, la copia del sistema llevaría metadatos a la nube.
void main() {
  const xmlDir = 'android/app/src/main/res/xml';
  const exclusion = 'app_flutter/biblioteca-local/';

  test('la copia de Android anterior a la API 31 excluye biblioteca-local', () {
    final xml = File('$xmlDir/backup_rules.xml').readAsStringSync();
    expect(xml, contains('<full-backup-content>'));
    expect(xml, contains('<exclude domain="root" path="$exclusion" />'));
  });

  test(
    'la copia en la nube y el traspaso (API 31 y posteriores) excluyen biblioteca-local',
    () {
      final xml = File('$xmlDir/data_extraction_rules.xml').readAsStringSync();
      expect(xml, contains('<cloud-backup>'));
      expect(xml, contains('<device-transfer>'));
      final excludes = RegExp(
        '<exclude domain="root" path="$exclusion" />',
      ).allMatches(xml).length;
      expect(excludes, 2);
    },
  );

  test('las portadas propias de las listas tampoco salen del teléfono', () {
    const covers = 'app_flutter/listas-portadas/';
    final old = File('$xmlDir/backup_rules.xml').readAsStringSync();
    expect(old, contains('<exclude domain="root" path="$covers" />'));
    final xml = File('$xmlDir/data_extraction_rules.xml').readAsStringSync();
    expect(
      RegExp('<exclude domain="root" path="$covers" />').allMatches(xml).length,
      2,
    );
  });

  test('el registro de errores (lib/error_log.dart) no sale del teléfono', () {
    const log = '<exclude domain="file" path="registro/" />';
    final old = File('$xmlDir/backup_rules.xml').readAsStringSync();
    expect(old, contains(log));
    final xml = File('$xmlDir/data_extraction_rules.xml').readAsStringSync();
    expect(RegExp(log).allMatches(xml).length, 2);
  });

  test('el manifiesto apunta a las dos reglas', () {
    final manifest = File(
      'android/app/src/main/AndroidManifest.xml',
    ).readAsStringSync();
    expect(manifest, contains('android:fullBackupContent="@xml/backup_rules"'));
    expect(
      manifest,
      contains('android:dataExtractionRules="@xml/data_extraction_rules"'),
    );
  });
}
