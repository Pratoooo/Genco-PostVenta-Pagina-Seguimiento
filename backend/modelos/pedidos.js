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
export const TRANSPORTES = { angeleri: 'Angeleri', andreani: 'Andreani', oca: 'OCA', sendbox: 'Sendbox', genco: 'Repartidora de Genco' };
// Página de cada expreso donde el cliente pega el número de guía para ver el estado del envío.
// Angeleri y la repartidora de Genco no tienen: el estado lo carga la oficina.
export const PAGINAS_SEGUIMIENTO = {
  andreani: 'https://www.andreani.com/',
  oca: 'https://www.oca.com.ar/',
  sendbox: 'https://www.sendbox.com.ar/seguimiento/',
};
export const ENTREGAS = { en_camino: 'En camino', recibido: 'Recibido' };
// A dónde se envía el pedido: a la dirección del taller, a la del perito o a otra.
export const DESTINOS_ENVIO = { taller: 'Al taller', perito: 'Al perito', otra: 'Otra dirección' };

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

// Todos los pedidos, para la reseña del panel (los filtros se aplican en la pantalla).
export const listar = () => db.prepare(`${SELECT} ORDER BY p.updated_at DESC`).all();

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
  // Para la reseña: en preparación (todavía no salió) | en camino (salió, falta que llegue todo) | recibido.
  const grupo = recibido ? 'recibido' : despachados.length || recibidos ? 'en_camino' : 'preparacion';
  return { etapas: lista, etapa_actual: actual, recibido, estado, grupo };
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
  plazo_entrega: p.plazo_entrega,
});

// Lo que se muestra de cada envío.
const envioPublico = (e) => ({
  id: e.id,
  remito: e.remito,
  transporte: TRANSPORTES[e.transporte] || '',
  guia: e.guia,
  // Para que el cliente siga el envío en la página del expreso (solo si tiene guía).
  seguimiento_url: (e.guia && PAGINAS_SEGUIMIENTO[e.transporte]) || '',
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

// Fila de los listados, con lo necesario para filtrarlos (expreso, remitos, guías, fechas).
export function resumen(p) {
  const envios = listarEnvios(p.id);
  const { etapa_actual, recibido, estado, grupo } = etapas(p, envios);
  return {
    ...datos(p),
    etapa_actual,
    recibido,
    estado,
    grupo,
    expresos: [...new Set(envios.map((e) => TRANSPORTES[e.transporte]).filter(Boolean))],
    remitos: envios.map((e) => e.remito).filter(Boolean),
    guias: envios.map((e) => e.guia).filter(Boolean),
    // Envíos que ya salieron y todavía no figuran como recibidos.
    en_viaje: envios.filter((e) => e.entrega !== 'recibido' && (e.transporte || e.guia || e.entrega)).length,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
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

// Fecha del plazo de entrega tal como la manda el campo de fecha ("2026-10-15"). Vacío = sin plazo.
function fechaPlazo(valor) {
  const v = norm.texto(valor, 10);
  if (!v) return '';
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  if (!valida || v < '2020-01-01' || v > '2100-12-31') throw new HttpError(400, 'El plazo de entrega no es una fecha válida.');
  return v;
}

// "2026-10-15" -> "15/10/2026"
const fechaArgentina = (v) => v.split('-').reverse().join('/');

const CAMPOS = ['siniestro', 'patente', 'taller_id', 'perito_id', 'compania', 'vehiculo', 'cantidad_piezas', 'origen', 'despacho',
  'plazo_entrega', 'destino', 'destino_direccion'];

// Dirección de entrega: la que se escribió o, si se eligió "al taller" / "al perito" y quedó vacía, la de su cuenta.
function direccionDestino(d, escrita) {
  if (escrita || !['taller', 'perito'].includes(d.destino)) return escrita;
  const id = d[`${d.destino}_id`];
  return (id && db.prepare('SELECT direccion FROM usuarios WHERE id = ?').get(id)?.direccion) || '';
}

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
    plazo_entrega: fechaPlazo(b.plazo_entrega),
    destino: opcion(b.destino, DESTINOS_ENVIO, 'Destino'),
    envios: leerEnvios(b.envios),
  };
  d.destino_direccion = direccionDestino(d, norm.texto(b.destino_direccion, 200));
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
  if (cambio(antes, d, 'plazo_entrega') && d.plazo_entrega) registrarEvento(id, `Entrega estimada para el ${fechaArgentina(d.plazo_entrega)}`);
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

// ---------------------------------------------------------------- Recepción (la confirma quien la recibe)

// Si el pedido va al taller lo confirma el taller; si va al perito, el perito. Si va a otra dirección (o no se
// indicó), cualquiera de los dos asignados.
export const puedeConfirmarRecepcion = (p, usuario) => !['taller', 'perito'].includes(p.destino) || p.destino === usuario.rol;

// "Ya me llegó": el envío queda recibido y, si era lo último que faltaba, el pedido pasa a "Recibido".
// Sube la versión del pedido, así un formulario del panel abierto desde antes no lo vuelve atrás al guardar.
export function confirmarRecepcion(p, envioId, usuario) {
  if (!puedeConfirmarRecepcion(p, usuario)) {
    throw new HttpError(403, `Este pedido se envía ${DESTINOS_ENVIO[p.destino].toLowerCase()}: la llegada la confirma quien lo recibe.`);
  }
  const envios = listarEnvios(p.id);
  const i = envios.findIndex((e) => e.id === Number(envioId));
  if (i < 0) throw new HttpError(404, 'No se encontró ese envío. Puede que Genco lo haya cambiado: actualizá la página.');
  if (envios[i].entrega === 'recibido') return;
  const quien = usuario.rol === 'taller' ? usuario.empresa || usuario.nombre : usuario.nombre;
  transaction(() => {
    db.prepare("UPDATE envios SET entrega = 'recibido' WHERE id = ?").run(envios[i].id);
    db.prepare("UPDATE pedidos SET version = version + 1, updated_at = datetime('now') WHERE id = ?").run(p.id);
    registrarEvento(p.id, `${variosEnvios(p, envios) ? `Envío ${i + 1} · ` : ''}Recibido (lo confirmó ${quien})`);
  });
}
