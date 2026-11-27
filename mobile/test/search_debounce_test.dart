import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/ui/search_page.dart' show kSearchDebounce;

void main() {
  test('kSearchDebounce es 100 ms (respuesta percibida sin re-renders por tecla)', () {
    expect(kSearchDebounce, const Duration(milliseconds: 100));
  });

  test('un Timer con kSearchDebounce colapsa varias pulsaciones en 1 ejecución', () async {
    int calls = 0;
    Timer? timer;
    void type() {
      timer?.cancel();
      timer = Timer(kSearchDebounce, () => calls += 1);
    }

    for (var i = 0; i < 6; i++) {
      type();
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    await Future<void>.delayed(kSearchDebounce + const Duration(milliseconds: 50));
    expect(calls, 1);
  });
}
