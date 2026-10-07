// Pedidos de repuestos por siniestro: datos, envíos, etapas de seguimiento e historial.
//
// Un pedido puede salir en varios envíos: con despacho parcial se manda la parte que hay y lo que
// falta va después en otro envío, con su propio remito y número de guía.
import { db, transaction } from '../db/conexion.js';
import { HttpError, conflicto } from '../lib/errores.js';
import * as norm from '../lib/normalizar.js';
import { ROLES } from './usuarios.js';

export const ORIGENES = { stock: 'Stock disponible', fabrica: 'Pedido a fábrica' };
export const DESPACHOS = { parcial: 'Parcial (falta enviar una parte)', total: 'Completo (se envió todo)' };
export const TRANSPORTES = { angeleri: 'Angeleri', andreani: 'Andreani', sendbox: 'Sendbox' };
export const ENTREGAS = { en_camino: 'En camino', recibido: 'Recibido' };

const MAX_ENVIOS = 10;

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

const consultaEnvios = db.prepare('SELECT * FROM envios WHERE pedido_id = ? ORDER BY id');
export const listarEnvios = (pedidoId) => consultaEnvios.all(pedidoId);

export const buscarPorSiniestroYPatente = (siniestro, patente) =>
  db.prepare(`${SELECT} WHERE p.siniestro = ? AND p.patente = ?`).get(siniestro, patente);

// Búsqueda del panel: siniestro, patente, compañía, taller, perito, remito o número de guía.
export function listar(q = '') {
  const like = `%${q}%`;
  return db
    .prepare(`${SELECT}
      WHERE ? = '' OR p.siniestro LIKE ? OR p.patente LIKE ? OR p.compania LIKE ? OR p.taller LIKE ?
         OR t.nombre LIKE ? OR t.empresa LIKE ? OR pe.nombre LIKE ?
         OR EXISTS (SELECT 1 FROM envios e WHERE e.pedido_id = p.id AND (e.remito LIKE ? OR e.guia LIKE ?))
      ORDER BY p.updated_at DESC LIMIT 300`)
    .all(q, like, `%${norm.patente(q)}%`, like, like, like, like, like, like, like);
}

// Pedidos asignados a un taller o a un perito.
const columnaAsignacion = (usuario) => (usuario.rol === 'perito' ? 'perito_id' : 'taller_id');

export const listarAsignados = (usuario) =>
  db.prepare(`${SELECT} WHERE p.${columnaAsignacion(usuario)} = ? ORDER BY p.updated_at DESC`).all(usuario.id);

export const estaAsignado = (pedido, usuario) => pedido[columnaAsignacion(usuario)] === usuario.id;

// ---------------------------------------------------------------- Seguimiento

// Con más de un envío (o si el despacho es parcial) cada uno se nombra "Envío 1", "Envío 2"...
const variosEnvios = (p, envios) => envios.length > 1 || p.despacho === 'parcial';

