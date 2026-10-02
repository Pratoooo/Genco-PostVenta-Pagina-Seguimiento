# Genco Siniestros — Seguimiento de pedidos

Página de seguimiento de pedidos de repuestos de Grupo Genco.

- **Iniciar sesión** (`/`, `/login`): es lo primero que se ve al entrar. Un único ingreso que detecta el rol del usuario y lo lleva a su sección:
  - **Talleres** y **peritos** → `/mis-pedidos`: ven solo los pedidos que tienen asignados.
  - **Administradores** → `/admin`: cargan y actualizan pedidos, y gestionan los usuarios.
- **Registrarse** (botón al lado de *Ingresar*): talleres y peritos crean su cuenta eligiendo el tipo de usuario. Se pide nombre y apellido, email, usuario y contraseña, y a los talleres también el **nombre del taller**. A los peritos no se les pide compañía: como pueden trabajar para varias, las carga el admin en su ficha. La cuenta queda **pendiente** hasta que un admin la aprueba en *Administración → Usuarios*.
- **¿Olvidaste tu contraseña?**: se ingresa el usuario o email y llega un mail con un enlace (vence en 1 hora, sirve una sola vez) para crear una contraseña nueva. Se puede ingresar con el usuario o con el email.
- **Consulta sin cuenta** (`/consulta`): cualquier persona ve el estado de un pedido con el **número de siniestro** y la **patente**.

## Cómo correrlo

Requiere Node.js 22.13 o superior (usa SQLite integrado, sin instalar base de datos).

```bash
npm install
cp .env.example .env   # y completar ADMIN_PASSWORD
npm start
```

En el primer arranque se crea el usuario **`admin`** con la contraseña de `ADMIN_PASSWORD` (o `genco-admin` si no está definida). Conviene cambiarla apenas se ingresa: menú de usuario → *Cambiar contraseña*.

Los datos quedan en `data/` (base `genco.db` y la clave de sesiones).

### Mails de recuperación de contraseña

Para que se envíen los mails hay que completar en `.env` los datos de una cuenta de correo (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) y la dirección pública de la página en `APP_URL`. Con Gmail se usa `smtp.gmail.com`, puerto `465` y una *contraseña de aplicación* de Google.

Mientras no esté configurado, el contenido del mail (con el enlace) se muestra en la consola del servidor. Los usuarios sin email cargado pueden pedirle a un admin que les cambie la contraseña desde *Usuarios*.

## Usuarios y permisos

| Rol           | Ve                                   | Puede |
|---------------|--------------------------------------|-------|
| Administrador | Todos los pedidos y usuarios         | Crear/editar pedidos y estados, crear/editar/desactivar usuarios |
| Taller        | Pedidos donde es el taller asignado  | Solo consultar |
| Perito        | Pedidos donde es el perito asignado  | Solo consultar |

- Los talleres y peritos se registran solos (quedan pendientes de aprobación) o los admins les crean la cuenta en **Administración → Usuarios**. En la ficha de un perito el admin carga sus **compañías de seguro** (puede tener varias).
- A cada pedido se le asigna su taller y su perito con un buscador: el taller se busca por el nombre del taller y el perito por su nombre (no por compañía).
- Desde una misma conexión se pueden crear hasta 10 cuentas por hora.
- Desactivar un usuario o cambiarle la contraseña cierra sus sesiones abiertas.
- Después de 8 intentos fallidos de ingreso, ese usuario queda bloqueado 15 minutos desde esa IP.
- En producción con HTTPS, poner `COOKIE_SECURE=1`.

## Estados del pedido

1. **Pedido a fábrica / Stock disponible**
2. **Despacho** parcial o total, con N° de remito
3. **Expreso** (Angeleri, Andreani o Sendbox) con N° de guía y estado del viaje
4. **En camino / Recibido**

Cada cambio de estado que guarda el admin queda en el historial que ven el cliente, el taller y el perito.
