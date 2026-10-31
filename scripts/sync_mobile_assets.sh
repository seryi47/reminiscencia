#!/usr/bin/env bash
# Copia el audio de reproducción y el índice desde frontend/web a mobile/assets.
# Los assets se empaquetan en la APK. El audio no se versiona (ADR-0003).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/frontend/web"
DST="$ROOT/mobile/assets"

if [ ! -f "$SRC/data/songs.json" ]; then
  echo "Falta $SRC/data/songs.json. Ejecuta antes: python -m sonidos build-web" >&2
  exit 1
fi

mkdir -p "$DST/audio" "$DST/data"
rm -f "$DST/audio/"*.opus
cp "$SRC/audio/"*.opus "$DST/audio/"
cp "$SRC/data/songs.json" "$DST/data/songs.json"
echo "assets sincronizados: $(ls "$DST/audio" | wc -l | tr -d ' ') pistas"
