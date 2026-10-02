import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, dataDir } from './db.js';

export const ROLES = { admin: 'Administrador', perito: 'Perito', taller: 'Taller' };

const COOKIE = 'genco_sesion';
const DURACION_MS = 12 * 60 * 60 * 1000;
const SECURE = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';

// Si no se define SESSION_SECRET, se genera uno y se guarda para que las sesiones sobrevivan reinicios.
const SECRET = process.env.SESSION_SECRET || (() => {
  const archivo = path.join(dataDir, 'session-secret');
  if (!fs.existsSync(archivo)) fs.writeFileSync(archivo, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(archivo, 'utf8').trim();
})();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const esperado = Buffer.from(hash, 'hex');
  const calculado = crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), esperado.length);
  return crypto.timingSafeEqual(calculado, esperado);
}

// Se usa cuando el usuario no existe, para que la respuesta tarde lo mismo.
export const HASH_FALSO = hashPassword(crypto.randomBytes(8).toString('hex'));

// El hash de la contraseña entra en la firma: al cambiarla, se cierran las sesiones abiertas.
const firmar = (uid, exp, passwordHash) =>
  crypto.createHmac('sha256', SECRET).update(`${uid}.${exp}.${passwordHash}`).digest('hex');

export function crearSesion(res, usuario) {
  const exp = Date.now() + DURACION_MS;
  const token = `${usuario.id}.${exp}.${firmar(usuario.id, exp, usuario.password_hash)}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DURACION_MS / 1000}${SECURE}`);
}

export function cerrarSesion(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE}`);
}

export function usuarioDeRequest(req) {
  const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  const [uid, exp, mac] = (raw?.slice(COOKIE.length + 1) || '').split('.');
  if (!uid || !exp || !mac || !(Number(exp) > Date.now())) return null;
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1 AND aprobado = 1').get(uid);
  if (!usuario) return null;
  const esperado = firmar(usuario.id, exp, usuario.password_hash);
  if (mac.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(esperado))) return null;
  return usuario;
}

// Middleware: exige sesión y, si se indican, alguno de los roles.
export const requireRol = (...roles) => (req, res, next) => {
  const usuario = usuarioDeRequest(req);
  if (!usuario) return res.status(401).json({ error: 'Iniciá sesión para continuar.' });
  if (roles.length && !roles.includes(usuario.rol)) return res.status(403).json({ error: 'No tenés permiso para acceder.' });
  req.usuario = usuario;
  next();
};

export const usuarioPublico = (u) => ({
  id: u.id, usuario: u.usuario, nombre: u.nombre, empresa: u.empresa, rol: u.rol, rol_nombre: ROLES[u.rol],
});

// Primer arranque: crea el usuario "admin" si no hay ningún administrador.
export function asegurarAdmin() {
  if (db.prepare("SELECT 1 FROM usuarios WHERE rol = 'admin'").get()) return;
  const password = process.env.ADMIN_PASSWORD || 'genco-admin';
  db.prepare("INSERT INTO usuarios (usuario, nombre, rol, password_hash) VALUES ('admin', 'Administrador', 'admin', ?)")
    .run(hashPassword(password));
  console.warn(`⚠ Se creó el usuario "admin"${process.env.ADMIN_PASSWORD ? ' con la contraseña de ADMIN_PASSWORD' : ' con contraseña "genco-admin"'}. Cambiala al ingresar.`);
}
