import express from 'express';
import crypto from 'node:crypto';
import { db, logEvento, transaction } from './db.js';
import {
  ROLES, HASH_FALSO, hashPassword, verifyPassword, crearSesion, cerrarSesion,
  requireRol, usuarioPublico, asegurarAdmin,
} from './auth.js';
import { enviarMail } from './mailer.js';

const PORT = process.env.PORT || 3000;
// Dirección pública de la página, para armar los enlaces de los mails.
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
asegurarAdmin();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json());
// Al entrar a la página se pide iniciar sesión.
app.get('/', (req, res) => res.redirect('/login'));
app.use(express.static('public', { extensions: ['html'], index: false }));

const ORIGENES = { stock: 'Stock disponible', fabrica: 'Pedido a fábrica' };
const DESPACHOS = { parcial: 'Despacho parcial', total: 'Despacho total' };
const TRANSPORTES = { angeleri: 'Angeleri', andreani: 'Andreani', sendbox: 'Sendbox' };
const ENTREGAS = { en_camino: 'En camino', recibido: 'Recibido' };
const DESTINOS = { admin: '/admin', perito: '/mis-pedidos', taller: '/mis-pedidos' };

const normPatente = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normTexto = (s) => String(s ?? '').trim();
const normUsuario = (s) => String(s ?? '').trim().toLowerCase();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Pedido con los nombres del taller y el perito asignados.
const SELECT_PEDIDO = `
  SELECT p.*, COALESCE(NULLIF(t.empresa, ''), t.nombre, NULLIF(p.taller, ''), '') AS taller_nombre,
    COALESCE(pe.nombre, '') AS perito_nombre
  FROM pedidos p
  LEFT JOIN usuarios t ON t.id = p.taller_id
  LEFT JOIN usuarios pe ON pe.id = p.perito_id`;

function getPedido(id) {
  const pedido = db.prepare(`${SELECT_PEDIDO} WHERE p.id = ?`).get(id);
  if (!pedido) throw new HttpError(404, 'Pedido no encontrado');
  return pedido;
}

// Las 4 etapas: Origen -> Despacho (remito) -> Expreso (guía) -> En camino / Recibido
function etapas(p) {
  const recibido = p.entrega === 'recibido';
  const lista = [
    {
      titulo: ORIGENES[p.origen] || 'Pedido a fábrica / Stock',
      alcanzada: Boolean(p.origen),
      detalle: p.origen ? '' : 'Estamos verificando la disponibilidad de las piezas.',
    },
    {
      titulo: DESPACHOS[p.despacho] || 'Despacho',
      alcanzada: Boolean(p.despacho || p.remito),
      detalle: p.remito ? `Remito ${p.remito}` : '',
    },
    {
      titulo: 'Expreso',
      alcanzada: Boolean(p.transporte || p.guia),
      detalle: [TRANSPORTES[p.transporte], p.guia && `Guía ${p.guia}`].filter(Boolean).join(' · '),
    },
    {
      titulo: recibido ? 'Recibido' : 'En camino',
      alcanzada: Boolean(p.entrega),
      detalle: '',
    },
  ];
  const actual = recibido ? lista.length : Math.max(0, lista.findLastIndex((e) => e.alcanzada));
  const estado = recibido ? 'Recibido' : lista[actual].alcanzada ? lista[actual].titulo : 'En revisión';
  return { etapas: lista, etapa_actual: actual, recibido, estado };
}

function datosPedido(p) {
  return {
    id: p.id,
    siniestro: p.siniestro,
    patente: p.patente,
    vehiculo: p.vehiculo,
    taller: p.taller_nombre,
    perito: p.perito_nombre,
    compania: p.compania,
    cantidad_piezas: p.cantidad_piezas,
  };
}

function seguimiento(p) {
  return {
    pedido: datosPedido(p),
    ...etapas(p),
    estado_viaje: p.estado_viaje,
    actualizado: p.updated_at,
    eventos: db.prepare('SELECT descripcion, fecha FROM eventos WHERE pedido_id = ? ORDER BY id DESC').all(p.id),
  };
}

// Fila para los listados (portal y admin).
function resumen(p) {
  const { etapa_actual, recibido, estado } = etapas(p);
  return { ...datosPedido(p), etapa_actual, recibido, estado, updated_at: p.updated_at };
}

// ---------------------------------------------------------------- Público

