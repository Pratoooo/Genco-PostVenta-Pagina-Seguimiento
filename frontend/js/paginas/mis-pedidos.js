// "Mis pedidos": lista y detalle de los pedidos asignados al taller o perito.
import { apiPrivada } from '../comun/api.js';
import { $, esc, fecha, pillEstado, refrescarPeriodicamente, avisoBreve, pintarIconos } from '../comun/ui.js';
import { renderSeguimiento } from '../comun/seguimiento.js';
import { crearResena, FILTROS, plazoHtml } from '../comun/resena.js';
import { exigirSesion } from '../comun/sesion.js';

let usuario = null;
let resena = null;

// Reseña de los pedidos del taller o del perito: números por estado, filtros, lista y Excel.
function armarResena() {
  const otro = usuario.rol === 'perito' ? 'taller' : 'perito';
  resena = crearResena($('#resena'), {
    columnas: [
      { titulo: 'Siniestro', html: (p) => `<strong class="nowrap">${esc(p.siniestro)}</strong><div class="small muted">${esc(p.patente)}</div>` },
      { titulo: 'Vehículo', html: (p) => esc(p.vehiculo) },
      { titulo: otro === 'taller' ? 'Taller' : 'Perito', html: (p) => esc(p[otro]) },
      { titulo: 'Compañía', html: (p) => esc(p.compania) },
      { titulo: 'Expreso', html: (p) => esc(p.expresos.join(', ')) || '<span class="muted">—</span>' },
      { titulo: 'Estado', html: (p) => pillEstado(p, true) + (p.por_confirmar ? '<div class="por-confirmar">¿Te llegó? Confirmalo</div>' : '') },
      { titulo: 'Entrega estimada', html: (p) => plazoHtml(p) },
      { titulo: 'Actualizado', html: (p) => `<span class="small muted">${fecha(p.updated_at)}</span>` },
    ],
    selects: [FILTROS.expreso, FILTROS.compania, FILTROS[otro]],
    enlace: (p) => `#/pedido/${p.id}`,
    vacio: 'Todavía no tenés pedidos asignados.',
  });
}

async function cargarLista() {
  resena.cargar(await apiPrivada('/api/mis-pedidos'));
}

const pedidoDelHash = () => location.hash.match(/^#\/pedido\/(\d+)/)?.[1];

// Casilla para recibir (o no) por mail las novedades del pedido. Viene marcada; se guarda al tocarla.
function casillaAvisos(activos) {
  return `<div class="card preferencia-avisos">
    <label class="check"><input type="checkbox" id="avisos-pedido" ${activos ? 'checked' : ''}>
      Recibir por mail las novedades de este pedido</label>
    <div class="hint" id="avisos-pedido-texto">${textoAvisos(activos)}</div>
  </div>`;
}

const textoAvisos = (activos) => (activos
  ? `Te avisamos a ${esc(usuario.email)} cada vez que cambie el estado. Si no te llegan, revisá la carpeta de Spam.`
  : 'No vas a recibir mails de este pedido. Lo podés seguir viendo acá cuando quieras.');

async function guardarAvisos(id, casilla) {
  casilla.disabled = true;
  try {
    const r = await apiPrivada(`/api/mis-pedidos/${id}/avisos`, { method: 'PUT', body: { activos: casilla.checked } });
    casilla.checked = r.avisos_por_mail;
    $('#avisos-pedido-texto').innerHTML = `<strong>Guardado.</strong> ${textoAvisos(r.avisos_por_mail)}`;
  } catch (err) {
    casilla.checked = !casilla.checked;
    $('#avisos-pedido-texto').textContent = err.message;
  } finally {
    casilla.disabled = false;
  }
}

// "¿Ya te llegó?": un botón por cada envío que todavía no figura como recibido. Al confirmar el último,
// el pedido queda "Recibido" sin que Genco tenga que marcarlo.
function tarjetaRecepcion(s) {
  const numerar = s.envios.length > 1 || s.despacho_parcial;
  const pendientes = s.envios.map((e, i) => ({ ...e, nombre: numerar ? `Envío ${i + 1}` : 'Envío' })).filter((e) => !e.recibido);
  if (!s.puede_confirmar || !pendientes.length) return '';
  const filas = pendientes.map((e) => `<li>
      <div class="recepcion-txt">
        <strong>${e.nombre}</strong>
        <span>${esc([e.remito && `Remito ${e.remito}`, e.transporte, e.guia && `Guía ${e.guia}`].filter(Boolean).join(' · '))}</span>
      </div>
      <button type="button" class="btn sm" data-recibido="${e.id}"
        data-pregunta="${esc(`¿Confirmás que te llegó el ${e.nombre.toLowerCase()}${e.remito ? ` (remito ${e.remito})` : ''}?`)}">Ya me llegó</button>
    </li>`).join('');
  return `<div class="card recepcion">
    <h3>¿Ya te llegó?</h3>
    <p>Cuando recibas el paquete, tocá «Ya me llegó». Así Genco sabe que está entregado y no tiene que preguntarte.</p>
    <ul>${filas}</ul>
  </div>`;
}

async function confirmarRecepcion(id, boton) {
  if (!confirm(boton.dataset.pregunta)) return;
  boton.disabled = true;
  boton.textContent = 'Guardando…';
  try {
    const s = await apiPrivada(`/api/mis-pedidos/${id}/envios/${boton.dataset.recibido}/recibido`, { method: 'POST', body: {} });
    mostrarDetalle(id, s, s.recibido ? '¡Gracias! Quedó registrado que recibiste el pedido completo.' : '¡Gracias! Quedó registrado que lo recibiste.');
  } catch (err) {
    boton.disabled = false;
    boton.textContent = 'Ya me llegó';
    avisoBreve(err.message);
  }
}

function mostrarDetalle(id, s, mensaje = '') {
  $('#detalle').innerHTML = (mensaje ? `<div class="alert ok aviso-detalle" role="status">${esc(mensaje)}</div>` : '')
    + tarjetaRecepcion(s) + casillaAvisos(s.avisos_por_mail) + renderSeguimiento(s);
  $('#avisos-pedido').addEventListener('change', (ev) => guardarAvisos(id, ev.target));
  $('#detalle').querySelectorAll('[data-recibido]').forEach((b) => b.addEventListener('click', () => confirmarRecepcion(id, b)));
  scrollTo(0, 0);
}

async function route() {
  const id = pedidoDelHash();
  $('#view-lista').classList.toggle('hidden', Boolean(id));
  $('#view-detalle').classList.toggle('hidden', !id);
  try {
    if (id) {
      $('#detalle').innerHTML = '<div class="card muted">Cargando…</div>';
      mostrarDetalle(id, await apiPrivada(`/api/mis-pedidos/${id}`));
    } else {
      await cargarLista();
    }
  } catch (err) {
    if (err.status === 401) return;
    const aviso = `<div class="alert error">${esc(err.message)}</div>`;
    if (id) $('#detalle').innerHTML = aviso;
    else $('#resena').insertAdjacentHTML('afterbegin', aviso);
  }
}

window.addEventListener('hashchange', route);

pintarIconos();
usuario = await exigirSesion(['perito', 'taller']);
if (usuario) {
  $('#subtitulo').textContent = usuario.rol === 'taller'
    ? `Pedidos asignados a ${usuario.empresa || usuario.nombre}`
    : `Pedidos asignados a ${usuario.nombre}`;
  armarResena();
  await route();
  // Novedades que carga Genco mientras la página está abierta (solo la lista, el detalle no se toca).
  refrescarPeriodicamente(() => !pedidoDelHash() && cargarLista().catch(() => {}));
}
