import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/image_downscale.dart';

void main() {
  group('image_downscale (ADR-0052)', () {
    testWidgets(
      'scaledPixelsFor multiplica dp por devicePixelRatio y al menos 1',
      (tester) async {
        late BuildContext captured;
        await tester.pumpWidget(
          MediaQuery(
            data: const MediaQueryData(devicePixelRatio: 3),
            child: Builder(
              builder: (context) {
                captured = context;
                return const SizedBox.shrink();
              },
            ),
          ),
        );
        expect(scaledPixelsFor(captured, 40), 120);
        expect(scaledPixelsFor(captured, 0), 1);
      },
    );

    testWidgets(
      'scaledImage devuelve null para null y envuelve con ResizeImage al tamaño físico',
      (tester) async {
        late BuildContext captured;
        await tester.pumpWidget(
          MediaQuery(
            data: const MediaQueryData(devicePixelRatio: 2),
            child: Builder(
              builder: (context) {
                captured = context;
                return const SizedBox.shrink();
              },
            ),
          ),
        );
        expect(scaledImage(captured, null, dp: 40), isNull);
        final provider = scaledImage(
          captured,
          const AssetImage('test.jpg'),
          dp: 40,
        );
        expect(provider, isA<ResizeImage>());
        final resized = provider! as ResizeImage;
        expect(resized.width, 80);
        expect(resized.height, 80);
      },
    );

    testWidgets(
      'prefersThumbnail solo cuando el tamaño físico cabe en 160 px',
      (tester) async {
        late BuildContext captured;
        await tester.pumpWidget(
          MediaQuery(
            data: const MediaQueryData(devicePixelRatio: 2),
            child: Builder(
              builder: (context) {
                captured = context;
                return const SizedBox.shrink();
              },
            ),
          ),
        );
        // 40 dp * 2 = 80 px <= 160, usa thumb.
        expect(prefersThumbnail(captured, 40), isTrue);
        // 100 dp * 2 = 200 px > 160, usa cover.
        expect(prefersThumbnail(captured, 100), isFalse);
      },
    );
  });
}
