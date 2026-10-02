// Configuración leída de las variables de entorno (archivo .env en la raíz del proyecto).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Carpeta raíz del proyecto (donde están frontend/, data/ y .env).
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const puerto = Number(process.env.PORT) || 3000;

export const config = {
  puerto,
  // Dirección pública de la página, para armar los enlaces de los mails.
  appUrl: (process.env.APP_URL || `http://localhost:${puerto}`).replace(/\/$/, ''),
  dirDatos: path.resolve(RAIZ, process.env.DATA_DIR || 'data'),
  dirFrontend: path.join(RAIZ, 'frontend'),

  sesion: {
    secreto: process.env.SESSION_SECRET || '',
    cookieSegura: process.env.COOKIE_SECURE === '1',
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
};
