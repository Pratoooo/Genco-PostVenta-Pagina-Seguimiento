// Pedidos de repuestos por siniestro: datos, etapas de seguimiento e historial.
import { db, transaction } from '../db/conexion.js';
import { HttpError, conflicto } from '../lib/errores.js';
import * as norm from '../lib/normalizar.js';
import { ROLES } from './usuarios.js';

export const ORIGENES = { stock: 'Stock disponible', fabrica: 'Pedido a fábrica' };
export const DESPACHOS = { parcial: 'Despacho parcial', total: 'Despacho total' };
export const TRANSPORTES = { angeleri: 'Angeleri', andreani: 'Andreani', sendbox: 'Sendbox' };
export const ENTREGAS = { en_camino: 'En camino', recibido: 'Recibido' };

// Pedido con los nombres del taller y del perito asignados.
const SELECT = `
  SELECT p.*, COALESCE(NULLIF(t.empresa, ''), t.nombre, NULLIF(p.taller, ''), '') AS taller_nombre,
    COALESCE(pe.nombre, '') AS perito_nombre
  FROM pedidos p
  LEFT JOIN usuarios t ON t.id = p.taller_id
  LEFT JOIN usuarios pe ON pe.id = p.perito_id`;

export function obtener(id) {
  const p = db.prepare(`${SELECT} WHERE p.id = ?`).get(id);
  if (!p) throw new HttpError(404, 'Pedido no encontrado. Puede que otra persona lo haya eliminado.');
  return p;
}

export const buscarPorSiniestroYPatente = (siniestro, patente) =>
  db.prepare(`${SELECT} WHERE p.siniestro = ? AND p.patente = ?`).get(siniestro, patente);

export function listar(q = '') {
  const like = `%${q}%`;
  return db
    .prepare(`${SELECT}
      WHERE ? = '' OR p.siniestro LIKE ? OR p.patente LIKE ? OR p.compania LIKE ? OR p.taller LIKE ?
         OR t.nombre LIKE ? OR t.empresa LIKE ? OR pe.nombre LIKE ?
      ORDER BY p.updated_at DESC LIMIT 300`)
    .all(q, like, `%${norm.patente(q)}%`, like, like, like, like, like);
}

// Pedidos asignados a un taller o a un perito.
const columnaAsignacion = (usuario) => (usuario.rol === 'perito' ? 'perito_id' : 'taller_id');

export const listarAsignados = (usuario) =>
  db.prepare(`${SELECT} WHERE p.${columnaAsignacion(usuario)} = ? ORDER BY p.updated_at DESC`).all(usuario.id);

export const estaAsignado = (pedido, usuario) => pedido[columnaAsignacion(usuario)] === usuario.id;

// ---------------------------------------------------------------- Seguimiento

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

const datos = (p) => ({
  id: p.id,
  siniestro: p.siniestro,
  patente: p.patente,
  vehiculo: p.vehiculo,
  taller: p.taller_nombre,
  perito: p.perito_nombre,
  compania: p.compania,
  cantidad_piezas: p.cantidad_piezas,
});

// Todo lo que muestra la pantalla de seguimiento.
export const seguimiento = (p) => ({
  pedido: datos(p),
  ...etapas(p),
  estado_viaje: p.estado_viaje,
  actualizado: p.updated_at,
  eventos: db.prepare('SELECT descripcion, fecha FROM eventos WHERE pedido_id = ? ORDER BY id DESC').all(p.id),
});

// Fila de los listados.
export function resumen(p) {
  const { etapa_actual, recibido, estado } = etapas(p);
  return { ...datos(p), etapa_actual, recibido, estado, updated_at: p.updated_at };
}

// ---------------------------------------------------------------- Alta y modificación

function opcion(valor, permitidas, nombre) {
  const v = norm.texto(valor);
  if (v && !(v in permitidas)) throw new HttpError(400, `${nombre} inválido`);
  return v;
}

function idUsuario(valor, rol) {
  if (valor === '' || valor == null) return null;
  const u = db.prepare('SELECT id FROM usuarios WHERE id = ? AND rol = ?').get(Number(valor), rol);
  if (!u) throw new HttpError(400, `${ROLES[rol]} inválido`);
  return u.id;
}

const CAMPOS = ['siniestro', 'patente', 'taller_id', 'perito_id', 'compania', 'vehiculo', 'cantidad_piezas',
  'origen', 'remito', 'despacho', 'transporte', 'guia', 'estado_viaje', 'entrega'];