// Por POST para que siniestro y patente no queden en la URL ni en logs.
app.post('/api/seguimiento', (req, res) => {
  const siniestro = normTexto(req.body?.siniestro);
  const patente = normPatente(req.body?.patente);
  if (!siniestro || !patente) throw new HttpError(400, 'Ingresá el número de siniestro y la patente.');
  const pedido = db.prepare(`${SELECT_PEDIDO} WHERE p.siniestro = ? AND p.patente = ?`).get(siniestro, patente);
  if (!pedido) throw new HttpError(404, 'No encontramos un pedido con ese siniestro y patente. Revisá los datos o consultá con tu taller.');
  res.json(seguimiento(pedido));
});

// ---------------------------------------------------------------- Sesión

// Límite simple en memoria: como mucho `max` eventos por clave dentro de la ventana.
function limitador(max, ventanaMs, mensaje) {
  const registros = new Map();
  const vigente = (clave) => {
    const r = registros.get(clave);
    if (r && Date.now() - r.desde > ventanaMs) registros.delete(clave);
    return registros.get(clave);
  };
  return {
    controlar(clave) {
      if ((vigente(clave)?.n ?? 0) >= max) throw new HttpError(429, mensaje);
    },
    sumar(clave) {
      const r = vigente(clave) ?? { n: 0, desde: Date.now() };
      r.n++;
      registros.set(clave, r);
    },
    limpiar: (clave) => registros.delete(clave),
  };
}

const MIN = 60 * 1000;
const loginsFallidos = limitador(8, 15 * MIN, 'Demasiados intentos fallidos. Probá de nuevo en 15 minutos.');
const registros = limitador(10, 60 * MIN, 'Se crearon demasiadas cuentas desde esta conexión. Probá de nuevo más tarde.');
const recuperaciones = limitador(5, 15 * MIN, 'Demasiadas solicitudes. Probá de nuevo en 15 minutos.');

// Se puede ingresar con el nombre de usuario o con el email.
const buscarPorUsuarioOEmail = (valor) =>
  db.prepare('SELECT * FROM usuarios WHERE usuario = ? OR email = ?').get(valor, valor);

app.post('/api/auth/login', (req, res) => {
  const usuario = normUsuario(req.body?.usuario);
  const password = String(req.body?.password ?? '');
  if (!usuario || !password) throw new HttpError(400, 'Ingresá tu usuario y contraseña.');

  const clave = `${req.ip}|${usuario}`;
  loginsFallidos.controlar(clave);
  const u = buscarPorUsuarioOEmail(usuario);
  if (!verifyPassword(password, u?.password_hash ?? HASH_FALSO) || !u) {
    loginsFallidos.sumar(clave);
    throw new HttpError(401, 'Usuario o contraseña incorrectos.');
  }
  if (!u.aprobado) throw new HttpError(403, 'Tu cuenta todavía está pendiente de aprobación. Genco la va a habilitar a la brevedad.');
  if (!u.activo) throw new HttpError(403, 'Tu usuario está desactivado. Consultá con Genco.');

  loginsFallidos.limpiar(clave);
  crearSesion(res, u);
  res.json({ usuario: usuarioPublico(u), destino: DESTINOS[u.rol] });
});

// Registro de talleres y peritos. La cuenta queda pendiente hasta que un admin la aprueba.
app.post('/api/auth/registro', (req, res) => {
  registros.controlar(req.ip);
  const rol = normTexto(req.body?.rol);
  if (!['taller', 'perito'].includes(rol)) throw new HttpError(400, 'Elegí si sos taller o perito.');
  const { d, password } = leerUsuario({ ...req.body, rol, activo: true }, { nuevo: true, registro: true });
  validarUnicos(d);
  db.prepare('INSERT INTO usuarios (usuario, nombre, empresa, email, rol, password_hash, aprobado) VALUES (?, ?, ?, ?, ?, ?, 0)')
    .run(d.usuario, d.nombre, d.empresa, d.email, d.rol, hashPassword(password));
  registros.sumar(req.ip);
  res.status(201).json({ ok: true, nombre: d.nombre, usuario: d.usuario, rol_nombre: ROLES[d.rol] });
});

// ---------------------------------------------------------------- Recuperar contraseña

