# Subir la página al hosting de gencorepair.com.ar (DonWeb / Ferozo)

El hosting de DonWeb (panel Ferozo) es para páginas PHP, así que esta es la versión PHP de la página: hace
exactamente lo mismo que la versión Node.js y usa las mismas pantallas.

Lo que se sube es **un solo archivo**: `dist/genco-seguimiento-php.zip`. Se arma con:

```
node php/armar.mjs
```

Al terminar muestra el **código de instalación** (por ejemplo `ABCD-EFGH-JKLM`). Anotalo: se pide una sola vez
al instalar, para que nadie más pueda instalar la página antes que ustedes.

La página queda en **https://seguimiento.gencorepair.com.ar** (un subdominio). Tiene que ser un subdominio y
no una carpeta tipo `gencorepair.com.ar/seguimiento`: la página necesita estar en la raíz de su dirección.

---

## Paso 1 · Crear el subdominio

1. Entrá al panel de Ferozo.
2. **Dominios** → **Subdominios** → crear `seguimiento` (queda `seguimiento.gencorepair.com.ar`).
3. Fijate en qué carpeta lo creó (por ejemplo `public_html/seguimiento`). Ahí va la página.
4. Si el panel ofrece **certificado SSL** (o "Let's Encrypt") para el subdominio, activalo. Puede tardar un rato
   en quedar listo. Sin SSL la página funciona, pero las contraseñas viajarían sin cifrar.

## Paso 2 · Subir el zip

1. En el panel: **Mi sitio web** → **Administrador de archivos**.
2. Entrá a la carpeta del subdominio (tiene que estar vacía; si hay un `index.html` de ejemplo, borralo).
3. **Subir** → elegí `genco-seguimiento-php.zip`.
4. Clic derecho sobre el zip → **Descomprimir** (o "Extraer").
5. Revisá que `login.html`, `instalar.php` y la carpeta `privado` hayan quedado **directamente** en la carpeta
   del subdominio, no adentro de otra carpeta. Después borrá el zip.

Si el Administrador de archivos no deja descomprimir: descomprimí el zip en la computadora y subí todo por FTP
(por ejemplo con FileZilla, con los datos de FTP del panel). Ojo que los archivos `.htaccess` están ocultos y
también hay que subirlos.

## Paso 3 · Instalar

Abrí **https://seguimiento.gencorepair.com.ar/instalar.php** y completá:

| Campo | Qué poner |
|---|---|
| Código de instalación | El que mostró `node php/armar.mjs` |
| Dirección del sitio | `https://seguimiento.gencorepair.com.ar` |
| Cuenta de administración | Nombre, mail y contraseña de la cuenta que van a compartir los admins |
| Mails | **Gmail**: la cuenta de avisos y su **contraseña de aplicación** (16 letras, se saca en la cuenta de Google → Seguridad → Contraseñas de aplicación). No es la contraseña normal de la cuenta |
| Base de datos | **SQLite** (dejarlo como está) |
| Dirección de Genco | Ya viene puesta |

Tocá **Instalar**. Al terminar:

- Dice si **Gmail funciona**. Si dice que no, mirá el plan B más abajo.
- Muestra una **dirección para la tarea programada** (paso 4). Guardala en un lugar seguro.
- `instalar.php` queda bloqueado y el código de instalación se borra solo.

Listo: entrá con **Iniciar sesión** y creá las cuentas de talleres y peritos desde **Usuarios**.

## Paso 4 · Tarea programada (opcional)

Los avisos por mail salen solos cada vez que alguien usa la página. Para que salgan aunque nadie la tenga
abierta, si en el panel aparece **Cron** o **Tareas programadas**, creá una que corra **cada minuto** con:

```
wget -q -O /dev/null "LA_DIRECCIÓN_QUE_MOSTRÓ_EL_INSTALADOR"
```

(si el panel pide solo una dirección web, pegá la dirección directamente).

## Paso 5 · El botón del sitio

En la página de gencorepair, hacé que el botón lleve a **https://seguimiento.gencorepair.com.ar**.

---

## Si algo no funciona

**Gmail no funciona (plan B).** Algunos hostings no dejan conectarse a Gmail. En ese caso:

1. En el panel de Ferozo, **Correo** → creá una casilla, por ejemplo `avisos@gencorepair.com.ar`.
2. Con el Administrador de archivos, abrí `privado/config.php` y en la parte `'mail'` poné
   `'modo' => 'hosting'` y `'remitente' => 'avisos@gencorepair.com.ar'`.

**El instalador dice que no hay SQLite.** Elegí **MySQL**: creá una base de datos en el panel (**Bases de
datos**) y copiá en el instalador el servidor, el nombre de la base, el usuario y la contraseña que te da.

**Se ve "Error 500" o la página no carga.** Revisá que los archivos `.htaccess` se hayan subido (paso 2).

**Se olvidó la contraseña del admin.** Desde la pantalla de inicio de sesión, **¿Olvidaste tu contraseña?**
(llega un mail a la cuenta del admin).

## Respaldos

Todo lo que se carga (pedidos, cuentas, envíos) está en un solo archivo: `privado/datos-XXXX/genco.sqlite`
(`XXXX` son letras al azar que eligió el instalador). Una vez por semana, descargalo desde el Administrador de
archivos y guardalo en otro lado. Con eso alcanza para recuperar todo.

## Actualizar la página más adelante

1. `node php/armar.mjs` para armar el zip nuevo.
2. Subilo a la carpeta del subdominio y descomprimilo **reemplazando** los archivos.
3. Borrá el zip.

No se pierde nada: la configuración (`privado/config.php`) y la base de datos (`privado/datos-XXXX`) no vienen
en el zip, así que quedan como estaban. Si hace falta, la base de datos se actualiza sola la primera vez que
alguien entra.

## Seguridad

- La carpeta `privado` no se puede abrir desde internet (configuración, base de datos, registro y código).
- `privado/config.php` tiene las claves del mail y de las sesiones: no compartirlo.
- Con https activo, la página obliga a usarlo y avisa a los navegadores que siempre lo usen.
- Si llegan alertas de seguridad, el registro está en `privado/datos-XXXX/seguridad.log`.

## Para probarla en una computadora

Con PHP 8.1 o más nuevo instalado:

```
node php/armar.mjs
php -S 127.0.0.1:3200 -t dist/genco-seguimiento-php php/servidor-dev.php
```

y abrir http://127.0.0.1:3200/instalar.php.