// Valida los datos del formulario de pedido.
export function leer(b = {}) {
  const d = {
    siniestro: norm.texto(b.siniestro),
    patente: norm.patente(b.patente),
    taller_id: idUsuario(b.taller_id, 'taller'),
    perito_id: idUsuario(b.perito_id, 'perito'),
    compania: norm.texto(b.compania),
    vehiculo: norm.texto(b.vehiculo),
    cantidad_piezas: b.cantidad_piezas === '' || b.cantidad_piezas == null ? null : Number.parseInt(b.cantidad_piezas, 10),
    origen: opcion(b.origen, ORIGENES, 'Origen'),
    remito: norm.texto(b.remito),
    despacho: opcion(b.despacho, DESPACHOS, 'Despacho'),
    transporte: opcion(b.transporte, TRANSPORTES, 'Expreso'),
    guia: norm.texto(b.guia),
    estado_viaje: norm.texto(b.estado_viaje),
    entrega: opcion(b.entrega, ENTREGAS, 'Entrega'),
  };
  if (!d.siniestro) throw new HttpError(400, 'Falta el número de siniestro');
  if (!/^[A-Z0-9]{5,8}$/.test(d.patente)) throw new HttpError(400, 'La patente no parece válida (ej: AB123CD o ABC123)');
  if (d.cantidad_piezas !== null && !(d.cantidad_piezas >= 0)) throw new HttpError(400, 'Cantidad de piezas inválida');
  return d;
}

function validarSiniestroLibre(siniestro, idActual = null) {
  const otro = db.prepare('SELECT id FROM pedidos WHERE siniestro = ?').get(siniestro);
  if (otro && otro.id !== idActual) throw new HttpError(409, 'Ya existe un pedido con ese número de siniestro.');
}

const registrarEvento = (pedidoId, descripcion) =>
  db.prepare('INSERT INTO eventos (pedido_id, descripcion) VALUES (?, ?)').run(pedidoId, descripcion);

// Anota en el historial los cambios de estado que ven el cliente, el taller y el perito.
function registrarCambios(id, antes, d) {
  const cambio = (...campos) => campos.some((c) => (antes[c] ?? '') !== (d[c] ?? ''));
  if (cambio('origen') && d.origen) registrarEvento(id, ORIGENES[d.origen]);
  if (cambio('despacho', 'remito') && (d.despacho || d.remito)) {
    registrarEvento(id, [DESPACHOS[d.despacho] || 'Despacho', d.remito && `remito ${d.remito}`].filter(Boolean).join(' — '));
  }
  if (cambio('transporte', 'guia') && (d.transporte || d.guia)) {
    registrarEvento(id, [`Enviado por ${TRANSPORTES[d.transporte] || 'expreso'}`, d.guia && `guía ${d.guia}`].filter(Boolean).join(', '));
  }
  if (cambio('estado_viaje') && d.estado_viaje) registrarEvento(id, d.estado_viaje);
  if (cambio('entrega') && d.entrega) registrarEvento(id, ENTREGAS[d.entrega]);
}

export function crear(d) {
  validarSiniestroLibre(d.siniestro);
  const id = transaction(() => {
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO pedidos (${CAMPOS.join(', ')}) VALUES (${CAMPOS.map(() => '?').join(', ')})`)
      .run(...CAMPOS.map((c) => d[c]));
    registrarEvento(lastInsertRowid, 'Pedido registrado');
    registrarCambios(lastInsertRowid, {}, d);
    return lastInsertRowid;
  });
  return obtener(id);
}

// `version` es la que tenía el formulario al abrirse: si cambió, otra persona guardó en el medio.
export function actualizar(id, d, version) {
  const antes = obtener(id);
  validarSiniestroLibre(d.siniestro, antes.id);
  transaction(() => {
    const { changes } = db
      .prepare(`UPDATE pedidos SET ${CAMPOS.map((c) => `${c} = ?`).join(', ')}, version = version + 1, updated_at = datetime('now')
                WHERE id = ? AND version = ?`)
      .run(...CAMPOS.map((c) => d[c]), antes.id, version ?? antes.version);
    if (!changes) throw conflicto('este pedido');
    registrarCambios(antes.id, antes, d);
  });
  return obtener(antes.id);
}

export function eliminar(id) {
  db.prepare('DELETE FROM pedidos WHERE id = ?').run(obtener(id).id);
}
