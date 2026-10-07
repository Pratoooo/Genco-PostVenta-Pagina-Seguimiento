# Genco Siniestros — Seguimiento de pedidos

Página de seguimiento de pedidos de repuestos por siniestro de Grupo Genco.

- **Iniciar sesión** (`/`, `/login`): es lo primero que se ve. Se ingresa con **email y contraseña** y la página lleva a cada uno a su sección:
  - **Talleres** y **peritos** → `/mis-pedidos`: ven solo los pedidos que tienen asignados.
  - **Administradores** → `/admin`: cargan y actualizan pedidos, y gestionan las cuentas.
- **Registrarse**: talleres y peritos crean su cuenta con nombre y apellido, email y contraseña (los talleres, además, el nombre del taller). La cuenta queda **pendiente** hasta que un admin la aprueba.
- **¿Olvidaste tu contraseña?**: llega un mail con un enlace (vence en 1 hora y sirve una sola vez) para crear una nueva.
- **Consulta sin cuenta** (`/consulta`): el estado de un pedido con el número de siniestro y la patente.

## Cómo correrlo

Requiere Node.js 22.13 o superior (usa SQLite integrado, no hay que instalar base de datos).

```bash
npm ci
cp .env.example .env   # y completar (ver abajo)
npm start
```

La página queda en http://localhost:3000. En el primer arranque se crea la cuenta de administración con `ADMIN_EMAIL` / `ADMIN_PASSWORD`; en el primer ingreso la página obliga a cambiar esa contraseña.

## Mails con Gmail (avisos de estado y recuperación de contraseña)

1. Usar una cuenta de Gmail de la empresa (por ejemplo la de la oficina) y activarle la **verificación en 2 pasos**.
2. Entrar a https://myaccount.google.com/apppasswords, crear una contraseña de aplicación (nombre: "Genco Siniestros") y copiar las 16 letras.
3. Completar en `.env`:
   ```
   GMAIL_USUARIO=cuenta@gmail.com
   GMAIL_CLAVE_APP=abcd efgh ijkl mnop
   APP_URL=http://localhost:3000   # o la dirección pública cuando esté publicada
   ```
4. Probar el envío: `npm run probar-mail -- tu-email@ejemplo.com`
5. Reiniciar la página. Al arrancar muestra `✓ Gmail listo` o explica qué está mal.

Sin Gmail configurado, el contenido de los mails se muestra en la consola del servidor.

## Avisos por mail de cambios de estado

Cada vez que cambia el estado de un pedido (lo guarda un admin o llega una novedad de Sendbox), se manda un mail con el logo de Genco, el estado actual, los puntos de avance, las novedades y los envíos a

el **taller** y el **perito** asignados, al email de su cuenta (el sistema lo toma solo al elegirlos en el pedido). Cada uno puede dejar de recibir los avisos de un pedido desmarcando *Recibir por mail las novedades de este pedido* en "Mis pedidos" (viene marcado).

Para no mandar un mail por cada guardado, el aviso sale 1 minuto después del último cambio, con todas las novedades juntas (si se siguen haciendo cambios, a los 5 minutos como máximo). En la ficha del pedido, el recuadro *Avisos por mail* muestra a quién se avisa y cuándo salió el último aviso, y el botón *Enviar aviso ahora* lo manda sin esperar. No se manda a emails provisorios (`@genco.local`) ni de prueba (`@example.com`).

Para ver cómo queda el mail de un pedido sin mandarlo: `npm run vista-previa-aviso -- SIN-2002` (crea `data/vista-previa-aviso.html`). Agregando un email al final, además se lo manda a esa dirección para probar.

## Seguimiento automático de Sendbox

Sendbox no tiene API todavía: la página entra a su sistema web (sendboxbfg.com.ar) con la cuenta de Genco y lee el estado de cada guía en "Envios Consulta", como lo haría una persona, con un navegador invisible (Playwright).

1. Completar en `.env` `SENDBOX_USUARIO` y `SENDBOX_CLAVE` (cuenta de Genco en Sendbox).
2. Probar: `npm run probar-sendbox -- Z-0325-00000508` (no toca la base, solo muestra lo que lee).
3. Reiniciar la página: cada `SENDBOX_INTERVALO_MIN` minutos (30 por defecto) revisa los envíos de Sendbox con guía que no llegaron y actualiza los que cambiaron.