const RECUPERACION_MS = 60 * MIN;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Siempre responde lo mismo, exista o no la cuenta, para no revelar quién está registrado.
app.post('/api/auth/recuperar', async (req, res) => {
  const valor = normUsuario(req.body?.usuario);
  if (!valor) throw new HttpError(400, 'Ingresá tu usuario o email.');
  recuperaciones.controlar(req.ip);
  recuperaciones.sumar(req.ip);

  const u = buscarPorUsuarioOEmail(valor);
  if (u?.email && u.activo) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM recuperaciones WHERE usuario_id = ? OR expira < ?').run(u.id, Date.now());
    db.prepare('INSERT INTO recuperaciones (usuario_id, token_hash, expira) VALUES (?, ?, ?)')
      .run(u.id, hashToken(token), Date.now() + RECUPERACION_MS);
    // El token va después del "#": el navegador no lo manda al servidor ni queda en logs.
    const enlace = `${APP_URL}/login#restablecer=${token}`;
    try {
      await enviarMail({
        para: u.email,
        asunto: 'Recuperar tu contraseña — Grupo Genco Siniestros',
        texto: `Hola ${u.nombre}:\n\nPediste crear una nueva contraseña para tu usuario "${u.usuario}".\n` +
          `Entrá a este enlace (vence en 1 hora):\n\n${enlace}\n\nSi no fuiste vos, ignorá este mensaje.\n\nGrupo Genco · Siniestros`,
        html: `<p>Hola ${escHtml(u.nombre)}:</p>
          <p>Pediste crear una nueva contraseña para tu usuario <strong>${escHtml(u.usuario)}</strong>.</p>
          <p><a href="${enlace}" style="display:inline-block;padding:12px 20px;background:#253883;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Crear nueva contraseña</a></p>
          <p style="color:#5d6680;font-size:13px">El enlace vence en 1 hora. Si no fuiste vos, ignorá este mensaje.</p>
          <p style="color:#5d6680;font-size:13px">Grupo Genco · Siniestros</p>`,
      });
    } catch (err) {
      console.error('No se pudo enviar el mail de recuperación:', err.message);
    }
  }
  res.json({ ok: true });
});

app.post('/api/auth/restablecer', (req, res) => {
  const token = String(req.body?.token ?? '');
  const password = String(req.body?.password ?? '');
  const rec = token && db.prepare('SELECT * FROM recuperaciones WHERE token_hash = ?').get(hashToken(token));
  if (!rec || rec.usado || rec.expira < Date.now()) {
    throw new HttpError(400, 'El enlace no es válido o ya venció. Pedí uno nuevo desde "¿Olvidaste tu contraseña?".');
  }
  validarPassword(password);
  transaction(() => {
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hashPassword(password), rec.usuario_id);
    db.prepare('DELETE FROM recuperaciones WHERE usuario_id = ?').run(rec.usuario_id);
  });
  // Por si la IP había quedado bloqueada por intentos fallidos.
  const u = db.prepare('SELECT usuario FROM usuarios WHERE id = ?').get(rec.usuario_id);
  loginsFallidos.limpiar(`${req.ip}|${u.usuario}`);
  res.json({ ok: true, usuario: u.usuario });
});

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

