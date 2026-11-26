import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/auth_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  test('read sin nada en SharedPreferences devuelve vacío', () async {
    final store = SharedPreferencesAuthStore();
    expect(await store.read(), '');
  });

  test('write guarda y read lo recupera; write con blancos lo recorta', () async {
    final store = SharedPreferencesAuthStore();
    await store.write('  secreto123  ');
    expect(await store.read(), 'secreto123');
  });

  test('write con cadena vacía borra la entrada', () async {
    final store = SharedPreferencesAuthStore();
    await store.write('algo');
    await store.write('   ');
    expect(await store.read(), '');
  });

  test('clear borra la contraseña', () async {
    final store = SharedPreferencesAuthStore();
    await store.write('algo');
    await store.clear();
    expect(await store.read(), '');
  });

  test('withAuth añade X-Actor siempre y X-Auth si hay contraseña', () async {
    final store = SharedPreferencesAuthStore();
    var headers = await store.withAuth({'Content-Type': 'application/json'});
    expect(headers['X-Actor'], 'apk');
    expect(headers.containsKey('X-Auth'), isFalse);
    expect(headers['Content-Type'], 'application/json');

    await store.write('secreto');
    headers = await store.withAuth();
    expect(headers['X-Actor'], 'apk');
    expect(headers['X-Auth'], 'secreto');
  });

  test('AuthRequiredException lleva el texto esperado', () {
    const error = AuthRequiredException('X');
    expect(error.toString(), 'X');
  });
}
