// Protecciones generales de la página:
//   - Cabeceras de seguridad (OWASP A02): CSP, anti-clickjacking, HSTS con https, etc.
//   - Protección contra pedidos falsificados desde otros sitios (CSRF, A01): la API solo acepta
//     cambios que vengan de la propia página.
//   - Las respuestas de la API no quedan guardadas en cachés ni en el navegador (A04).
//   - Límite general de pedidos por conexión, para frenar abusos y robots (A06).
import { config } from '../config.js';
import { limitador, MINUTO } from './limitador.js';
import { registrar } from './registroSeguridad.js';

// Solo se cargan scripts, estilos, imágenes y fuentes de la propia página. Los estilos en línea
// (atributos style="...") siguen permitidos; los scripts en línea no.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(config.https ? ['upgrade-insecure-requests'] : []),
].join('; ');

const CABECERAS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'X-DNS-Prefetch-Control': 'off',
  ...(config.https ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};

export function cabeceras(req, res, next) {
  res.set(CABECERAS);
  next();
}

// ---------------------------------------------------------------- API

const CAMBIOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const hostDe = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};
const HOST_PUBLICO = hostDe(config.appUrl);

// Un cambio (crear, editar, borrar, ingresar...) solo se acepta si lo pide la propia página. Los
// navegadores mandan Sec-Fetch-Site y Origin, y un sitio ajeno no puede falsificarlos. Además los
// datos tienen que venir como JSON, algo que un formulario de otro sitio no puede mandar.
export function soloMismoSitio(req, res, next) {
  if (!CAMBIOS.has(req.method)) return next();

  const sitio = req.get('sec-fetch-site');
  const origen = req.get('origin');
  const hostOrigen = origen ? hostDe(origen) : null;
  const ajeno = (sitio && !['same-origin', 'none'].includes(sitio))
    || (origen && hostOrigen !== req.get('host') && hostOrigen !== HOST_PUBLICO);
  if (ajeno) {
    registrar('pedido_de_otro_sitio_bloqueado', { ruta: req.originalUrl, origen, sitio }, req, 'aviso');
    return res.status(403).json({ error: 'Pedido no permitido.' });
  }
  // req.is() da null si no hay cuerpo (por ejemplo, cerrar sesión) y false si el tipo no es JSON.
  if (req.is('application/json') === false) {
    return res.status(415).json({ error: 'Los datos tienen que enviarse como JSON.' });
  }
  next();
}

export function sinCache(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

// Holgado para tres personas trabajando a la vez desde la misma oficina (misma IP).
const pedidosApi = limitador(900, 5 * MINUTO, 'Demasiadas solicitudes desde esta conexión. Esperá unos minutos.');

export function limiteGeneral(req, res, next) {
  pedidosApi.controlar(req.ip);
  pedidosApi.sumar(req.ip);
  if (pedidosApi.excedido(req.ip)) registrar('limite_general_alcanzado', { ruta: req.originalUrl }, req, 'aviso');
  next();
}
