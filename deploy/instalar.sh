#!/usr/bin/env bash
# Instala el sistema de seguimiento de pedidos de Genco en un servidor Ubuntu (VPS).
# Se corre como root, con el código ya descargado en /opt/genco (ver deploy/LEEME.md):
#
#   bash /opt/genco/deploy/instalar.sh seguimiento.gencorepair.com.ar
#
# Deja: Node.js, la página corriendo como servicio (arranca sola y se reinicia si se corta), nginx con
# certificado HTTPS gratuito (Let's Encrypt), firewall y respaldo diario de la base. Se puede volver a
# correr las veces que haga falta: solo completa lo que falta.
set -euo pipefail

DOMINIO="${1:?Indicá el dominio. Ej: bash deploy/instalar.sh seguimiento.gencorepair.com.ar}"
APP="$(cd "$(dirname "$0")/.." && pwd)"
USUARIO=genco
SERVICIO=genco-siniestros

[ "$(id -u)" = 0 ] || { echo "Correlo como root:  sudo bash $0 $DOMINIO"; exit 1; }
paso() { echo; echo "== $*"; }

paso "1/8 Paquetes del sistema (Node.js, nginx, certificados, firewall)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git nginx certbot python3-certbot-nginx ufw sqlite3
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -q nodejs
fi
echo "Node.js $(node -v)"

paso "2/8 Usuario del sistema que corre la página (sin permisos de administrador)"
id "$USUARIO" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$USUARIO"

paso "3/8 Librerías (versiones fijas del package-lock.json)"
cd "$APP"
npm ci --omit=dev --no-audit --no-fund

paso "4/8 Configuración (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  secreto="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  sed -i \
    -e "s|^APP_URL=.*|APP_URL=https://$DOMINIO|" \
    -e "s|^HOST=.*|HOST=127.0.0.1|" \
    -e "s|^TRUST_PROXY=.*|TRUST_PROXY=loopback|" \
    -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$secreto|" \
    -e "s|^GENCO_DIRECCION=.*|GENCO_DIRECCION=Carril Rodríguez Peña, Godoy Cruz, Mendoza|" \
    -e "s|^GENCO_COORDENADAS=.*|GENCO_COORDENADAS=-32.9264973,-68.8320528|" \
    .env
  echo "Se creó $APP/.env con la dirección del sitio, la de Genco y una clave de sesiones al azar."
fi
chown root:"$USUARIO" .env
chmod 640 .env
if grep -qE '^(GMAIL_USUARIO|GMAIL_CLAVE_APP)=\s*$' .env || grep -qE '^ADMIN_PASSWORD=(cambiar-esta-clave)?\s*$' .env; then
  echo
  echo "Falta completar en la configuración:"
  echo "  - GMAIL_USUARIO y GMAIL_CLAVE_APP (el Gmail desde el que salen los avisos)"
  echo "  - ADMIN_EMAIL y ADMIN_PASSWORD (la cuenta de administración inicial)"
  echo "Abrila con:   nano $APP/.env"
  echo "Guardá con Ctrl+O, Enter y salí con Ctrl+X. Después volvé a correr:"
  echo "  bash $APP/deploy/instalar.sh $DOMINIO"
  exit 0
fi

paso "5/8 Permisos: el código es de solo lectura para la página; solo puede escribir en data/"
mkdir -p data
chown -R root:root "$APP"
chown -R "$USUARIO":"$USUARIO" "$APP/data"
chmod 750 "$APP/data"
chown root:"$USUARIO" .env
chmod 640 .env

paso "6/8 Servicio: la página arranca sola y se reinicia si se corta"
sed "s|/opt/genco|$APP|g" deploy/genco-siniestros.service > "/etc/systemd/system/$SERVICIO.service"
systemctl daemon-reload
systemctl enable "$SERVICIO" >/dev/null
systemctl restart "$SERVICIO"
sleep 3
if ! systemctl is-active --quiet "$SERVICIO"; then
  journalctl -u "$SERVICIO" -n 40 --no-pager
  echo "La página no arrancó: revisá el error de arriba."
  exit 1
fi
journalctl -u "$SERVICIO" -n 8 --no-pager -o cat

paso "7/8 nginx y certificado HTTPS"
sed "s|DOMINIO|$DOMINIO|g" deploy/nginx-genco.conf > "/etc/nginx/sites-available/$SERVICIO"
ln -sf "/etc/nginx/sites-available/$SERVICIO" "/etc/nginx/sites-enabled/$SERVICIO"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
if [ ! -d "/etc/letsencrypt/live/$DOMINIO" ]; then
  email_cert="$(grep '^GMAIL_USUARIO=' .env | cut -d= -f2 | tr -d '[:space:]')"
  if ! certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos -m "$email_cert" --redirect; then
    echo
    echo "No se pudo sacar el certificado HTTPS. Revisá que $DOMINIO apunte a la IP de este servidor"
    echo "(registro A en la Zona DNS de Ferozo) y volvé a correr el script."
    exit 1
  fi
fi

paso "8/8 Firewall y respaldo diario"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
install -m 755 deploy/respaldar.sh /usr/local/bin/genco-respaldar
echo "30 3 * * * root /usr/local/bin/genco-respaldar $APP" > /etc/cron.d/genco-respaldo
/usr/local/bin/genco-respaldar "$APP"

echo
echo "Listo: https://$DOMINIO"
echo "Respaldos diarios (3:30 h) en /var/backups/genco. Para actualizar: bash $APP/deploy/actualizar.sh"