La guía se carga en el envío tal como figura en Sendbox (`Z-0325-00000507`). En el panel admin, arriba de los pedidos, se ve la última lectura, un botón *Actualizar ahora* y los avisos (guía anulada, devolución, guía no encontrada). En un servidor Linux, instalar el navegador con `npx playwright install --with-deps chromium`. Cuando Sendbox publique su API, se reemplaza solo `backend/expresos/sendbox.js`.

## Cuentas compartidas

Varias personas pueden usar la misma cuenta a la vez desde distintas computadoras (por ejemplo, los administradores de la oficina):

- Cada computadora tiene su propia sesión; ingresar en una no cierra la sesión de las otras.
- Si dos personas editan el mismo pedido o la misma cuenta al mismo tiempo, la segunda en guardar recibe un aviso y un botón para recargar, en lugar de pisar sin querer los cambios de la otra.
- Las listas se actualizan solas cada minuto y al volver a la pestaña.
- Si alguien cambia la contraseña de la cuenta, a los demás se les cierra la sesión y tienen que ingresar con la nueva.
- El bloqueo por contraseñas mal puestas es por cuenta y conexión, con margen (15 intentos en 15 minutos) para que los errores de tipeo de una persona no dejen afuera a toda la oficina.

## Seguridad (OWASP Top 10:2025)

| Riesgo | Qué hace la página |
|---|---|
| **A01 · Control de acceso** | Cada ruta de la API exige sesión y rol; talleres y peritos solo ven sus propios pedidos (se controla en el servidor, no solo en la pantalla). Los cambios solo se aceptan desde la propia página: se rechazan pedidos de otros sitios (`Origin` / `Sec-Fetch-Site`) y los que no vienen como JSON (CSRF). Cookie `SameSite=Lax`. Los accesos denegados quedan registrados. |
| **A02 · Configuración** | Cabeceras de seguridad: CSP estricta (sin scripts en línea ni de terceros), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP y HSTS con https. Sin `X-Powered-By`. Las respuestas de la API no se guardan en caché. Los secretos van en `.env` (fuera de git). |
| **A03 · Cadena de suministro** | Solo 3 librerías (express, nodemailer, playwright) con versiones fijas en `package-lock.json` (instalar con `npm ci`). `.npmrc` impide que las librerías ejecuten código al instalarse. Las fuentes se sirven desde la propia página (sin Google Fonts). Dependabot revisa actualizaciones cada semana; `npm run auditar` busca vulnerabilidades conocidas. |
| **A04 · Criptografía** | Contraseñas con scrypt (N=2^15, r=8, p=3, sal al azar); los hashes viejos se actualizan solos al ingresar. Sesiones firmadas con HMAC-SHA256 y comparación en tiempo constante. Cookie `__Host-` + `Secure` con https. Enlaces de recuperación al azar (guardados como hash, vencen en 1 hora, un solo uso). |
| **A05 · Inyección** | Todas las consultas SQL usan parámetros (los nombres de columna son fijos, nunca vienen de lo que escribe el usuario). Los textos se recortan y se les sacan caracteres de control. Todo lo que se muestra se escapa (en la página y en los mails), y la CSP bloquea cualquier script inyectado. |
| **A06 · Diseño inseguro** | Límites de intentos: login (por cuenta e IP), registro, recuperación de contraseña, consultas sin cuenta fallidas y un límite general por conexión. Las cuentas registradas quedan pendientes hasta que un admin las aprueba. La recuperación responde lo mismo exista o no la cuenta. Límite de tamaño en los datos enviados. |
| **A07 · Autenticación** | Contraseñas de al menos 8 caracteres, que no sean comunes ni contengan el email. Las cuentas creadas por un admin (y la cuenta inicial) deben cambiar la contraseña en el primer ingreso. Cambiar la contraseña cierra todas las demás sesiones de esa cuenta. Sesiones de 12 horas. |
| **A08 · Integridad** | Bloqueo optimista (`version`) para que dos personas no se pisen los cambios. Las migraciones de la base corren en transacción con control de claves foráneas. Sin scripts de terceros (CSP `script-src 'self'`). |
| **A09 · Registro y alertas** | `data/seguridad.log` (JSON, una línea por evento): ingresos, intentos fallidos, bloqueos, cambios de contraseña y de cuentas, accesos denegados, pedidos de otros sitios y errores. Nunca guarda contraseñas ni tokens. Los eventos graves mandan un mail a `ALERTAS_EMAIL` (máximo uno por hora por motivo). |
| **A10 · Errores** | Al usuario nunca le llegan detalles internos, solo un mensaje claro. Los errores inesperados quedan registrados; si el proceso falla de forma grave, se registra, avisa por mail y se cierra para que el administrador de procesos lo reinicie. Los mails tienen tiempo máximo de espera. |

