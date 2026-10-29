#!/usr/bin/env bash
# Respaldo de la base de datos y del registro de seguridad en /var/backups/genco (se guardan 30 días).
# Lo corre todos los días el cron que deja deploy/instalar.sh, y deploy/actualizar.sh antes de actualizar.
set -euo pipefail
APP="${1:-/opt/genco}"
DESTINO=/var/backups/genco
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"
fecha="$(date +%F-%H%M)"
if [ -f "$APP/data/genco.db" ]; then
  # .backup hace una copia consistente aunque la página esté funcionando.
  sqlite3 "$APP/data/genco.db" ".backup '$DESTINO/genco-$fecha.db'"
  gzip -f "$DESTINO/genco-$fecha.db"
fi
if [ -f "$APP/data/seguridad.log" ]; then
  gzip -c "$APP/data/seguridad.log" > "$DESTINO/seguridad-$fecha.log.gz"
fi
find "$DESTINO" -type f -mtime +30 -delete
echo "Respaldo guardado en $DESTINO ($fecha)"
