/// Integración con Firebase Cloud Messaging (ADR-0052): la APK se suscribe al topic `catalog-changes`
/// y, cuando el Worker avisa de una edición, dispara un refresh inmediato del catálogo.
///
/// Diseño sin coste:
///  - El Worker firma el JWT y manda el push directo a FCM (no usamos Cloudflare Queues ni R2 Event
///    Notifications — ambos requerirían plan Paid).
///  - La APK se suscribe al topic (no guardamos tokens por dispositivo en el servidor; Firebase se encarga
///    del broadcast). 0 coste operativo.
///  - Si Firebase no se puede inicializar (teléfono sin Google Play Services, p. ej. GrapheneOS), caemos
///    silenciosamente — el long-poll (`CatalogWatcher`) y el polling de `/api/catalogo/latest` siguen
///    siendo suficientes para la UX.
library;

import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Topic al que se suscribe la APK. Debe coincidir con el usado en `worker/src/fcm.js::CATALOG_TOPIC`.
const String kCatalogChangesTopic = 'catalog-changes';

/// Clave de SharedPreferences donde dejamos la última versión recibida por push mientras la APK estaba
/// en background. Al reabrir la app, si es mayor que la versión actual del catálogo, forzamos refresh.
const String kPendingCatalogVersionKey = 'reminiscencia.fcm.pendingCatalogVersion';

/// Handler que se ejecuta en un ISOLATE SEPARADO cuando el push llega con la app en background o cerrada.
/// Debe ser top-level (no un método de clase ni un closure) por restricción de Flutter.
@pragma('vm:entry-point')
Future<void> fcmBackgroundHandler(RemoteMessage message) async {
  try {
    // En background no tenemos acceso al LibraryController; dejamos marcada la versión en preferencias.
    // Al reabrir la app, `FcmIntegration.applyPending()` la lee y dispara el refresh.
    final data = message.data;
    if (data['type'] != 'catalog-updated') return;
    final version = int.tryParse('${data['version']}') ?? 0;
    if (version <= 0) return;
    final prefs = await SharedPreferences.getInstance();
    final previous = prefs.getInt(kPendingCatalogVersionKey) ?? 0;
    if (version > previous) await prefs.setInt(kPendingCatalogVersionKey, version);
  } catch (error, stack) {
    debugPrint('fcm background handler: $error\n$stack');
  }
}

/// Integra FCM en la vida de la app. Instancia una por app y llamas a [install] en el arranque.
///
/// [onCatalogUpdate] debe hacer un refresh del catálogo (p. ej. `libraryController.refresh()`).
class FcmIntegration {
  FcmIntegration({
    required Future<void> Function() onCatalogUpdate,
    this.messaging,
    // ignore: prefer_initializing_formals
  }) : _onCatalogUpdate = onCatalogUpdate;

  final Future<void> Function() _onCatalogUpdate;
  @visibleForTesting
  FirebaseMessaging? messaging;
  StreamSubscription<RemoteMessage>? _foregroundSub;
  StreamSubscription<RemoteMessage>? _openedSub;
  bool _installed = false;

  /// Inicializa Firebase y se suscribe al topic. Idempotente (puede llamarse varias veces sin efecto).
  Future<void> install() async {
    if (_installed) return;
    try {
      // Firebase.initializeApp debe haberse llamado antes (en main). Si no hay app registrada, lo hacemos aquí.
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
      messaging ??= FirebaseMessaging.instance;
      // Android 13+: pide permiso (sin bloqueo, si lo deniega seguimos; los push llegan igual pero la
      // notificación del sistema no se muestra — como aquí solo usamos `data` sin `notification`, no afecta).
      await messaging!.requestPermission(alert: true, badge: true, sound: true);
      // El "background message handler" debe registrarse antes que cualquier otra cosa.
      FirebaseMessaging.onBackgroundMessage(fcmBackgroundHandler);
      // Idempotente: Firebase deduplica suscripciones al mismo topic.
      await messaging!.subscribeToTopic(kCatalogChangesTopic);
      _foregroundSub = FirebaseMessaging.onMessage.listen(_handleMessage);
      _openedSub = FirebaseMessaging.onMessageOpenedApp.listen(_handleMessage);
      // Si la app se abrió desde un push (caso frío), procesa también el mensaje inicial.
      final initial = await messaging!.getInitialMessage();
      if (initial != null) unawaited(_handleMessage(initial));
      _installed = true;
      debugPrint('fcm: suscrito a $kCatalogChangesTopic');
    } catch (error, stack) {
      // Sin Play Services (GrapheneOS, emulador sin Google) o con red cortada: no abortamos el arranque.
      debugPrint('fcm: no se pudo inicializar ($error) — long-poll y polling siguen funcionando');
      debugPrint('$stack');
    }
  }

  /// Al abrir la app, si el background handler marcó una versión mayor que la actual, dispara refresh.
  /// Debe llamarse una vez tras el install, cuando ya haya `libraryController` disponible.
  Future<void> applyPending() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final pending = prefs.getInt(kPendingCatalogVersionKey) ?? 0;
      if (pending > 0) {
        await _onCatalogUpdate();
        await prefs.remove(kPendingCatalogVersionKey);
      }
    } catch (error) {
      debugPrint('fcm applyPending: $error');
    }
  }

  Future<void> _handleMessage(RemoteMessage message) async {
    final data = message.data;
    final type = data['type'];
    if (type != 'catalog-updated' && type != 'test') return;
    await _onCatalogUpdate();
  }

  Future<void> dispose() async {
    await _foregroundSub?.cancel();
    await _openedSub?.cancel();
    _foregroundSub = null;
    _openedSub = null;
    _installed = false;
  }
}
