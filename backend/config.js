// Configuración leída de las variables de entorno (archivo .env en la raíz del proyecto).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Carpeta raíz del proyecto (donde están frontend/, data/ y .env).
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const puerto = Number(process.env.PORT) || 3000;
// Dirección pública de la página, para armar los enlaces de los mails.
const appUrl = (process.env.APP_URL || `http://localhost:${puerto}`).replace(/\/$/, '');
const https = appUrl.startsWith('https://');
// Proxies en los que se confía para saber la IP real del visitante: "loopback" (nginx en la misma
// máquina), un número de saltos (ej. 1 detrás de Cloudflare o de un balanceador) o IPs separadas por coma.
const proxy = (process.env.TRUST_PROXY || 'loopback').trim();

export const config = {
  puerto,
  appUrl,
  // Publicada con HTTPS: cookies solo por conexión segura y HSTS.
  https,
  trustProxy: /^\d+$/.test(proxy) ? Number(proxy) : proxy,
  dirDatos: path.resolve(RAIZ, process.env.DATA_DIR || 'data'),
  dirFrontend: path.join(RAIZ, 'frontend'),

  sesion: {
    secreto: process.env.SESSION_SECRET || '',
    cookieSegura: https || process.env.COOKIE_SECURE === '1',
  },

  // Cuenta de administración que se crea en el primer arranque.
  admin: {
    email: (process.env.ADMIN_EMAIL || 'admin@genco.local').trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || 'genco-admin',
  },

  // Gmail desde el que salen los mails. La clave es una "contraseña de aplicación" de Google;
  // se aceptan los espacios con los que Google la muestra.
  gmail: {
    usuario: (process.env.GMAIL_USUARIO || '').trim(),
    claveApp: (process.env.GMAIL_CLAVE_APP || '').replace(/\s+/g, ''),
  },

  // Cuenta de Genco en el sistema web de Sendbox, para leer solo el estado de los envíos.
  sendbox: {
    usuario: (process.env.SENDBOX_USUARIO || '').trim(),
    clave: process.env.SENDBOX_CLAVE || '',
    intervaloMin: Math.max(5, Number(process.env.SENDBOX_INTERVALO_MIN) || 30),
  },
};
