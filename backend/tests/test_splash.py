"""Pantalla de apertura de la APK (ADR-0035): los dibujos del repositorio salen de scripts/splash/generar_splash.py y
el emblema cabe entero en el círculo que Android 12+ deja ver del icono."""

import importlib.util
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "mobile" / "android" / "app" / "src" / "main" / "res"
ANDROID = "{http://schemas.android.com/apk/res/android}"


def _generator():
    spec = importlib.util.spec_from_file_location("generar_splash", ROOT / "scripts" / "splash" / "generar_splash.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_mark_in_the_repo_is_the_generated_one():
    generator = _generator()
    assert (RES / "drawable" / "splash_mark.xml").read_text(encoding="utf-8") == generator.mark_vector()


def test_the_mark_fits_in_the_circle_android_shows():
    generator = _generator()
    assert generator.outermost_extent() <= generator.SAFE_RADIUS


def test_the_wordmark_in_the_repo_is_the_generated_one():
    pytest.importorskip("fontTools")
    generator = _generator()
    assert (RES / "drawable" / "splash_wordmark.xml").read_text(encoding="utf-8") == generator.wordmark_vector()


def test_the_wordmark_uses_the_android_branding_box():
    root = ET.parse(RES / "drawable" / "splash_wordmark.xml").getroot()
    assert (root.get(f"{ANDROID}width"), root.get(f"{ANDROID}height")) == ("200dp", "80dp")


@pytest.mark.parametrize("folder", ["values-v31", "values-night-v31"])
def test_android_12_splash_uses_the_new_drawings(folder):
    styles = ET.parse(RES / folder / "styles.xml").getroot()
    launch = {item.get("name"): item.text for item in styles.find("style[@name='LaunchTheme']")}
    assert launch["android:windowSplashScreenAnimatedIcon"] == "@drawable/splash_mark"
    assert launch["android:windowSplashScreenBrandingImage"] == "@drawable/splash_wordmark"
    assert launch["android:windowSplashScreenBackground"] == "@color/splash_background"


@pytest.mark.parametrize("folder", ["values", "values-night", "values-v31", "values-night-v31"])
def test_the_window_behind_flutter_is_never_white(folder):
    styles = ET.parse(RES / folder / "styles.xml").getroot()
    normal = {item.get("name"): item.text for item in styles.find("style[@name='NormalTheme']")}
    assert normal["android:windowBackground"] == "@color/splash_background"


@pytest.mark.parametrize("folder", ["drawable", "drawable-v21"])
def test_older_android_shows_the_same_composition(folder):
    layers = ET.parse(RES / folder / "launch_background.xml").getroot()
    drawables = [item.get(f"{ANDROID}drawable") for item in layers]
    assert drawables == ["@color/splash_background", "@drawable/splash_mark", "@drawable/splash_wordmark"]