app.post('/api/auth/logout', (req, res) => {
  cerrarSesion(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireRol(), (req, res) => {
  res.json({ ...usuarioPublico(req.usuario), destino: DESTINOS[req.usuario.rol] });
});

app.post('/api/auth/password', requireRol(), (req, res) => {
  const actual = String(req.body?.actual ?? '');
  const nueva = String(req.body?.nueva ?? '');
  if (!verifyPassword(actual, req.usuario.password_hash)) throw new HttpError(400, 'La contraseña actual no es correcta.');
  validarPassword(nueva);
  const hash = hashPassword(nueva);
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hash, req.usuario.id);
  crearSesion(res, { ...req.usuario, password_hash: hash });
  res.json({ ok: true });
});

function validarPassword(pw) {
  if (pw.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres.');
}

// ---------------------------------------------------------------- Portal de peritos y talleres

const columnaAsignacion = (u) => (u.rol === 'perito' ? 'perito_id' : 'taller_id');

app.get('/api/mis-pedidos', requireRol('perito', 'taller'), (req, res) => {
  const rows = db
    .prepare(`${SELECT_PEDIDO} WHERE p.${columnaAsignacion(req.usuario)} = ? ORDER BY p.updated_at DESC`)
    .all(req.usuario.id);
  res.json(rows.map(resumen));
});

app.get('/api/mis-pedidos/:id', requireRol('perito', 'taller'), (req, res) => {
  const pedido = getPedido(req.params.id);
  if (pedido[columnaAsignacion(req.usuario)] !== req.usuario.id) throw new HttpError(404, 'Pedido no encontrado');
  res.json(seguimiento(pedido));
});

// ---------------------------------------------------------------- Admin: pedidos

app.use('/api/admin', requireRol('admin'));

app.get('/api/admin/opciones', (req, res) => {
  // Talleres ordenados por nombre del taller; peritos por nombre de la persona.
  const usuariosDeRol = (rol, orden) =>
    db.prepare(`SELECT id, usuario, nombre, empresa, activo FROM usuarios WHERE rol = ? AND aprobado = 1
      ORDER BY ${orden} COLLATE NOCASE`).all(rol);
  res.json({
    origenes: ORIGENES,
    despachos: DESPACHOS,
    transportes: TRANSPORTES,
    entregas: ENTREGAS,
    roles: ROLES,
    talleres: usuariosDeRol('taller', "COALESCE(NULLIF(empresa, ''), nombre)"),
    peritos: usuariosDeRol('perito', 'nombre'),
    pendientes: db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE aprobado = 0').get().n,
  });
});

app.get('/api/admin/pedidos', (req, res) => {
  const q = normTexto(req.query.q);
  const like = `%${q}%`;
  const rows = db
    .prepare(
      `${SELECT_PEDIDO}
       WHERE ? = '' OR p.siniestro LIKE ? OR p.patente LIKE ? OR p.compania LIKE ? OR p.taller LIKE ?
          OR t.nombre LIKE ? OR pe.nombre LIKE ?
       ORDER BY p.updated_at DESC LIMIT 300`,
    )
    .all(q, like, `%${normPatente(q)}%`, like, like, like, like);
  res.json(rows.map(resumen));
});

app.get('/api/admin/pedidos/:id', (req, res) => {
  const pedido = getPedido(req.params.id);
  res.json({ ...pedido, seguimiento: seguimiento(pedido) });
});

function opcion(valor, permitidas, nombre) {
  const v = normTexto(valor);
  if (v && !(v in permitidas)) throw new HttpError(400, `${nombre} inválido`);
  return v;
}

function idUsuario(valor, rol) {
  if (valor === '' || valor == null) return null;
  const u = db.prepare('SELECT id FROM usuarios WHERE id = ? AND rol = ?').get(Number(valor), rol);
  if (!u) throw new HttpError(400, `${ROLES[rol]} inválido`);
  return u.id;
}

function leerPedido(b = {}) {
  const d = {
    siniestro: normTexto(b.siniestro),
    patente: normPatente(b.patente),
    taller_id: idUsuario(b.taller_id, 'taller'),
    perito_id: idUsuario(b.perito_id, 'perito'),
    compania: normTexto(b.compania),
    vehiculo: normTexto(b.vehiculo),
    cantidad_piezas: b.cantidad_piezas === '' || b.cantidad_piezas == null ? null : Number.parseInt(b.cantidad_piezas, 10),
    origen: opcion(b.origen, ORIGENES, 'Origen'),
    remito: normTexto(b.remito),
    despacho: opcion(b.despacho, DESPACHOS, 'Despacho'),
    transporte: opcion(b.transporte, TRANSPORTES, 'Expreso'),
    guia: normTexto(b.guia),
    estado_viaje: normTexto(b.estado_viaje),
    entrega: opcion(b.entrega, ENTREGAS, 'Entrega'),
  };
  if (!d.siniestro) throw new HttpError(400, 'Falta el número de siniestro');
  if (!/^[A-Z0-9]{5,8}$/.test(d.patente)) throw new HttpError(400, 'La patente no parece válida (ej: AB123CD o ABC123)');
  if (d.cantidad_piezas !== null && !(d.cantidad_piezas >= 0)) throw new HttpError(400, 'Cantidad de piezas inválida');
  const otro = db.prepare('SELECT id FROM pedidos WHERE siniestro = ?').get(d.siniestro);
  return { d, otro };
}

// Registra en el historial los cambios de estado que ve el cliente.
function registrarCambios(id, antes, d) {
  const cambio = (...campos) => campos.some((c) => (antes[c] ?? '') !== (d[c] ?? ''));
  if (cambio('origen') && d.origen) logEvento(id, ORIGENES[d.origen]);
  if (cambio('despacho', 'remito') && (d.despacho || d.remito)) {
    logEvento(id, [DESPACHOS[d.despacho] || 'Despacho', d.remito && `remito ${d.remito}`].filter(Boolean).join(' — '));
  }
  if (cambio('transporte', 'guia') && (d.transporte || d.guia)) {
    logEvento(id, [`Enviado por ${TRANSPORTES[d.transporte] || 'expreso'}`, d.guia && `guía ${d.guia}`].filter(Boolean).join(', '));
  }
  if (cambio('estado_viaje') && d.estado_viaje) logEvento(id, d.estado_viaje);
  if (cambio('entrega') && d.entrega) logEvento(id, ENTREGAS[d.entrega]);
}

const CAMPOS = ['siniestro', 'patente', 'taller_id', 'perito_id', 'compania', 'vehiculo', 'cantidad_piezas',
  'origen', 'remito', 'despacho', 'transporte', 'guia', 'estado_viaje', 'entrega'];

app.post('/api/admin/pedidos', (req, res) => {
  const { d, otro } = leerPedido(req.body);
  if (otro) throw new HttpError(409, 'Ya existe un pedido con ese número de siniestro');
  const id = transaction(() => {
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO pedidos (${CAMPOS.join(', ')}) VALUES (${CAMPOS.map(() => '?').join(', ')})`)
      .run(...CAMPOS.map((c) => d[c]));
    logEvento(lastInsertRowid, 'Pedido registrado');
    registrarCambios(lastInsertRowid, {}, d);
    return lastInsertRowid;
  });
  res.status(201).json(getPedido(id));
});

app.put('/api/admin/pedidos/:id', (req, res) => {
  const antes = getPedido(req.params.id);
  const { d, otro } = leerPedido(req.body);
  if (otro && otro.id !== antes.id) throw new HttpError(409, 'Ya existe otro pedido con ese número de siniestro');
  transaction(() => {
    db.prepare(`UPDATE pedidos SET ${CAMPOS.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...CAMPOS.map((c) => d[c]), antes.id);
    registrarCambios(antes.id, antes, d);
  });
  res.json(getPedido(antes.id));
});

app.delete('/api/admin/pedidos/:id', (req, res) => {
  db.prepare('DELETE FROM pedidos WHERE id = ?').run(getPedido(req.params.id).id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Admin: usuarios

const SELECT_USUARIO = `
  SELECT u.id, u.usuario, u.nombre, u.empresa, u.email, u.rol, u.activo, u.aprobado, u.created_at,
    (SELECT COUNT(*) FROM pedidos p WHERE p.taller_id = u.id OR p.perito_id = u.id) AS pedidos
  FROM usuarios u`;

function getUsuario(id) {
  const u = db.prepare(`${SELECT_USUARIO} WHERE u.id = ?`).get(id);
  if (!u) throw new HttpError(404, 'Usuario no encontrado');
  return u;
}

const adminsActivos = () => db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1").get().n;

// Peritos: pueden trabajar para varias compañías; se guardan como "La Segunda, Zurich".
function normCompanias(s) {
  const unicas = new Map();
  for (const c of String(s ?? '').split(',').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean)) {
    const clave = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (!unicas.has(clave)) unicas.set(clave, c);
  }
  return [...unicas.values()].join(', ');
}

// nuevo: la contraseña es obligatoria.
// registro: el usuario se registra solo (email obligatorio; el taller pone su nombre; el perito no
// carga compañías, se las asigna un admin).
function leerUsuario(b = {}, { nuevo = false, registro = false } = {}) {
  const d = {
    usuario: normUsuario(b.usuario),
    nombre: normTexto(b.nombre),
    rol: normTexto(b.rol),
    empresa: normTexto(b.empresa),
    email: normUsuario(b.email) || null,
    activo: b.activo === undefined ? 1 : b.activo ? 1 : 0,
  };
  if (!ROLES[d.rol]) throw new HttpError(400, 'Rol inválido');
  if (d.rol === 'admin' || (registro && d.rol === 'perito')) d.empresa = '';
  if (d.rol === 'perito') d.empresa = normCompanias(d.empresa);
  if (!d.nombre) throw new HttpError(400, 'Ingresá el nombre y apellido.');
  if (registro && d.rol === 'taller' && !d.empresa) throw new HttpError(400, 'Ingresá el nombre del taller.');
  if (registro && !d.email) throw new HttpError(400, 'Ingresá tu email. Lo vas a necesitar si te olvidás la contraseña.');
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) throw new HttpError(400, 'El email no parece válido.');
  if (!/^[a-z0-9._-]{3,40}$/.test(d.usuario)) {
    throw new HttpError(400, 'El nombre de usuario debe tener entre 3 y 40 caracteres: letras, números, punto o guion, sin espacios.');
  }
  const password = String(b.password ?? '');
  if (nuevo || password) validarPassword(password);
  return { d, password };
}

// Usuario y email no pueden repetirse (tampoco cruzados: se puede ingresar con cualquiera de los dos).
function validarUnicos(d, idActual = null) {
  const choca = (sql, ...params) => {
    const fila = db.prepare(sql).get(...params);
    return fila && fila.id !== idActual;
  };
  if (choca('SELECT id FROM usuarios WHERE usuario = ? OR email = ?', d.usuario, d.usuario)) {
    throw new HttpError(409, 'Ese nombre de usuario ya está en uso. Probá con otro.');
  }
  if (d.email && choca('SELECT id FROM usuarios WHERE email = ? OR usuario = ?', d.email, d.email)) {
    throw new HttpError(409, 'Ya existe una cuenta con ese email.');
  }
}

app.get('/api/admin/usuarios', (req, res) => {
  res.json(db.prepare(`${SELECT_USUARIO} ORDER BY u.activo DESC, u.rol, u.nombre`).all());
});

app.get('/api/admin/usuarios/:id', (req, res) => res.json(getUsuario(req.params.id)));

app.post('/api/admin/usuarios', (req, res) => {
  const { d, password } = leerUsuario(req.body, { nuevo: true });
  validarUnicos(d);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO usuarios (usuario, nombre, empresa, email, rol, activo, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(d.usuario, d.nombre, d.empresa, d.email, d.rol, d.activo, hashPassword(password));
  res.status(201).json(getUsuario(lastInsertRowid));
});

app.put('/api/admin/usuarios/:id', (req, res) => {
  const antes = getUsuario(req.params.id);
  const { d, password } = leerUsuario(req.body);
  validarUnicos(d, antes.id);
  const esYo = antes.id === req.usuario.id;
  if (esYo && (d.rol !== 'admin' || !d.activo)) throw new HttpError(400, 'No podés quitarte el rol de administrador ni desactivarte.');
  if (antes.rol !== d.rol && antes.pedidos > 0) {
    throw new HttpError(400, `No se puede cambiar el rol: tiene ${antes.pedidos} pedido(s) asignado(s).`);
  }
  if (antes.rol === 'admin' && antes.activo && (d.rol !== 'admin' || !d.activo) && adminsActivos() <= 1) {
    throw new HttpError(400, 'Tiene que quedar al menos un administrador activo.');
  }
  db.prepare('UPDATE usuarios SET usuario = ?, nombre = ?, empresa = ?, email = ?, rol = ?, activo = ? WHERE id = ?')
    .run(d.usuario, d.nombre, d.empresa, d.email, d.rol, d.activo, antes.id);
  if (password) {
    const hash = hashPassword(password);
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hash, antes.id);
    if (esYo) crearSesion(res, { id: antes.id, password_hash: hash });
  }
  res.json(getUsuario(antes.id));
});

app.post('/api/admin/usuarios/:id/aprobar', (req, res) => {
  const u = getUsuario(req.params.id);
  db.prepare('UPDATE usuarios SET aprobado = 1 WHERE id = ?').run(u.id);
  res.json(getUsuario(u.id));
});

app.delete('/api/admin/usuarios/:id', (req, res) => {
  const u = getUsuario(req.params.id);
  if (u.id === req.usuario.id) throw new HttpError(400, 'No podés eliminar tu propio usuario.');
  if (u.rol === 'admin' && u.activo && adminsActivos() <= 1) throw new HttpError(400, 'Tiene que quedar al menos un administrador activo.');
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(u.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Errores

app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => console.log(`Genco Siniestros escuchando en http://localhost:${PORT}`));
