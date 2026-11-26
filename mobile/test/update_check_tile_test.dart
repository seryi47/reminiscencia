import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_version.dart';
import 'package:reminiscencia/ui/settings_page.dart';
import 'package:reminiscencia/update_check.dart';

Future<void> _pumpTile(
  WidgetTester tester, {
  required Future<CheckUpdateResult> Function() checker,
  Future<void> Function(BuildContext, UpdateInfo)? onUpdateAvailable,
  Future<void> Function(BuildContext, String)? onUpToDate,
  void Function(BuildContext)? onError,
}) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: UpdateCheckTile(
        checker: checker,
        onUpdateAvailable: onUpdateAvailable,
        onUpToDate: onUpToDate,
        onError: onError,
      ),
    ),
  ));
}

void main() {
  testWidgets('muestra el texto «Buscar actualización» y la versión actual en el subtítulo', (tester) async {
    await _pumpTile(tester, checker: () async => const CheckUpdateResult.upToDate());
    expect(find.text('Buscar actualización'), findsOneWidget);
    expect(find.text('Versión actual: $kAppVersionName'), findsOneWidget);
  });

  testWidgets('al pulsar llama al checker e invoca onUpToDate si no hay versión nueva', (tester) async {
    var checked = 0;
    var upToDateCalls = 0;
    await _pumpTile(
      tester,
      checker: () async {
        checked++;
        return const CheckUpdateResult.upToDate();
      },
      onUpToDate: (_, _) async { upToDateCalls++; },
    );
    await tester.tap(find.byKey(const Key('settings-check-update')));
    await tester.pumpAndSettle();
    expect(checked, 1);
    expect(upToDateCalls, 1);
  });

  testWidgets('con versión nueva, invoca onUpdateAvailable con el UpdateInfo', (tester) async {
    UpdateInfo? captured;
    await _pumpTile(
      tester,
      checker: () async => CheckUpdateResult.available(
        const UpdateInfo(version: '9.9.9', url: 'https://x/universal.apk', notes: 'Novedades'),
      ),
      onUpdateAvailable: (_, info) async { captured = info; },
    );
    await tester.tap(find.byKey(const Key('settings-check-update')));
    await tester.pumpAndSettle();
    expect(captured, isNotNull);
    expect(captured!.version, '9.9.9');
  });

  testWidgets('con fallo de red, invoca onError', (tester) async {
    var errors = 0;
    await _pumpTile(
      tester,
      checker: () async => const CheckUpdateResult.failed(),
      onError: (_) { errors++; },
    );
    await tester.tap(find.byKey(const Key('settings-check-update')));
    await tester.pumpAndSettle();
    expect(errors, 1);
  });

  testWidgets('bloquea toques dobles mientras está en curso', (tester) async {
    var checked = 0;
    final completer = Future<CheckUpdateResult>.delayed(
      const Duration(milliseconds: 200),
      () => const CheckUpdateResult.upToDate(),
    );
    await _pumpTile(
      tester,
      checker: () { checked++; return completer; },
      onUpToDate: (_, _) async {},
    );
    await tester.tap(find.byKey(const Key('settings-check-update')));
    await tester.pump(); // muestra spinner
    await tester.tap(find.byKey(const Key('settings-check-update')), warnIfMissed: false);
    await tester.pump();
    await tester.pumpAndSettle();
    expect(checked, 1);
  });
}
