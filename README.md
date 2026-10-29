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

Cada vez que cambia el estado de un pedido (lo guarda un admin), se manda un mail con el logo de Genco, el estado actual, los puntos de avance, las novedades y los envíos a

el **taller** y el **perito** asignados, al email de su cuenta (el sistema lo toma solo al elegirlos en el pedido). Cada uno puede dejar de recibir los avisos de un pedido desmarcando *Recibir por mail las novedades de este pedido* en "Mis pedidos" (viene marcado).

Para no mandar un mail por cada guardado, el aviso sale 1 minuto después del último cambio, con todas las novedades juntas (si se siguen haciendo cambios, a los 5 minutos como máximo). En la ficha del pedido, el recuadro *Avisos por mail* muestra a quién se avisa y cuándo salió el último aviso, y el botón *Enviar aviso ahora* lo manda sin esperar. No se manda a emails provisorios (`@genco.local`) ni de prueba (`@example.com`).

**Si caen en Spam**: los mails desde Gmail a veces llegan a Spam o Correo no deseado. Por eso la página lo avisa donde hace falta: en *Revisá tu email* (después de pedir una contraseña nueva), arriba de la lista de *Mis pedidos* y junto a la casilla de avisos de cada pedido, y en el recuadro *Avisos por mail* de la ficha del pedido (para que el admin se lo diga al taller o al perito). Los mails también lo explican al final: marcarlo como «No es spam» y agregar la dirección a los contactos, así los próximos llegan a la bandeja de entrada.

Para ver cómo queda el mail de un pedido sin mandarlo: `npm run vista-previa-aviso -- SIN-2002` (crea `data/vista-previa-aviso.html`). Agregando un email al final, además se lo manda a esa dirección para probar.

## Reseña de pedidos

La lista de pedidos del panel (y la de "Mis pedidos" para talleres y peritos) es una reseña con:

- **Números por estado**: Todos, En preparación, En camino, Recibidos y, en el panel, **Plazo vencido**. Tocar uno filtra la lista (tocarlo de nuevo vuelve a todos).
- **Filtros**: búsqueda por siniestro, patente, vehículo, taller, perito, compañía, remito o guía; expreso; compañía; taller; perito; fecha de carga (desde / hasta) y orden (última actualización, más nuevos, más viejos o entrega más próxima). En el celular los filtros extra se abren con *Más filtros*.
- **Descargar Excel**: baja los pedidos que se están viendo (con los filtros aplicados) en un CSV que Excel abre con acentos y columnas.

## Plazo de entrega

Al crear o editar un pedido, el admin puede poner la **fecha estimada de entrega** (o elegir *En 3 días*, *En 1 semana*, *En 15 días* o *En 1 mes*). El taller, el perito y la consulta sin cuenta la ven como "Entrega estimada", también en el mail de novedades, y queda en el historial. En el panel, los pedidos con el plazo vencido (y sin recibir) se marcan en rojo y se pueden filtrar.

## Destino del envío: mapa, distancia y tiempo

Cada taller y perito tiene su **dirección de entrega** (se carga en Usuarios). En cada pedido se elige **¿A dónde se envía?**: *Al taller*, *Al perito* u *Otra dirección*; la dirección se completa sola con la de la cuenta y se puede cambiar.

Al guardar, la página ubica la dirección en el mapa y calcula la **distancia y el tiempo en auto desde Genco** (`GENCO_DIRECCION` en `.env`, y `GENCO_COORDENADAS` con el punto exacto de Google Maps: hoy GENCO SA, Carril Rodríguez Peña, Godoy Cruz, Mendoza). En la ficha del pedido se ve el mapa, cómo quedó ubicada la dirección (para revisar que sea el lugar correcto), los km, el tiempo y los botones *Ver ruta en Google Maps* y *Abrir en Google Maps*. En la reseña hay una columna **Destino** con km y tiempo, y el Excel incluye dirección, distancia y tiempo.

- Las direcciones se buscan en **Georef** (servicio de direcciones del Estado argentino, datos.gob.ar) y, si no aparecen, en **OpenStreetMap**. La ruta la calcula **OSRM**. Son gratuitos y sin clave; cada dirección se busca una sola vez (quedan guardadas en la tabla `ubicaciones`).
- Conviene escribir **"calle y número, ciudad, provincia"** (ej: *Av. Colón 1234, Córdoba, Córdoba*).
- El tiempo es el de un auto: el expreso puede tardar más.
- Si cambia la dirección de un taller o perito, sus pedidos que usaban la dirección anterior pasan a la nueva.
- Solo lo ven los administradores (no se muestra a talleres, peritos ni en la consulta sin cuenta).

