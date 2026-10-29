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

// "-32.9264973,-68.8320528" -> { lat, lon }
function coordenadas(texto) {
  const m = String(texto ?? '').match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

export const config = {
  puerto,
  // En el servidor: 127.0.0.1, así solo se entra por nginx (con HTTPS). Vacío: todas las interfaces.
  host: (process.env.HOST || '').trim() || undefined,
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

  // Desde dónde salen los pedidos: punto de partida para la distancia y el tiempo hasta cada destino.
  genco: {
    direccion: (process.env.GENCO_DIRECCION || '').trim(),
    // Punto exacto (opcional), "latitud,longitud" como los da Google Maps. Si está, la distancia se calcula
    // desde ahí en vez de buscar la dirección en el mapa.
    coordenadas: coordenadas(process.env.GENCO_COORDENADAS),
  },

  // Gmail desde el que salen los mails. La clave es una "contraseña de aplicación" de Google;
  // se aceptan los espacios con los que Google la muestra.
  gmail: {
    usuario: (process.env.GMAIL_USUARIO || '').trim(),
    claveApp: (process.env.GMAIL_CLAVE_APP || '').replace(/\s+/g, ''),
  },
};
