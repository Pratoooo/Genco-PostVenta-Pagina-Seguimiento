// Avisos por mail de los cambios de estado de un pedido.
//
// Cada cambio que ve el cliente queda en el historial del pedido (tabla eventos). Cada 20 segundos se
// buscan pedidos con novedades sin avisar y se manda UN mail por destinatario con todas juntas: sale
// 1 minuto después del último cambio (así varios guardados seguidos van en un solo mail) y, si se siguen
// haciendo cambios, a los 5 minutos de la primera novedad como máximo. Desde la ficha del pedido también
// se puede mandar en el momento ("Enviar aviso ahora").
//
// Destinatarios: el taller y el perito asignados, al email de su cuenta. Cada uno puede desactivar los
// avisos de un pedido desde "Mis pedidos" (por defecto están activos).
import { config } from '../config.js';
import { db } from '../db/conexion.js';
import { HttpError } from '../lib/errores.js';
import { enviarMail, plantillaMail } from '../lib/mailer.js';
import { escHtml as esc } from '../lib/normalizar.js';
import * as pedidos from '../modelos/pedidos.js';

const ESPERA_SEGUNDOS = 60;
const ESPERA_MAXIMA_MINUTOS = 5;
const AZUL = '#253883';
const VERDE = '#138a52';
const GRIS = '#5d6680';

// Fecha de la base (UTC "AAAA-MM-DD HH:MM:SS") -> hora de Argentina.
const fechaLocal = (s) =>
  new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short',
  });

// ---------------------------------------------------------------- Destinatarios

// No se manda a emails provisorios ("@genco.local") ni a dominios reservados para pruebas
// (example.com, .test...): no existen, y Gmail devolvería un rebote por cada uno.
const DOMINIOS_DE_PRUEBA = /(^|\.)(example\.(com|net|org)|test|invalid|local|localhost)$/i;
const emailReal = (email) => {
  const dominio = String(email ?? '').split('@')[1];
  return Boolean(dominio) && !DOMINIOS_DE_PRUEBA.test(dominio);
};

// ¿Recibe esta cuenta los avisos de este pedido? (Sí, salvo que los haya desactivado.)
export const avisosActivos = (usuarioId, pedidoId) =>
  !db.prepare('SELECT 1 FROM avisos_desactivados WHERE usuario_id = ? AND pedido_id = ?').get(usuarioId, pedidoId);

export function cambiarAvisos(usuarioId, pedidoId, activos) {
  if (activos) db.prepare('DELETE FROM avisos_desactivados WHERE usuario_id = ? AND pedido_id = ?').run(usuarioId, pedidoId);
  else db.prepare('INSERT OR IGNORE INTO avisos_desactivados (usuario_id, pedido_id) VALUES (?, ?)').run(usuarioId, pedidoId);
}

export function destinatarios(p) {
  const lista = [];
  for (const id of [p.taller_id, p.perito_id]) {
    const u = id && db.prepare('SELECT id, nombre, email, activo, aprobado FROM usuarios WHERE id = ?').get(id);
    if (u?.activo && u.aprobado && emailReal(u.email) && avisosActivos(u.id, p.id) && !lista.some((d) => d.email === u.email)) {
      lista.push({ email: u.email, nombre: u.nombre });
    }
  }
  return lista;
}

// ---------------------------------------------------------------- Contenido del mail