// Las 4 etapas: Origen -> Despacho (remitos) -> Expreso (guías) -> En camino / Recibido
function etapas(p, envios) {
  const recibidos = envios.filter((e) => e.entrega === 'recibido').length;
  const completo = p.despacho === 'total';
  const recibido = completo && envios.length > 0 && recibidos === envios.length;
  const despachados = envios.filter((e) => e.transporte || e.guia);
  const remitos = envios.map((e) => e.remito).filter(Boolean);
  const falta = p.despacho === 'parcial' ? 'falta enviar una parte' : '';

  const lista = [
    {
      titulo: ORIGENES[p.origen] || 'Pedido a fábrica / Stock',
      alcanzada: Boolean(p.origen),
      detalle: p.origen ? '' : 'Estamos verificando la disponibilidad de las piezas.',
    },
    {
      titulo: p.despacho === 'parcial' ? 'Despacho parcial' : completo ? (envios.length > 1 ? 'Despacho completo' : 'Despacho total') : 'Despacho',
      alcanzada: Boolean(p.despacho || envios.length),
      detalle: [remitos.length && `${remitos.length > 1 ? 'Remitos' : 'Remito'} ${remitos.join(', ')}`, falta].filter(Boolean).join(' · '),
    },
    {
      titulo: 'Expreso',
      alcanzada: despachados.length > 0,
      detalle: variosEnvios(p, envios)
        ? (despachados.length ? `${despachados.length} ${despachados.length > 1 ? 'envíos despachados' : 'envío despachado'}` : '')
        : despachados.map((e) => [TRANSPORTES[e.transporte], e.guia && `Guía ${e.guia}`].filter(Boolean).join(' · ')).join(''),
    },
    {
      titulo: recibido ? 'Recibido' : recibidos ? 'Recibido en parte' : 'En camino',
      alcanzada: envios.some((e) => e.entrega),
      detalle: recibidos && !recibido ? [`${recibidos} de ${envios.length} ${envios.length > 1 ? 'envíos recibidos' : 'envío recibido'}`, falta].filter(Boolean).join(' · ') : '',
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

// Lo que se muestra de cada envío.
const envioPublico = (e) => ({
  remito: e.remito,
  transporte: TRANSPORTES[e.transporte] || '',
  guia: e.guia,
  estado_viaje: e.estado_viaje,
  recibido: e.entrega === 'recibido',
  estado: e.entrega ? ENTREGAS[e.entrega] : e.transporte || e.guia ? 'Despachado' : 'Preparando envío',
});

// Todo lo que muestra la pantalla de seguimiento.
export function seguimiento(p) {
  const envios = listarEnvios(p.id);
  return {
    pedido: datos(p),
    ...etapas(p, envios),
    despacho_parcial: p.despacho === 'parcial',
    envios: envios.map(envioPublico),
    actualizado: p.updated_at,
    eventos: db.prepare('SELECT descripcion, fecha FROM eventos WHERE pedido_id = ? ORDER BY id DESC').all(p.id),
  };
}

// Fila de los listados.
export function resumen(p) {
  const { etapa_actual, recibido, estado } = etapas(p, listarEnvios(p.id));
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

function leerEnvios(lista) {
  if (lista == null) return [];
  if (!Array.isArray(lista) || lista.length > MAX_ENVIOS) throw new HttpError(400, 'Envíos inválidos');
  return lista.map((e, i) => {
    const envio = {
      id: e?.id ? Number(e.id) : null,
      remito: norm.texto(e?.remito, 40),
      transporte: opcion(e?.transporte, TRANSPORTES, 'Expreso'),
      guia: norm.texto(e?.guia, 40),
      estado_viaje: norm.texto(e?.estado_viaje, 120),
      entrega: opcion(e?.entrega, ENTREGAS, 'Entrega'),
    };
    if (!envio.remito) throw new HttpError(400, `Falta el N° de remito del envío ${i + 1}.`);
    return envio;
  });
}

const CAMPOS = ['siniestro', 'patente', 'taller_id', 'perito_id', 'compania', 'vehiculo', 'cantidad_piezas', 'origen', 'despacho'];

// Valida los datos del formulario de pedido (incluidos sus envíos).
export function leer(b = {}) {
  const d = {
    siniestro: norm.texto(b.siniestro, 40),
    patente: norm.patente(b.patente),
    taller_id: idUsuario(b.taller_id, 'taller'),
    perito_id: idUsuario(b.perito_id, 'perito'),
    compania: norm.texto(b.compania, 100),
    vehiculo: norm.texto(b.vehiculo, 100),
    cantidad_piezas: b.cantidad_piezas === '' || b.cantidad_piezas == null ? null : Number.parseInt(b.cantidad_piezas, 10),
    origen: opcion(b.origen, ORIGENES, 'Origen'),
    despacho: opcion(b.despacho, DESPACHOS, 'Despacho'),
    envios: leerEnvios(b.envios),
  };
  if (!d.siniestro) throw new HttpError(400, 'Falta el número de siniestro');
  if (!/^[A-Z0-9]{5,8}$/.test(d.patente)) throw new HttpError(400, 'La patente no parece válida (ej: AB123CD o ABC123)');
  if (d.cantidad_piezas !== null && !(d.cantidad_piezas >= 0)) throw new HttpError(400, 'Cantidad de piezas inválida');
  if (d.envios.length && !d.despacho) throw new HttpError(400, 'Elegí si el despacho es parcial o completo.');
  return d;
}

function validarSiniestroLibre(siniestro, idActual = null) {
  const otro = db.prepare('SELECT id FROM pedidos WHERE siniestro = ?').get(siniestro);
  if (otro && otro.id !== idActual) throw new HttpError(409, 'Ya existe un pedido con ese número de siniestro.');
}

const registrarEvento = (pedidoId, descripcion) =>
  db.prepare('INSERT INTO eventos (pedido_id, descripcion) VALUES (?, ?)').run(pedidoId, descripcion);

const cambio = (antes, despues, ...campos) => campos.some((c) => (antes[c] ?? '') !== (despues[c] ?? ''));

// Anota en el historial los cambios que ven el cliente, el taller y el perito.
function registrarCambios(id, antes, d) {
  if (cambio(antes, d, 'origen') && d.origen) registrarEvento(id, ORIGENES[d.origen]);
  if (cambio(antes, d, 'despacho') && d.despacho) {
    registrarEvento(id, d.despacho === 'parcial' ? 'Despacho parcial: se envía una parte y lo que falta sale después'
      : d.envios.length > 1 ? 'Despacho completo: se envió todo el pedido' : 'Despacho total');
  }
}

function registrarCambiosEnvio(pedidoId, antes, e, nombre) {
  const anotar = (texto) => registrarEvento(pedidoId, nombre ? `${nombre} · ${texto}` : texto);
  if (cambio(antes, e, 'remito') && e.remito) anotar(`Remito ${e.remito}`);
  if (cambio(antes, e, 'transporte', 'guia') && (e.transporte || e.guia)) {
    anotar([`Enviado por ${TRANSPORTES[e.transporte] || 'expreso'}`, e.guia && `guía ${e.guia}`].filter(Boolean).join(', '));
  }
  if (cambio(antes, e, 'estado_viaje') && e.estado_viaje) anotar(e.estado_viaje);
  if (cambio(antes, e, 'entrega') && e.entrega) anotar(ENTREGAS[e.entrega]);
}

// Deja los envíos del pedido como vienen del formulario: actualiza, agrega y quita.
function guardarEnvios(pedidoId, d) {
  const actuales = new Map(listarEnvios(pedidoId).map((e) => [e.id, e]));
  const quedan = new Set(d.envios.map((e) => e.id).filter(Boolean));
  for (const id of actuales.keys()) {
    if (!quedan.has(id)) db.prepare('DELETE FROM envios WHERE id = ?').run(id);
  }
  const conNumero = variosEnvios(d, d.envios);
  d.envios.forEach((e, i) => {
    const antes = e.id ? actuales.get(e.id) : null;
    if (e.id && !antes) throw conflicto('los envíos de este pedido');
    if (antes) {
      db.prepare('UPDATE envios SET remito = ?, transporte = ?, guia = ?, estado_viaje = ?, entrega = ? WHERE id = ?')
        .run(e.remito, e.transporte, e.guia, e.estado_viaje, e.entrega, e.id);
    } else {
      db.prepare('INSERT INTO envios (pedido_id, remito, transporte, guia, estado_viaje, entrega) VALUES (?, ?, ?, ?, ?, ?)')
        .run(pedidoId, e.remito, e.transporte, e.guia, e.estado_viaje, e.entrega);
    }
    registrarCambiosEnvio(pedidoId, antes ?? {}, e, conNumero ? `Envío ${i + 1}` : '');
  });
}

export function crear(d) {
  validarSiniestroLibre(d.siniestro);
  const id = transaction(() => {
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO pedidos (${CAMPOS.join(', ')}) VALUES (${CAMPOS.map(() => '?').join(', ')})`)
      .run(...CAMPOS.map((c) => d[c]));
    registrarEvento(lastInsertRowid, 'Pedido registrado');
    registrarCambios(lastInsertRowid, {}, d);
    guardarEnvios(lastInsertRowid, d);
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
    guardarEnvios(antes.id, d);
  });
  return obtener(antes.id);
}

export function eliminar(id) {
  db.prepare('DELETE FROM pedidos WHERE id = ?').run(obtener(id).id);
}

// ---------------------------------------------------------------- Actualización automática por expreso

// Envíos de un expreso que tienen guía y todavía no llegaron (los que hay que consultar).
export const enviosPendientes = (transporte) =>
  db.prepare(`SELECT e.*, p.siniestro FROM envios e JOIN pedidos p ON p.id = e.pedido_id
              WHERE e.transporte = ? AND e.guia <> '' AND e.entrega <> 'recibido' ORDER BY e.id`).all(transporte);

// Aplica a un envío lo que informó el expreso. Solo guarda (y anota en el historial) si algo cambió.
// Sube la versión del pedido: si alguien lo tenía abierto, al guardar ve el aviso de "otra persona lo modificó".
export function actualizarEnvioDesdeExpreso(envioId, { estado_viaje, entrega }) {
  const antes = db.prepare('SELECT * FROM envios WHERE id = ?').get(envioId);
  if (!antes) return false;
  const despues = { ...antes, estado_viaje: estado_viaje ?? antes.estado_viaje, entrega: entrega ?? antes.entrega };
  if (despues.estado_viaje === antes.estado_viaje && despues.entrega === antes.entrega) return false;

  const pedido = obtener(antes.pedido_id);
  const envios = listarEnvios(pedido.id);
  const nombre = variosEnvios(pedido, envios) ? `Envío ${envios.findIndex((e) => e.id === antes.id) + 1} · ` : '';
  transaction(() => {
    db.prepare('UPDATE envios SET estado_viaje = ?, entrega = ? WHERE id = ?').run(despues.estado_viaje, despues.entrega, antes.id);
    db.prepare("UPDATE pedidos SET version = version + 1, updated_at = datetime('now') WHERE id = ?").run(pedido.id);
    if (despues.entrega === 'recibido') registrarEvento(pedido.id, `${nombre}Recibido`);
    else if (despues.estado_viaje !== antes.estado_viaje) registrarEvento(pedido.id, `${nombre}${despues.estado_viaje}`);
  });
  return true;
}
