// Contraseñas y sesiones (OWASP A04 fallas criptográficas, A07 autenticación).
//
// Cada navegador tiene su propia sesión (una cookie firmada), así que varias personas pueden usar la
// misma cuenta al mismo tiempo desde distintas computadoras sin cerrarse la sesión entre ellas.
// El hash de la contraseña entra en la firma: si alguien cambia la contraseña de la cuenta, se cierran
// todas sus sesiones abiertas y hay que ingresar con la nueva.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/conexion.js';
import { HttpError } from './errores.js';
import { registrar } from './registroSeguridad.js';

const DURACION_MS = 12 * 60 * 60 * 1000;
// Con HTTPS la cookie lleva el prefijo __Host- (solo por conexión segura, sin dominio, ruta "/").
const COOKIE = config.sesion.cookieSegura ? '__Host-genco_sesion' : 'genco_sesion';
const ATRIBUTOS = `HttpOnly; SameSite=Lax; Path=/${config.sesion.cookieSegura ? '; Secure' : ''}`;

// Sin SESSION_SECRET se genera uno y se guarda, para que las sesiones sobrevivan a los reinicios.
const SECRETO = config.sesion.secreto || (() => {
  const archivo = path.join(config.dirDatos, 'session-secret');
  if (!fs.existsSync(archivo)) fs.writeFileSync(archivo, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(archivo, 'utf8').trim();
})();

// ---------------------------------------------------------------- Contraseñas

// scrypt con N=2^15, r=8, p=3: una de las configuraciones recomendadas por OWASP (~32 MB por cálculo).
// Formato guardado: scrypt$N$r$p$sal$hash. El formato viejo (scrypt$sal$hash, parámetros por defecto de
// Node) se sigue aceptando y se actualiza solo la próxima vez que la persona ingresa.
const SCRYPT = { N: 2 ** 15, r: 8, p: 3 };
const LARGO_MINIMO = 8;
const LARGO_MAXIMO = 128;
const scrypt = (password, sal, largo, { N, r, p }) =>
  crypto.scryptSync(String(password), sal, largo, { N, r, p, maxmem: 128 * N * r * 2 });

export function hashPassword(password) {
  const sal = crypto.randomBytes(16);
  const hash = scrypt(password, sal, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function leerHash(guardado) {
  const partes = String(guardado).split('$');
  if (partes[0] !== 'scrypt') return null;
  if (partes.length === 3) return { params: { N: 2 ** 14, r: 8, p: 1 }, sal: partes[1], hash: partes[2] };
  if (partes.length === 6) {
    const [, N, r, p, sal, hash] = partes;
    return { params: { N: Number(N), r: Number(r), p: Number(p) }, sal, hash };
  }
  return null;
}

export function verifyPassword(password, guardado) {
  const h = leerHash(guardado);
  if (!h || !h.sal || !h.hash) return false;
  // Limita el largo para que nadie pueda trabar el servidor con contraseñas enormes.
  if (String(password).length > LARGO_MAXIMO) return false;
  const esperado = Buffer.from(h.hash, 'hex');
  const calculado = scrypt(password, Buffer.from(h.sal, 'hex'), esperado.length, h.params);
  return crypto.timingSafeEqual(calculado, esperado);
}

// ¿El hash guardado usa parámetros más débiles que los actuales? (para actualizarlo al ingresar)
export function necesitaRehash(guardado) {
  const h = leerHash(guardado);
  return !h || h.params.N < SCRYPT.N || h.params.r < SCRYPT.r || h.params.p < SCRYPT.p;
}

// Se usa cuando la cuenta no existe, para que la respuesta tarde lo mismo.
export const HASH_FALSO = hashPassword(crypto.randomBytes(8).toString('hex'));

// Contraseñas demasiado comunes (las primeras que se prueban en un ataque).
const COMUNES = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344',
  'password', 'password1', 'contraseña', 'contrasena', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'abcd1234',
  'abc12345', 'iloveyou', 'admin123', 'administrador', 'genco-admin', 'genco123', 'genco1234', 'bienvenido',
  'argentina', 'cambiar-esta-clave', 'siniestro', 'siniestros',
]);

export function validarPassword(password, { email = '' } = {}) {
  const pw = String(password ?? '');
  if (pw.length < LARGO_MINIMO) throw new HttpError(400, `La contraseña debe tener al menos ${LARGO_MINIMO} caracteres.`);
  if (pw.length > LARGO_MAXIMO) throw new HttpError(400, `La contraseña no puede tener más de ${LARGO_MAXIMO} caracteres.`);
  const minuscula = pw.toLowerCase();
  if (COMUNES.has(minuscula) || /^(.)\1+$/.test(pw)) {
    throw new HttpError(400, 'Esa contraseña es demasiado común. Elegí otra más difícil de adivinar.');
  }
  if (email && minuscula.includes(email.split('@')[0].toLowerCase()) && email.split('@')[0].length >= 4) {
    throw new HttpError(400, 'La contraseña no puede contener tu email.');
  }
}

// ---------------------------------------------------------------- Sesiones

const firmar = (uid, exp, passwordHash) =>
  crypto.createHmac('sha256', SECRETO).update(`${uid}.${exp}.${passwordHash}`).digest('hex');

export function crearSesion(res, usuario) {
  const exp = Date.now() + DURACION_MS;
  const token = `${usuario.id}.${exp}.${firmar(usuario.id, exp, usuario.password_hash)}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${ATRIBUTOS}; Max-Age=${DURACION_MS / 1000}`);
}

export function cerrarSesion(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${ATRIBUTOS}; Max-Age=0`);
}

export function usuarioDeRequest(req) {
  const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  const [uid, exp, mac] = (raw?.slice(COOKIE.length + 1) || '').split('.');
  if (!/^\d+$/.test(uid ?? '') || !/^\d+$/.test(exp ?? '') || !mac || !(Number(exp) > Date.now())) return null;
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1 AND aprobado = 1').get(uid);
  if (!usuario) return null;
  const esperado = firmar(usuario.id, exp, usuario.password_hash);
  if (mac.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(esperado))) return null;
  return usuario;
}

// Middleware: exige sesión (aunque la cuenta tenga que cambiar la contraseña). Solo para /me y el cambio.
export const requireSesion = (req, res, next) => {
  const usuario = usuarioDeRequest(req);
  if (!usuario) return res.status(401).json({ error: 'Iniciá sesión para continuar.' });
  req.usuario = usuario;
  next();
};

// Middleware: exige sesión, que la contraseña no esté pendiente de cambio y, si se indican, alguno de los roles.
export const requireRol = (...roles) => (req, res, next) => {
  const usuario = usuarioDeRequest(req);
  if (!usuario) return res.status(401).json({ error: 'Iniciá sesión para continuar.' });
  req.usuario = usuario;
  if (usuario.cambiar_password) {
    return res.status(403).json({ error: 'Antes de seguir tenés que cambiar la contraseña.', codigo: 'cambiar_password' });
  }
  if (roles.length && !roles.includes(usuario.rol)) {
    registrar('acceso_denegado', { ruta: req.originalUrl, rol: usuario.rol }, req, 'aviso');
    return res.status(403).json({ error: 'No tenés permiso para acceder.' });
  }
  next();
};
