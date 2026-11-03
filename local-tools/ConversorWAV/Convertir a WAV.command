#!/bin/bash
# Doble clic para convertir una playlist de YouTube a WAV.
cd "$(dirname "$0")"
echo "=== Conversor de YouTube a WAV ==="
echo "(Úsalo con contenido tuyo o sobre el que tengas derechos)"
echo
read -p "Pega la URL de TU playlist de YouTube: " URL
read -p "Nombre de la carpeta de salida [WAVs Convertidos]: " CARP
CARP="${CARP:-WAVs Convertidos}"
echo
./.venv/bin/python convertir.py "$URL" "$CARP"
echo
echo "Hecho. Los WAV están en el Escritorio, carpeta: $CARP"
echo "Pulsa Enter para cerrar."
read
