# ADR-0035: Pantalla de apertura propia de la APK

- Estado: aceptada (rama `feature/estabilidad-apk`, 2026-11-10; pendiente de fusionar en main). Comprobada en el emulador (Android 15) en modo oscuro, modo claro y a 720 × 1280 / 320 dpi. **Sin probar en un teléfono real.**
- Fecha: 2026-11-10.
- Relacionadas: [ADR-0004](ADR-0004-app-android-flutter.md) (app Flutter), [ADR-0015](ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md) (colores de la app).

## Contexto

- La APK abría con una foto a pantalla completa que no tenía que ver con la app. En pantallas de otra proporción se recortaba o se estiraba.
- En Android 12 y posteriores el sistema dibuja su propia pantalla de apertura: un icono de 240 dp del que solo se ve un círculo de 160 dp, una imagen de marca opcional de 200 × 80 dp abajo y un color de fondo. Lo que no está pensado para esa caja se recorta.
- `NormalTheme` usaba `?android:colorBackground` de fondo, así que en modo claro se veía un fotograma blanco entre la apertura y la primera pantalla de Flutter.

## Decisión

- **Emblema propio**: un disco verde (`#1FDF64`) con su agujero y tres ondas abiertas, cada una más fina, más tenue y más girada que la anterior (el disco suena y su eco se aleja), sobre el fondo de la app, `#121212`. Debajo va «Reminiscencia» en Figtree ExtraBold (la fuente de la app, OFL), convertida a trazos.
- **Vectores, no imágenes**: `res/drawable/splash_mark.xml` (viewport 108; todo cabe en el círculo de radio 36 que deja ver Android 12+) y `res/drawable/splash_wordmark.xml` (caja de 200 × 80 dp). Se ven nítidos en cualquier densidad y no se deforman.
- **Los dos salen de un script**, `scripts/splash/generar_splash.py`, con una sola geometría. `--vista-previa DIR` deja además SVG y un HTML que simula la apertura en varios tamaños. Necesita fontTools solo para el nombre.
- **Android 12+** (`values-v31` y `values-night-v31`): `windowSplashScreenBackground`, `windowSplashScreenAnimatedIcon` y `windowSplashScreenBrandingImage` apuntan a esos dibujos.
- **Android 11 y anteriores** (`drawable/launch_background.xml` y `drawable-v21/`): la misma composición en una `layer-list`, con el color, el emblema de 240 dp centrado y el nombre a 60 dp del borde inferior.
- **Sin fotograma blanco**: `NormalTheme` usa `@color/splash_background` en los cuatro `styles.xml`.
- El icono del lanzador (`mipmap/ic_launcher`) no cambia.

## Consecuencias

- `backend/tests/test_splash.py` (12 pruebas) comprueba que los dibujos del repositorio son los que genera el script, que el emblema cabe en el círculo visible, que el nombre usa la caja de 200 × 80 dp y que ningún tema deja ver blanco. La prueba del nombre se omite si fontTools no está instalado.
- Para cambiar el diseño se edita el script y se vuelve a ejecutar; los XML no se tocan a mano.
- Capturas en el emulador: `fix-splash-oscuro.png`, `fix-splash-claro.png` y `fix-splash-720x1280.png` (fuera del repositorio).
