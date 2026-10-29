# Publicar la página en un servidor (VPS)

Resultado: **https://seguimiento.gencorepair.com.ar**, con HTTPS, que arranca sola, se reinicia sola si
se corta y se respalda todos los días. La página institucional (gencorepair.com.ar) sigue en Ferozo
como está; solo se agrega un subdominio que apunta al servidor.

> El hosting de Ferozo es para sitios PHP: no puede correr esta página (es una aplicación Node.js que
> queda funcionando todo el tiempo para mandar los avisos por mail). Por eso va en un servidor aparte.

## 1. Contratar el servidor

- **Ubuntu 24.04 LTS** (o 22.04), 1 vCPU, 1 a 2 GB de RAM y 20 GB de disco alcanzan.
- Por ejemplo, un *Cloud Server* de DonWeb (la misma empresa del hosting) u otro proveedor.
- Anotar la **IP pública** y la **clave de root**.
- Preguntar que tenga habilitada la **salida de mails (SMTP, puerto 465)**: algunos proveedores la
  bloquean al principio y sin eso no salen los avisos.

## 2. Apuntar el subdominio (en Ferozo)

Panel de Ferozo → **Dominios** → **gencorepair.com.ar** → **Zona DNS** → agregar un registro:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| A | `seguimiento` | la IP del servidor | el que venga por defecto |

No tocar los otros registros (MX, etc.): el sitio y los mails de la empresa siguen igual. El cambio
puede tardar de unos minutos a unas horas. Para comprobarlo, en cualquier compu:

```
nslookup seguimiento.gencorepair.com.ar
```

Tiene que responder con la IP del servidor.

## 3. Bajar el código al servidor

Conectarse al servidor (en Windows, desde PowerShell o la Terminal):

```
ssh root@IP_DEL_SERVIDOR
```

El repositorio de GitHub es privado: el servidor necesita una **clave de solo lectura** (*deploy key*).

```
apt-get update && apt-get install -y git
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

Copiar la línea que aparece en GitHub → el repositorio → **Settings** → **Deploy keys** → **Add deploy
key** (sin marcar *Allow write access*). Después:

```
git clone git@github.com:Pratoooo/Genco-PostVenta-Pagina-Seguimiento.git /opt/genco
```

## 4. Instalar

```
bash /opt/genco/deploy/instalar.sh seguimiento.gencorepair.com.ar
```

La primera vez se frena para completar la configuración:

```
nano /opt/genco/.env
```

- `GMAIL_USUARIO=avisos.genco@gmail.com` y `GMAIL_CLAVE_APP=` la contraseña de aplicación de Google
  (la misma que se usa hoy).
- `ADMIN_EMAIL=` el email de la cuenta de administración y `ADMIN_PASSWORD=` una contraseña provisoria
  (en el primer ingreso la página pide cambiarla).

La dirección del sitio, la de Genco y la clave de las sesiones ya quedan cargadas solas. Guardar con
**Ctrl+O**, **Enter** y salir con **Ctrl+X**. Volver a correr el mismo comando: al terminar muestra
`Listo: https://seguimiento.gencorepair.com.ar`.

Al correr el instalador se aceptan las condiciones de Let's Encrypt, que da el certificado HTTPS gratis.

## 5. El botón del sitio

El botón de gencorepair.com.ar tiene que llevar a **https://seguimiento.gencorepair.com.ar** (el inicio
de sesión). Para la consulta sin cuenta: **https://seguimiento.gencorepair.com.ar/consulta**.

## 6. Primer ingreso

Entrar con `ADMIN_EMAIL` y la contraseña provisoria, elegir una nueva y cargar los talleres y peritos
(con su dirección de entrega). La base del servidor arranca vacía: los pedidos de prueba de la compu no
se pasan.

## Día a día

| Para | Comando (en el servidor, como root) |
|---|---|
| Actualizar a la última versión | `bash /opt/genco/deploy/actualizar.sh` |
| Ver si está funcionando | `systemctl status genco-siniestros` |
| Ver los últimos mensajes y errores | `journalctl -u genco-siniestros -n 50` |
| Reiniciarla | `systemctl restart genco-siniestros` |
| Hacer un respaldo ahora | `genco-respaldar` |

- **Respaldos**: todos los días a las 3:30 en `/var/backups/genco` (se guardan 30 días). Conviene bajar
  una copia fuera del servidor de vez en cuando, desde la compu:
  `scp root@IP_DEL_SERVIDOR:/var/backups/genco/* .`
- **Registro de seguridad**: `/opt/genco/data/seguridad.log`.

## Si algo no anda

- **No sale el certificado HTTPS**: el registro A todavía no apunta al servidor (paso 2). Esperar y volver
  a correr el instalador.
- **No llegan los mails**: `journalctl -u genco-siniestros | grep -i gmail`. Si dice que no hay conexión
  con smtp.gmail.com, el proveedor está bloqueando la salida de mails: pedirle que la habilite.
- **La página no abre**: `systemctl status genco-siniestros` y `nginx -t`.
