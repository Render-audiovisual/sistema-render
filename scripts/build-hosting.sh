#!/usr/bin/env bash
# Retired split-origin publisher. Render2 requires one origin and its Node API.
# Fail before reading configuration, installing or touching any build/user file.
set -euo pipefail
echo 'Publicación estática separada deshabilitada: Render2 necesita frontend y API del mismo origen.' >&2
echo 'Compilá el frontend y prepará una salida Node nueva con scripts/build-hostinger-output.mjs.' >&2
exit 1
