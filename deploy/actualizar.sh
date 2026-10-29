#!/usr/bin/env bash
# Actualiza la página a la última versión de GitHub: hace un respaldo, baja el código, instala las
# librerías y reinicia. Se corre como root en el servidor:  bash /opt/genco/deploy/actualizar.sh
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
SERVICIO=genco-siniestros
[ "$(id -u)" = 0 ] || { echo "Correlo como root:  sudo bash $0"; exit 1; }

/usr/local/bin/genco-respaldar "$APP"
cd "$APP"
git pull --ff-only
npm ci --omit=dev --no-audit --no-fund
chown -R genco:genco "$APP/data"
systemctl restart "$SERVICIO"
sleep 3
if systemctl is-active --quiet "$SERVICIO"; then
  echo "Actualizada: $(git log -1 --format='%h %s')"
else
  journalctl -u "$SERVICIO" -n 40 --no-pager
  echo "La página no arrancó después de actualizar: revisá el error de arriba."
  exit 1
fi
