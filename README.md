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
npm install
cp .env.example .env   # y completar (ver abajo)
npm start
```

La página queda en http://localhost:3000. En el primer arranque se crea la cuenta de administración con `ADMIN_EMAIL` / `ADMIN_PASSWORD`; conviene cambiar la contraseña al ingresar (menú de usuario → *Cambiar contraseña*).

## Mails de recuperación con Gmail

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

## Cuentas compartidas

Varias personas pueden usar la misma cuenta a la vez desde distintas computadoras (por ejemplo, los administradores de la oficina):

- Cada computadora tiene su propia sesión; ingresar en una no cierra la sesión de las otras.
- Si dos personas editan el mismo pedido o la misma cuenta al mismo tiempo, la segunda en guardar recibe un aviso y un botón para recargar, en lugar de pisar sin querer los cambios de la otra.
- Las listas se actualizan solas cada minuto y al volver a la pestaña.
- Si alguien cambia la contraseña de la cuenta, a los demás se les cierra la sesión y tienen que ingresar con la nueva.
- El bloqueo por contraseñas mal puestas es por cuenta y conexión, con margen (15 intentos en 15 minutos) para que los errores de tipeo de una persona no dejen afuera a toda la oficina.

## Estructura del código

```
backend/
  servidor.js         Punto de entrada (npm start)
  app.js              Arma Express: API en /api y el frontend como archivos estáticos
  config.js           Variables de entorno (.env)
  db/                 Conexión SQLite y migraciones del esquema (versionadas)
  lib/                Sesiones y contraseñas, mails (Gmail), errores, límites de intentos, validaciones
  modelos/            Reglas y consultas: pedidos, usuarios, recuperación de contraseña
  rutas/              Endpoints: público, auth, portal (mis pedidos), admin
  scripts/            probar-mail.js
frontend/
  *.html              Páginas: login, consulta, mis-pedidos, admin
  css/estilos.css
  img/                Logos de Genco y Stellantis
  js/comun/           Llamadas a la API, utilidades de interfaz, sesión, tarjeta de seguimiento
  js/paginas/         Código de cada página (el panel admin dividido en pedidos, usuarios y componentes)
data/                 Base de datos (no se sube a git)
```

## Estados del pedido

1. **Pedido a fábrica / Stock disponible**
2. **Despacho**: parcial (falta enviar una parte) o completo
3. **Envíos**: cada uno con su N° de remito, expreso (Angeleri, Andreani o Sendbox), N° de guía, estado del viaje y entrega
4. **En camino / Recibido en parte / Recibido**

**Despacho parcial:** cuando hay solo una parte de las piezas, se manda esa parte (Envío 1, con su remito y su guía). Cuando llega lo que falta, en la ficha del pedido se agrega otro envío con su propio remito y número de guía ("+ Agregar envío con lo que falta") y el despacho pasa a *Completo*. El pedido figura como *Recibido* recién cuando llegaron todos los envíos.

Cada cambio que guarda el admin queda en el historial que ven el cliente, el taller y el perito (por ejemplo "Envío 2 · Remito 0001-00020045").