function puntosDeAvance(s) {
  const celdas = s.etapas.map((e, i) => {
    const hecha = i < s.etapa_actual;
    const actual = i === s.etapa_actual;
    const final = i === s.etapas.length - 1;
    const circulo = hecha
      ? `background:${final ? VERDE : AZUL};color:#ffffff;border:2px solid ${final ? VERDE : AZUL}`
      : actual ? `background:#ffffff;color:#2f4fb4;border:2px solid #2f4fb4` : 'background:#eef0f4;color:#8a93a8;border:2px solid #eef0f4';
    return `<td align="center" valign="top" width="25%" style="padding:0 4px">
      <div style="width:34px;height:34px;line-height:34px;border-radius:17px;margin:0 auto 8px;font-weight:bold;font-size:15px;${circulo}">${hecha ? '&#10003;' : i + 1}</div>
      <div style="font-size:12px;font-weight:bold;color:${hecha || actual ? '#121a33' : '#8a93a8'}">${esc(e.titulo)}</div>
      ${e.detalle ? `<div style="font-size:11px;color:${GRIS};margin-top:2px">${esc(e.detalle)}</div>` : ''}
    </td>`;
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 8px"><tr>${celdas.join('')}</tr></table>`;
}

function listaNovedades(novedades) {
  const filas = novedades.map((n) => `<tr>
      <td style="padding:7px 0;border-top:1px solid #e2e7f1;font-size:12px;color:${GRIS};white-space:nowrap;vertical-align:top">${esc(fechaLocal(n.fecha))}</td>
      <td style="padding:7px 0 7px 14px;border-top:1px solid #e2e7f1;font-size:14px">${esc(n.descripcion)}</td>
    </tr>`).join('');
  return `<h2 style="font-size:15px;margin:24px 0 6px">Novedades</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>`;
}

function listaEnvios(s) {
  if (!s.envios.length) return '';
  const numerar = s.envios.length > 1 || s.despacho_parcial;
  const filas = s.envios.map((e, i) => {
    const datos = [e.remito && `Remito ${e.remito}`, e.transporte, e.guia && `Guía ${e.guia}`].filter(Boolean).join(' · ');
    const color = e.recibido ? VERDE : AZUL;
    return `<tr><td style="padding:12px 14px;background:#f5f7fc;border-radius:10px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:14px"><strong>${numerar ? `Envío ${i + 1}` : 'Envío'}</strong><br>
            <span style="font-size:13px;color:${GRIS}">${esc(datos)}</span>
            ${e.estado_viaje && !e.recibido ? `<br><span style="font-size:13px;color:${AZUL};font-weight:bold">${esc(e.estado_viaje)}</span>` : ''}</td>
          <td align="right" style="white-space:nowrap"><span style="display:inline-block;padding:4px 10px;border-radius:99px;background:${e.recibido ? '#e2f5ec' : '#eaf0ff'};color:${color};font-size:12px;font-weight:bold">${esc(e.estado)}</span></td>
        </tr></table>
      </td></tr><tr><td style="height:8px"></td></tr>`;
  }).join('');
  const parcial = s.despacho_parcial
    ? `<p style="margin:4px 0 0;padding:10px 14px;border-radius:10px;background:#fff4e0;color:#8a4b00;font-size:13px">Se envió una parte del pedido. Lo que falta sale en otro envío, con su propio remito y número de guía.</p>`
    : '';
  return `<h2 style="font-size:15px;margin:24px 0 8px">${s.envios.length > 1 ? 'Envíos' : 'Envío'}</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>${parcial}`;
}

function datosPedido(p) {
  const datos = [['Patente', p.patente], ['Vehículo', p.vehiculo], ['Taller', p.taller], ['Compañía', p.compania]]
    .filter(([, v]) => v);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px"><tr>
    ${datos.map(([k, v]) => `<td valign="top" style="padding:8px 10px 8px 0"><div style="font-size:11px;color:${GRIS};text-transform:uppercase;letter-spacing:.5px">${k}</div><div style="font-size:14px;font-weight:bold">${esc(v)}</div></td>`).join('')}
  </tr></table>`;
}

// Arma el mail de novedades para un destinatario.
export function armarMail(s, novedades, destinatario) {
  const p = s.pedido;
  const recibido = s.recibido;
  const enlace = `${config.appUrl}/mis-pedidos#/pedido/${p.id}`;
  const saludo = destinatario.nombre ? `Hola ${esc(destinatario.nombre)}:` : 'Hola:';
  const estado = `<span style="display:inline-block;padding:6px 14px;border-radius:99px;background:${recibido ? '#e2f5ec' : '#eaf0ff'};color:${recibido ? VERDE : AZUL};font-weight:bold;font-size:14px">${esc(s.estado)}</span>`;

  return {
    para: destinatario.email,
    asunto: `Siniestro ${p.siniestro}: ${s.estado} — Grupo Genco`,
    texto: [
      saludo.replace(/<[^>]+>/g, ''),
      '',
      `Hay novedades en el pedido del siniestro ${p.siniestro}${p.patente ? ` (patente ${p.patente})` : ''}.`,
      `Estado actual: ${s.estado}`,
      '',
      'Novedades:',
      ...novedades.map((n) => `  ${fechaLocal(n.fecha)}  ${n.descripcion}`),
      ...(s.envios.length ? ['', 'Envíos:', ...s.envios.map((e, i) =>
        `  Envío ${i + 1}: ${[e.remito && `remito ${e.remito}`, e.transporte, e.guia && `guía ${e.guia}`, e.estado].filter(Boolean).join(' · ')}`)] : []),
      '',
      `Ver el pedido: ${enlace}`,
      '',
      'Grupo Genco · Siniestros. Este es un aviso automático, no hace falta responderlo.',
    ].join('\n'),
    html: plantillaMail({
      titulo: `Novedades de tu pedido · Siniestro ${esc(p.siniestro)}`,
      parrafos: [saludo, `Hay novedades en el pedido de repuestos. Estado actual: ${estado}`],
      bloques: datosPedido(p) + puntosDeAvance(s) + listaNovedades(novedades) + listaEnvios(s),
      boton: { url: enlace, texto: 'Ver el pedido' },
      pie: 'Te llega porque este pedido está asignado a tu cuenta. Si no querés recibir más avisos de este pedido, '
        + 'desmarcá la opción en el pedido, en "Mis pedidos". Este es un aviso automático, no hace falta responderlo.',
    }),
  };
}

// ---------------------------------------------------------------- Envío

// Novedades del pedido posteriores al último aviso (hasta `hasta`, inclusive).
const novedadesSinAvisar = (p, hasta) =>
  db.prepare('SELECT descripcion, fecha FROM eventos WHERE pedido_id = ? AND id > ? AND id <= ? ORDER BY id')
    .all(p.id, p.ultimo_evento_avisado, hasta);

const marcarAvisado = (pedidoId, hasta, para = null) => {
  if (para) {
    db.prepare("UPDATE pedidos SET ultimo_evento_avisado = ?, ultimo_aviso_at = datetime('now'), ultimo_aviso_para = ? WHERE id = ?")
      .run(hasta, para, pedidoId);
  } else {
    db.prepare('UPDATE pedidos SET ultimo_evento_avisado = ? WHERE id = ?').run(hasta, pedidoId);
  }
};

// Pedidos que se están avisando en este momento (para no mandar dos veces el mismo aviso).
const enCurso = new Set();

// Manda el aviso de las novedades del pedido hasta el evento `hasta`. Devuelve a quiénes se mandó.
async function avisarPedido(pedidoId, hasta) {
  if (enCurso.has(pedidoId)) return [];
  enCurso.add(pedidoId);
  try {
    const p = pedidos.obtener(pedidoId);
    const lista = destinatarios(p);
    const novedades = novedadesSinAvisar(p, hasta);
    if (!lista.length || !novedades.length) {
      marcarAvisado(pedidoId, hasta);
      return [];
    }
    const s = pedidos.seguimiento(p);
    const enviados = [];
    for (const destinatario of lista) {
      try {
        await enviarMail(armarMail(s, novedades, destinatario));
        enviados.push(destinatario.email);
      } catch (err) {
        console.error(`No se pudo enviar el aviso del siniestro ${p.siniestro} a ${destinatario.email}: ${err.message}`);
      }
    }
    // Si no salió ninguno (por ejemplo, Gmail caído), se reintenta en el próximo ciclo.
    if (enviados.length) {
      marcarAvisado(pedidoId, hasta, enviados.join(', '));
      console.log(`Aviso del siniestro ${p.siniestro} enviado a ${enviados.join(', ')}.`);
    }
    return enviados;
  } finally {
    enCurso.delete(pedidoId);
  }
}

let revisando = false;

export async function enviarAvisosPendientes() {
  if (revisando) return;
  revisando = true;
  try {
    const pendientes = db.prepare(`
      SELECT p.id, MAX(e.id) AS hasta FROM pedidos p
      JOIN eventos e ON e.pedido_id = p.id AND e.id > p.ultimo_evento_avisado
      GROUP BY p.id
      HAVING MAX(e.fecha) <= datetime('now', '-${ESPERA_SEGUNDOS} seconds')
          OR MIN(e.fecha) <= datetime('now', '-${ESPERA_MAXIMA_MINUTOS} minutes')`).all();
    for (const { id, hasta } of pendientes) {
      try {
        await avisarPedido(id, hasta);
      } catch (err) {
        console.error(`Aviso del pedido ${id}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`No se pudieron revisar los avisos pendientes: ${err.message}`);
  } finally {
    revisando = false;
  }
}

// ---------------------------------------------------------------- Para la ficha del pedido (panel admin)

// A quién se avisa, si hay novedades esperando y cuándo salió el último aviso.
export function estadoAvisos(p) {
  const pendientes = db.prepare('SELECT COUNT(*) AS n FROM eventos WHERE pedido_id = ? AND id > ?').get(p.id, p.ultimo_evento_avisado).n;
  return {
    destinatarios: destinatarios(p).map((d) => d.email),
    pendientes,
    espera_segundos: ESPERA_SEGUNDOS,
    ultimo_aviso_at: p.ultimo_aviso_at,
    ultimo_aviso_para: p.ultimo_aviso_para,
  };
}

// "Enviar aviso ahora": manda las novedades pendientes sin esperar.
export async function avisarAhora(pedidoId) {
  const p = pedidos.obtener(pedidoId);
  const hasta = db.prepare('SELECT MAX(id) AS id FROM eventos WHERE pedido_id = ?').get(p.id).id ?? 0;
  if (hasta <= p.ultimo_evento_avisado) throw new HttpError(400, 'No hay novedades sin avisar en este pedido.');
  if (!destinatarios(p).length) {
    throw new HttpError(400, 'No hay a quién avisar: el taller y el perito no tienen un email real o desactivaron los avisos de este pedido.');
  }
  const enviados = await avisarPedido(p.id, hasta);
  if (!enviados.length) throw new HttpError(502, 'No se pudo mandar el aviso. Revisá la conexión con Gmail e intentá de nuevo.');
  return { enviados, ...estadoAvisos(pedidos.obtener(p.id)) };
}

export function iniciarAvisos() {
  setInterval(enviarAvisosPendientes, 20_000);
}
