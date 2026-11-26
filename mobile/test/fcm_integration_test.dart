import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/fcm_integration.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Mínimo RemoteMessage con un mapa de data (es todo lo que mira el handler).
RemoteMessage _mkMessage(Map<String, String> data) {
  return RemoteMessage(data: data);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('fcmBackgroundHandler (ADR-0052)', () {
    setUp(() {
      SharedPreferences.setMockInitialValues(<String, Object>{});
    });

    test('data con type=catalog-updated guarda la versión en preferencias', () async {
      await fcmBackgroundHandler(_mkMessage({'type': 'catalog-updated', 'version': '42'}));
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt(kPendingCatalogVersionKey), 42);
    });

    test('no sobreescribe si la versión entrante es menor', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{kPendingCatalogVersionKey: 50});
      await fcmBackgroundHandler(_mkMessage({'type': 'catalog-updated', 'version': '42'}));
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt(kPendingCatalogVersionKey), 50);
    });

    test('actualiza si la versión entrante es mayor', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{kPendingCatalogVersionKey: 10});
      await fcmBackgroundHandler(_mkMessage({'type': 'catalog-updated', 'version': '42'}));
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt(kPendingCatalogVersionKey), 42);
    });

    test('type distinto se ignora', () async {
      await fcmBackgroundHandler(_mkMessage({'type': 'otro', 'version': '99'}));
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt(kPendingCatalogVersionKey), isNull);
    });

    test('version inválida se ignora sin crashear', () async {
      await fcmBackgroundHandler(_mkMessage({'type': 'catalog-updated', 'version': 'no-es-numero'}));
      await fcmBackgroundHandler(_mkMessage({'type': 'catalog-updated'}));
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt(kPendingCatalogVersionKey), isNull);
    });
  });

  group('FcmIntegration.applyPending (ADR-0052)', () {
    setUp(() {
      SharedPreferences.setMockInitialValues(<String, Object>{});
    });

    test('si no hay versión pendiente no hace nada', () async {
      var calls = 0;
      final fcm = FcmIntegration(onCatalogUpdate: () async => calls++);
      await fcm.applyPending();
      expect(calls, 0);
    });

    test('si hay versión pendiente dispara onCatalogUpdate y la limpia', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{kPendingCatalogVersionKey: 42});
      var calls = 0;
      final fcm = FcmIntegration(onCatalogUpdate: () async => calls++);
      await fcm.applyPending();
      expect(calls, 1);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt(kPendingCatalogVersionKey), isNull);
    });
  });
}