## Seguimiento de envíos

Los expresos no tienen API, así que **todo se carga a mano** desde la ficha del pedido:

- **Expreso**: Angeleri, Andreani, OCA, Sendbox o la repartidora de Genco, con un clic.
- **¿Dónde está?**: Preparando, En camino o Recibido (define si el pedido figura en camino o recibido).
- **Estado del viaje**: texto que ven el taller y el perito. Los estados más comunes (En viaje, En sucursal de destino, En reparto, Entregado en el taller...) están como botones y completan también "¿Dónde está?".
- Con expreso con página de seguimiento y guía cargada, debajo de la guía aparece *Ver el estado en …*: copia la guía y abre la página del expreso.

El cliente (taller, perito o consulta sin cuenta) ve en cada envío **"Seguí este envío en …"** con la guía, un botón *Copiar guía* y otro *Ir a …* que la copia sola y abre la página del expreso, donde solo tiene que pegarla. El mail de novedades lleva el mismo enlace. Las páginas de cada expreso están en `PAGINAS_SEGUIMIENTO` (`backend/modelos/pedidos.js`):

| Expreso | Página de seguimiento |
|---|---|
| Andreani | https://www.andreani.com/ |
| OCA | https://www.oca.com.ar/ |
| Sendbox | https://www.sendbox.com.ar/seguimiento/ |
| Angeleri, Repartidora de Genco | — (el estado lo carga la oficina) |

### "Ya me llegó": la llegada la confirma quien recibe

Genco no tiene que marcar los envíos como recibidos: en **Mis pedidos**, el pedido muestra arriba **"¿Ya te llegó?"** con un botón **Ya me llegó** por cada envío que falta recibir (y en la lista, *"¿Te llegó? Confirmalo"* en los pedidos con envíos en viaje). Al confirmarlo:

- El envío queda **Recibido** y en el historial se anota quién lo confirmó (*"Envío 1 · Recibido (lo confirmó Taller Norte)"*). Con el último envío de un despacho completo, el pedido pasa a **Recibido** y en la reseña del panel figura como recibido.
- Lo confirma quien recibe el paquete según el destino del pedido: si va **al taller**, el taller; si va **al perito**, el perito; si va a **otra dirección** (o no se indicó), cualquiera de los dos.
- Sube la versión del pedido: si alguien tenía la ficha abierta en el panel, al guardar le avisa que hubo cambios, en vez de volver el envío atrás.
- Si se confirmó por error, el admin lo corrige en la ficha del pedido (*¿Dónde está?* → En camino).
- **Recordatorio por mail**: mientras haya envíos en viaje, el mail de novedades de quien recibe el paquete trae arriba un recuadro **"¿Ya te llegó?"** con el botón *Confirmar que me llegó*, que abre el pedido. Si no tenía la sesión abierta, después de ingresar vuelve directo a ese pedido.

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
| **A03 · Cadena de suministro** | Solo 2 librerías (express y nodemailer) con versiones fijas en `package-lock.json` (instalar con `npm ci`). `.npmrc` impide que las librerías ejecuten código al instalarse. Las fuentes se sirven desde la propia página (sin Google Fonts). Dependabot revisa actualizaciones cada semana; `npm run auditar` busca vulnerabilidades conocidas. |
| **A04 · Criptografía** | Contraseñas con scrypt (N=2^15, r=8, p=3, sal al azar); los hashes viejos se actualizan solos al ingresar. Sesiones firmadas con HMAC-SHA256 y comparación en tiempo constante. Cookie `__Host-` + `Secure` con https. Enlaces de recuperación al azar (guardados como hash, vencen en 1 hora, un solo uso). |
| **A05 · Inyección** | Todas las consultas SQL usan parámetros (los nombres de columna son fijos, nunca vienen de lo que escribe el usuario). Los textos se recortan y se les sacan caracteres de control. Todo lo que se muestra se escapa (en la página y en los mails), y la CSP bloquea cualquier script inyectado. |
| **A06 · Diseño inseguro** | Límites de intentos: login (por cuenta e IP), registro, recuperación de contraseña, consultas sin cuenta fallidas y un límite general por conexión. Las cuentas registradas quedan pendientes hasta que un admin las aprueba. La recuperación responde lo mismo exista o no la cuenta. Límite de tamaño en los datos enviados. |
| **A07 · Autenticación** | Contraseñas de al menos 8 caracteres, que no sean comunes ni contengan el email. Las cuentas creadas por un admin (y la cuenta inicial) deben cambiar la contraseña en el primer ingreso. Cambiar la contraseña cierra todas las demás sesiones de esa cuenta. Sesiones de 12 horas. |
| **A08 · Integridad** | Bloqueo optimista (`version`) para que dos personas no se pisen los cambios. Las migraciones de la base corren en transacción con control de claves foráneas. Sin scripts de terceros (CSP `script-src 'self'`). |
| **A09 · Registro y alertas** | `data/seguridad.log` (JSON, una línea por evento): ingresos, intentos fallidos, bloqueos, cambios de contraseña y de cuentas, accesos denegados, pedidos de otros sitios y errores. Nunca guarda contraseñas ni tokens. Los eventos graves mandan un mail a `ALERTAS_EMAIL` (máximo uno por hora por motivo). |
| **A10 · Errores** | Al usuario nunca le llegan detalles internos, solo un mensaje claro. Los errores inesperados quedan registrados; si el proceso falla de forma grave, se registra, avisa por mail y se cierra para que el administrador de procesos lo reinicie. Los mails tienen tiempo máximo de espera. |