### Antes de publicar la página

1. **HTTPS obligatorio**: publicarla detrás de un proxy con certificado (nginx + Let's Encrypt, Cloudflare, etc.) y poner `APP_URL=https://...` en `.env`. Eso activa la cookie segura, HSTS y `upgrade-insecure-requests`. Si el proxy no está en la misma máquina, configurar `TRUST_PROXY`.
2. **Contraseña del admin**: ingresar con la cuenta inicial y elegir una contraseña fuerte (la página lo exige). Si se usa una cuenta compartida, que la contraseña la sepan solo esas personas.
3. **`SESSION_SECRET`** al azar en `.env` (ver `.env.example`), o dejar que se genere en `data/session-secret`.
4. **Respaldos** diarios de la carpeta `data/` (base de datos y registro de seguridad), guardados fuera del servidor.
5. **Que se reinicie solo**: correrla con un administrador de procesos (pm2, un servicio de Windows o systemd) para que vuelva a arrancar si se cae o se reinicia la máquina.
6. **Instalar con `npm ci`** (respeta las versiones del `package-lock.json`). En Linux, para Sendbox: `npx playwright install --with-deps chromium`.
7. **Firewall**: abrir solo el puerto del proxy (443); el puerto de Node (3000) no tiene que quedar expuesto a internet.
8. En GitHub, activar las **alertas de Dependabot** (Settings → Code security) y revisar `npm run auditar` de vez en cuando.
9. Revisar `data/seguridad.log` si llega una alerta por mail.

## Estructura del código

```
backend/
  servidor.js         Punto de entrada (npm start)
  app.js              Arma Express: API en /api y el frontend como archivos estáticos
  config.js           Variables de entorno (.env)
  db/                 Conexión SQLite y migraciones del esquema (versionadas)
  lib/                Sesiones y contraseñas, seguridad (cabeceras, CSRF), registro de seguridad, mails,
                      errores, límites de intentos, validaciones
  modelos/            Reglas y consultas: pedidos, usuarios, recuperación de contraseña
  rutas/              Endpoints: público, auth, portal (mis pedidos), admin
  servicios/          Tareas automáticas: avisos por mail y lectura periódica de Sendbox
  expresos/           Conexión con cada expreso (sendbox.js)
  scripts/            probar-mail, probar-sendbox, vista-previa-aviso
frontend/
  *.html              Páginas: login, consulta, mis-pedidos, admin
  css/estilos.css
  img/                Logos de Genco y Stellantis
  fuentes/            Inter y Montserrat (licencia SIL OFL), servidas desde la propia página
  js/comun/           Llamadas a la API, utilidades de interfaz, sesión, tarjeta de seguimiento
  js/paginas/         Código de cada página (el panel admin dividido en pedidos, usuarios y componentes)
data/                 Base de datos y registro de seguridad (no se sube a git)
```

## Estados del pedido

1. **Pedido a fábrica / Stock disponible**
2. **Despacho**: parcial (falta enviar una parte) o completo
3. **Envíos**: cada uno con su N° de remito, expreso (Angeleri, Andreani o Sendbox), N° de guía, estado del viaje y entrega
4. **En camino / Recibido en parte / Recibido**

**Despacho parcial:** cuando hay solo una parte de las piezas, se manda esa parte (Envío 1, con su remito y su guía). Cuando llega lo que falta, en la ficha del pedido se agrega otro envío con su propio remito y número de guía ("+ Agregar envío con lo que falta") y el despacho pasa a *Completo*. El pedido figura como *Recibido* recién cuando llegaron todos los envíos.

Cada cambio que guarda el admin queda en el historial que ven el cliente, el taller y el perito (por ejemplo "Envío 2 · Remito 0001-00020045").
