// Enlaces de "¿Olvidaste tu contraseña?". Se guarda solo el hash del token: quien vea la base no puede usarlos.
import crypto from 'node:crypto';
import { db, transaction } from '../db/conexion.js';
import { HttpError } from '../lib/errores.js';
import { cambiarPassword } from './usuarios.js';
import { validarPassword } from '../lib/auth.js';

export const VIGENCIA_MINUTOS = 60;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Crea un enlace nuevo (anula los anteriores de esa cuenta) y devuelve el token.
export function crear(usuarioId) {
  const token = crypto.randomBytes(32).toString('base64url');
  transaction(() => {
    db.prepare('DELETE FROM recuperaciones WHERE usuario_id = ? OR expira < ?').run(usuarioId, Date.now());
    db.prepare('INSERT INTO recuperaciones (usuario_id, token_hash, expira) VALUES (?, ?, ?)')
      .run(usuarioId, hashToken(token), Date.now() + VIGENCIA_MINUTOS * 60 * 1000);
  });
  return token;
}

// Cambia la contraseña con un token válido. El enlace sirve una sola vez.
export function usar(token, password) {
  const rec = token && db.prepare('SELECT * FROM recuperaciones WHERE token_hash = ?').get(hashToken(String(token)));
  if (!rec || rec.usado || rec.expira < Date.now()) {
    throw new HttpError(400, 'El enlace no es válido o ya venció. Pedí uno nuevo desde "¿Olvidaste tu contraseña?".');
  }
  validarPassword(password);
  transaction(() => {
    cambiarPassword(rec.usuario_id, password);
    db.prepare('DELETE FROM recuperaciones WHERE usuario_id = ?').run(rec.usuario_id);
  });
  return db.prepare('SELECT email FROM usuarios WHERE id = ?').get(rec.usuario_id);
}