### Publicar en un servidor

- **En el hosting de gencorepair.com.ar (DonWeb / Ferozo)**: ese hosting es para sitios PHP, así que hay una **versión PHP** de la página en [`php/`](php/) con la misma API y las mismas pantallas. `node php/armar.mjs` arma un zip que se sube con el Administrador de archivos y se instala desde el navegador (`/instalar.php`). Guía paso a paso: [php/LEEME.md](php/LEEME.md).
- **En un servidor propio (VPS con Ubuntu)**: corre esta versión Node.js. Guía en [deploy/LEEME.md](deploy/LEEME.md); `deploy/instalar.sh` deja todo instalado (Node.js, servicio que se reinicia solo, nginx con HTTPS, firewall y respaldos diarios).

Los cambios en la API se hacen en las dos versiones (`backend/` y `php/privado/`); las pantallas (`frontend/`) son las mismas.

### Antes de publicar la página

1. **HTTPS obligatorio**: publicarla detrás de un proxy con certificado (nginx + Let's Encrypt, Cloudflare, etc.) y poner `APP_URL=https://...` en `.env`. Eso activa la cookie segura, HSTS y `upgrade-insecure-requests`. Si el proxy no está en la misma máquina, configurar `TRUST_PROXY`.
2. **Contraseña del admin**: ingresar con la cuenta inicial y elegir una contraseña fuerte (la página lo exige). Si se usa una cuenta compartida, que la contraseña la sepan solo esas personas.
3. **`SESSION_SECRET`** al azar en `.env` (ver `.env.example`), o dejar que se genere en `data/session-secret`.
4. **Respaldos** diarios de la carpeta `data/` (base de datos y registro de seguridad), guardados fuera del servidor.
5. **Que se reinicie solo**: correrla con un administrador de procesos (pm2, un servicio de Windows o systemd) para que vuelva a arrancar si se cae o se reinicia la máquina.
6. **Instalar con `npm ci`** (respeta las versiones del `package-lock.json`).
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
  servicios/          Tareas automáticas: avisos por mail, ubicación de destinos en el mapa
  scripts/            probar-mail, vista-previa-aviso
php/                  Versión PHP para hosting compartido (DonWeb / Ferozo), con la misma API
  armar.mjs           Arma dist/genco-seguimiento-php.zip con un código de instalación nuevo
  publico/            instalar.php, api/index.php, tareas.php (cron) y el .htaccess
  privado/            Configuración, base de datos, modelos, servicios y rutas (no se sirve por la web)
deploy/               Instalación en un VPS con Ubuntu (versión Node.js)
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
3. **Envíos**: cada uno con su N° de remito, expreso (Angeleri, Andreani, OCA, Sendbox o la repartidora de Genco), N° de guía, estado del viaje y dónde está (preparando, en camino o recibido)
4. **En camino / Recibido en parte / Recibido**

**Despacho parcial:** cuando hay solo una parte de las piezas, se manda esa parte (Envío 1, con su remito y su guía). Cuando llega lo que falta, en la ficha del pedido se agrega otro envío con su propio remito y número de guía ("+ Agregar envío con lo que falta") y el despacho pasa a *Completo*. El pedido figura como *Recibido* recién cuando llegaron todos los envíos.

Cada cambio que guarda el admin queda en el historial que ven el cliente, el taller y el perito (por ejemplo "Envío 2 · Remito 0001-00020045").
