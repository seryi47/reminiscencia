#!/bin/bash
# Doble clic para abrir el mini-conversor local (botón en el navegador).
cd "$(dirname "$0")"
echo "Abriendo el conversor local en el navegador…"
echo "(Para cerrarlo: cierra esta ventana o pulsa Ctrl+C)"
./.venv/bin/python servidor_local.py
