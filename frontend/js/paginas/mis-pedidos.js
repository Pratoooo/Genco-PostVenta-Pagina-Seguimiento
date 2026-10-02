// "Mis pedidos": lista y detalle de los pedidos asignados al taller o perito.
import { apiPrivada } from '../comun/api.js';
import { $, esc, fecha, celda, pillEstado, sinAcentos, refrescarPeriodicamente } from '../comun/ui.js';
import { renderSeguimiento } from '../comun/seguimiento.js';
import { exigirSesion } from '../comun/sesion.js';

let usuario = null;
let pedidos = [];

function pintarLista() {
  const q = sinAcentos($('#buscar').value.trim());
  const otro = usuario.rol === 'perito' ? 'taller' : 'perito';
  const filas = pedidos.filter((p) =>
    !q || [p.siniestro, p.patente, p.vehiculo, p.compania, p[otro]].some((v) => sinAcentos(v).includes(q)));
  $('#tabla').innerHTML = filas.length
    ? filas.map((p) => `<tr class="clickable" data-id="${p.id}">
        ${celda('Siniestro', `<strong>${esc(p.siniestro)}</strong>`)}${celda('Patente', esc(p.patente))}
        ${celda('Vehículo', esc(p.vehiculo))}${celda(otro === 'taller' ? 'Taller' : 'Perito', esc(p[otro]))}
        ${celda('Compañía', esc(p.compania))}${celda('Estado', pillEstado(p, true))}
        ${celda('Actualizado', `<span class="small muted">${fecha(p.updated_at)}</span>`)}</tr>`).join('')
    : `<tr><td colspan="7" class="empty">${pedidos.length ? 'Ningún pedido coincide con la búsqueda.' : 'Todavía no tenés pedidos asignados.'}</td></tr>`;
}

async function cargarLista() {
  pedidos = await apiPrivada('/api/mis-pedidos');
  $('#st-total').textContent = pedidos.length;
  $('#st-curso').textContent = pedidos.filter((p) => !p.recibido).length;
  $('#st-recibidos').textContent = pedidos.filter((p) => p.recibido).length;
  pintarLista();
}

const pedidoDelHash = () => location.hash.match(/^#\/pedido\/(\d+)/)?.[1];

async function route() {
  const id = pedidoDelHash();
  $('#view-lista').classList.toggle('hidden', Boolean(id));
  $('#view-detalle').classList.toggle('hidden', !id);
  try {
    if (id) {
      $('#detalle').innerHTML = '<div class="card muted">Cargando…</div>';
      $('#detalle').innerHTML = renderSeguimiento(await apiPrivada(`/api/mis-pedidos/${id}`));
      scrollTo(0, 0);
    } else {
      await cargarLista();
    }
  } catch (err) {
    if (err.status === 401) return;
    const aviso = `<div class="alert error">${esc(err.message)}</div>`;
    if (id) $('#detalle').innerHTML = aviso;
    else $('#tabla').innerHTML = `<tr><td colspan="7">${aviso}</td></tr>`;
  }
}

$('#buscar').addEventListener('input', pintarLista);
$('#tabla').addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr[data-id]');
  if (tr) location.hash = `#/pedido/${tr.dataset.id}`;
});
window.addEventListener('hashchange', route);

usuario = await exigirSesion(['perito', 'taller']);
if (usuario) {
  $('#subtitulo').textContent = usuario.rol === 'taller'
    ? `Pedidos asignados a ${usuario.empresa || usuario.nombre}`
    : `Pedidos asignados a ${usuario.nombre}${usuario.empresa ? ` · ${usuario.empresa}` : ''}`;
  $('#th-otro').textContent = usuario.rol === 'perito' ? 'Taller' : 'Perito';
  await route();
  // Novedades que carga Genco mientras la página está abierta (solo la lista, el detalle no se toca).
  refrescarPeriodicamente(() => !pedidoDelHash() && cargarLista().catch(() => {}));
}
