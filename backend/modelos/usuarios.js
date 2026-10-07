// Cuentas de administradores, talleres y peritos. Se ingresa con el email.
import { db, transaction } from '../db/conexion.js';
import { config } from '../config.js';
import { HttpError, conflicto } from '../lib/errores.js';
import { hashPassword, validarPassword, verifyPassword } from '../lib/auth.js';
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
  cambiar_password: Boolean(u.cambiar_password),
});

// Valida los datos de un formulario de usuario. Solo los talleres llevan "empresa" (el nombre del taller).
//   nuevo: la contraseña es obligatoria.
//   registro: se registra desde la página (el nombre del taller es obligatorio).
export function leer(b = {}, { nuevo = false, registro = false } = {}) {
  const d = {
    email: norm.email(b.email),
    nombre: norm.texto(b.nombre, 100),
    rol: norm.texto(b.rol),
    empresa: norm.texto(b.empresa, 120),
    activo: b.activo === undefined ? 1 : b.activo ? 1 : 0,
  };
  if (!ROLES[d.rol]) throw new HttpError(400, 'Rol inválido');
  if (d.rol !== 'taller') d.empresa = '';
  if (!d.nombre) throw new HttpError(400, 'Ingresá el nombre y apellido.');
  if (registro && d.rol === 'taller' && !d.empresa) throw new HttpError(400, 'Ingresá el nombre del taller.');
  if (!d.email) throw new HttpError(400, 'Ingresá el email.');
  if (!norm.esEmail(d.email)) throw new HttpError(400, 'El email no parece válido.');
  const password = String(b.password ?? '');
  if (nuevo || password) validarPassword(password, { email: d.email });
  return { d, password };
}

function validarEmailLibre(email, idActual = null) {
  const otro = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (otro && otro.id !== idActual) throw new HttpError(409, 'Ya existe una cuenta con ese email.', 'email');
}

const adminsActivos = () => db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1").get().n;

// cambiarPassword: la cuenta la crea un admin, que conoce la contraseña; la persona la cambia al ingresar.
export function crear(d, password, { aprobado = true, cambiarPassword = false } = {}) {
  validarEmailLibre(d.email);
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO usuarios (email, nombre, empresa, rol, activo, aprobado, password_hash, cambiar_password)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(d.email, d.nombre, d.empresa, d.rol, d.activo, aprobado ? 1 : 0, hashPassword(password), cambiarPassword ? 1 : 0);
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
      // Si un admin le pone la contraseña a otra persona, esa persona la tiene que cambiar al ingresar.
      nuevoHash = hashPassword(password);
      db.prepare('UPDATE usuarios SET password_hash = ?, cambiar_password = ? WHERE id = ?')
        .run(nuevoHash, editor.id === antes.id ? 0 : 1, antes.id);
    }
  });
  return { usuario: obtener(antes.id), nuevoHash };
}

// La persona cambia su propia contraseña (desde su menú o con el enlace de recuperación).
export function cambiarPassword(id, password) {
  const { email } = db.prepare('SELECT email FROM usuarios WHERE id = ?').get(id) ?? {};
  validarPassword(password, { email });
  const hash = hashPassword(password);
  db.prepare('UPDATE usuarios SET password_hash = ?, cambiar_password = 0, version = version + 1 WHERE id = ?').run(hash, id);
  return hash;
}

// Actualiza el hash de una contraseña vieja a los parámetros actuales (al ingresar, con la contraseña correcta).
export function actualizarHash(id, password) {
  const hash = hashPassword(password);
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hash, id);
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

// Primer arranque: crea la cuenta de administración si no hay ninguna (con cambio de contraseña obligatorio).
// Además, cualquier administrador que siga con la contraseña inicial queda obligado a cambiarla.
export function asegurarAdmin() {
  const { email, password } = config.admin;
  if (!db.prepare("SELECT 1 FROM usuarios WHERE rol = 'admin'").get()) {
    db.prepare("INSERT INTO usuarios (email, nombre, rol, password_hash, cambiar_password) VALUES (?, 'Administración', 'admin', ?, 1)")
      .run(email, hashPassword(password));
    console.warn(`⚠ Se creó la cuenta de administración ${email}. Al ingresar por primera vez hay que cambiar la contraseña.`);
  }
  const iniciales = new Set(['genco-admin', password]);
  for (const a of db.prepare("SELECT id, email, password_hash FROM usuarios WHERE rol = 'admin' AND cambiar_password = 0").all()) {
    if ([...iniciales].some((p) => verifyPassword(p, a.password_hash))) {
      db.prepare('UPDATE usuarios SET cambiar_password = 1 WHERE id = ?').run(a.id);
      console.warn(`⚠ La cuenta ${a.email} usa la contraseña inicial: al ingresar va a tener que cambiarla.`);
    }
  }
}
