#!/usr/bin/env bash
# Genera una copia estática del frontend lista para subir a un hosting
# aparte del que corre la API (por ejemplo Hostinger), apuntando las
# llamadas a /api al backend real en Render. Deja el resultado en la
# raíz del repo: index.html, assets/, favicon.png, apple-touch-icon.png,
# .htaccess — listos para copiar tal cual al hosting.
#
# La API_URL se puede pisar: API_URL=https://otra-url ./scripts/build-hosting.sh
set -euo pipefail

API_URL="${API_URL:-https://sistema.rendercorrientes.com}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

echo "Compilando frontend con VITE_API_BASE=$API_URL ..."
cd "$FRONTEND_DIR"
npm install --no-audit --no-fund
VITE_API_BASE="$API_URL" npx vite build

echo "Copiando build a la raíz del proyecto ..."
rm -f "$ROOT_DIR/index.html" "$ROOT_DIR/favicon.png" "$ROOT_DIR/apple-touch-icon.png" "$ROOT_DIR/.htaccess"
rm -rf "$ROOT_DIR/assets"

cp "$FRONTEND_DIR/dist/index.html" "$ROOT_DIR/index.html"
cp -r "$FRONTEND_DIR/dist/assets" "$ROOT_DIR/assets"
[ -f "$FRONTEND_DIR/dist/favicon.png" ] && cp "$FRONTEND_DIR/dist/favicon.png" "$ROOT_DIR/favicon.png"
[ -f "$FRONTEND_DIR/dist/apple-touch-icon.png" ] && cp "$FRONTEND_DIR/dist/apple-touch-icon.png" "$ROOT_DIR/apple-touch-icon.png"
cp "$FRONTEND_DIR/dist/.htaccess" "$ROOT_DIR/.htaccess" 2>/dev/null || true

echo ""
echo "Listo. Subí estos archivos a la raíz del hosting:"
echo "  index.html"
echo "  assets/"
echo "  favicon.png"
echo "  apple-touch-icon.png"
echo "  .htaccess"
echo ""
echo "No subas node_modules/, backend/ ni el resto del repo — no hacen falta."
