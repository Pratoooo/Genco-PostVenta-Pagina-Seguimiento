// Cuentas de administradores, talleres y peritos. Se ingresa con el email.
import { db, transaction } from '../db/conexion.js';
import { config } from '../config.js';
import { HttpError, conflicto } from '../lib/errores.js';
import { hashPassword, validarPassword } from '../lib/auth.js';
import * as norm from '../lib/normalizar.js';

export const ROLES = { admin: 'Administrador', perito: 'Perito', taller: 'Taller' };
export const DESTINOS = { admin: '/admin', perito: '/mis-pedidos', taller: '/mis-pedidos' };

const SELECT = `
  SELECT u.id, u.email, u.nombre, u.empresa, u.rol, u.activo, u.aprobado, u.version, u.created_at,
    (SELECT COUNT(*) FROM pedidos p WHERE p.taller_id = u.id OR p.perito_id = u.id) AS pedidos
  FROM usuarios u`;

export function obtener(id) {
  const u = db.prepare(`${SELECT} WHERE u.id = ?`).get(id);
  if (!u) throw new HttpError(404, 'Usuario no encontrado. Puede que otra persona lo haya eliminado.');
  return u;
}

export const listar = () => db.prepare(`${SELECT} ORDER BY u.activo DESC, u.rol, u.nombre COLLATE NOCASE`).all();

// Incluye el hash de la contraseña: solo para uso interno (login, recuperación).
export const buscarPorEmail = (email) => db.prepare('SELECT * FROM usuarios WHERE email = ?').get(norm.email(email));

export const contarPendientes = () => db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE aprobado = 0').get().n;

// Talleres y peritos aprobados, para asignarlos a los pedidos.
export function asignables(rol) {
  const orden = rol === 'taller' ? "COALESCE(NULLIF(empresa, ''), nombre)" : 'nombre';
  return db
    .prepare(`SELECT id, email, nombre, empresa, activo FROM usuarios WHERE rol = ? AND aprobado = 1 ORDER BY ${orden} COLLATE NOCASE`)
    .all(rol);
}

// Lo que ve el propio usuario de su cuenta.
export const publico = (u) => ({
  id: u.id, email: u.email, nombre: u.nombre, empresa: u.empresa, rol: u.rol, rol_nombre: ROLES[u.rol], destino: DESTINOS[u.rol],
});

// Valida los datos de un formulario de usuario.
//   nuevo: la contraseña es obligatoria.
//   registro: se registra desde la página (el taller pone el nombre del taller; al perito las
//   compañías se las carga un admin).
export function leer(b = {}, { nuevo = false, registro = false } = {}) {
  const d = {
    email: norm.email(b.email),
    nombre: norm.texto(b.nombre),
    rol: norm.texto(b.rol),
    empresa: norm.texto(b.empresa),
    activo: b.activo === undefined ? 1 : b.activo ? 1 : 0,
  };
  if (!ROLES[d.rol]) throw new HttpError(400, 'Rol inválido');
  if (d.rol === 'admin' || (registro && d.rol === 'perito')) d.empresa = '';
  if (d.rol === 'perito') d.empresa = norm.companias(d.empresa);
  if (!d.nombre) throw new HttpError(400, 'Ingresá el nombre y apellido.');
  if (registro && d.rol === 'taller' && !d.empresa) throw new HttpError(400, 'Ingresá el nombre del taller.');
  if (!d.email) throw new HttpError(400, 'Ingresá el email.');
  if (!norm.esEmail(d.email)) throw new HttpError(400, 'El email no parece válido.');
  const password = String(b.password ?? '');
  if (nuevo || password) validarPassword(password);
  return { d, password };
}

function validarEmailLibre(email, idActual = null) {
  const otro = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (otro && otro.id !== idActual) throw new HttpError(409, 'Ya existe una cuenta con ese email.', 'email');
}

const adminsActivos = () => db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1").get().n;

export function crear(d, password, { aprobado = true } = {}) {
  validarEmailLibre(d.email);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO usuarios (email, nombre, empresa, rol, activo, aprobado, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(d.email, d.nombre, d.empresa, d.rol, d.activo, aprobado ? 1 : 0, hashPassword(password));
  return obtener(lastInsertRowid);
}

// `version` es la que tenía el formulario al abrirse: si cambió, otra persona guardó en el medio.
// Devuelve el nuevo hash si se cambió la contraseña (para renovar la sesión de quien edita).
export function actualizar(id, d, { password, version, editor }) {
  const antes = obtener(id);
  validarEmailLibre(d.email, antes.id);
  if (editor.id === antes.id && (d.rol !== 'admin' || !d.activo)) {
    throw new HttpError(400, 'No podés quitarte el rol de administrador ni desactivarte.');
  }
  if (antes.rol !== d.rol && antes.pedidos > 0) {
    throw new HttpError(400, `No se puede cambiar el rol: tiene ${antes.pedidos} pedido(s) asignado(s).`);
  }
  if (antes.rol === 'admin' && antes.activo && (d.rol !== 'admin' || !d.activo) && adminsActivos() <= 1) {
    throw new HttpError(400, 'Tiene que quedar al menos un administrador activo.');
  }
  let nuevoHash = null;
  transaction(() => {
    const { changes } = db
      .prepare(`UPDATE usuarios SET email = ?, nombre = ?, empresa = ?, rol = ?, activo = ?, version = version + 1
                WHERE id = ? AND version = ?`)
      .run(d.email, d.nombre, d.empresa, d.rol, d.activo, antes.id, version ?? antes.version);
    if (!changes) throw conflicto('este usuario');
    if (password) {
      nuevoHash = hashPassword(password);
      db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(nuevoHash, antes.id);
    }
  });
  return { usuario: obtener(antes.id), nuevoHash };
}

export function cambiarPassword(id, password) {
  validarPassword(password);
  const hash = hashPassword(password);
  db.prepare('UPDATE usuarios SET password_hash = ?, version = version + 1 WHERE id = ?').run(hash, id);
  return hash;
}

export function aprobar(id) {
  const u = obtener(id);
  db.prepare('UPDATE usuarios SET aprobado = 1, version = version + 1 WHERE id = ?').run(u.id);
  return obtener(u.id);
}

export function eliminar(id, editor) {
  const u = obtener(id);
  if (u.id === editor.id) throw new HttpError(400, 'No podés eliminar tu propia cuenta.');
  if (u.rol === 'admin' && u.activo && adminsActivos() <= 1) {
    throw new HttpError(400, 'Tiene que quedar al menos un administrador activo.');
  }
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(u.id);
}

// Primer arranque: crea la cuenta de administración si no hay ninguna.
export function asegurarAdmin() {
  if (db.prepare("SELECT 1 FROM usuarios WHERE rol = 'admin'").get()) return;
  const { email, password } = config.admin;
  db.prepare("INSERT INTO usuarios (email, nombre, rol, password_hash) VALUES (?, 'Administración', 'admin', ?)")
    .run(email, hashPassword(password));
  console.warn(`⚠ Se creó la cuenta de administración ${email}${process.env.ADMIN_PASSWORD ? '' : ' con contraseña "genco-admin"'}. ` +
    'Cambiá la contraseña al ingresar.');
}
