// Panel admin · Pedidos: lista, alta y edición (con el estado de cada etapa y sus envíos).
import { apiPrivada } from '../../comun/api.js';
import { $, esc, fecha, alerta, celda, pillEstado } from '../../comun/ui.js';
import { renderSeguimiento } from '../../comun/seguimiento.js';
import { estado, alCargarOpciones, llenarSelect, avisoDeError } from './estado.js';
import { crearCombo } from './componentes.js';
import { pintarEnvios, leerEnvios } from './envios.js';

const form = $('#form-pedido');

alCargarOpciones((op) => {
  llenarSelect(form.elements.origen, op.origenes, 'En revisión');
  llenarSelect(form.elements.despacho, op.despachos, 'Sin despachar');
});

const inactivo = (u) => (u.activo ? '' : 'inactivo');

// El taller se busca por el nombre del taller.
const comboTaller = crearCombo($('#combo-taller'), {
  lista: () => estado.opciones?.talleres ?? [],
  titulo: (u) => u.empresa || u.nombre,
  detalle: (u) => [u.empresa && u.nombre, inactivo(u)].filter(Boolean).join(' · '),
  buscarEn: (u) => [u.empresa, u.nombre],
});

// El perito se busca por su nombre, no por compañía (hay muchos más peritos que compañías).
const comboPerito = crearCombo($('#combo-perito'), {
  lista: () => estado.opciones?.peritos ?? [],
  titulo: (u) => u.nombre,
  detalle: (u) => [u.email, inactivo(u)].filter(Boolean).join(' · '),
  buscarEn: (u) => [u.nombre, u.email],
});

// ---------------------------------------------------------------- Lista

let espera;
$('#buscar').addEventListener('input', () => {
  clearTimeout(espera);
  espera = setTimeout(cargarPedidos, 250);
});

export async function cargarPedidos() {
  const filas = await apiPrivada(`/api/admin/pedidos?q=${encodeURIComponent($('#buscar').value)}`);
  $('#tabla-pedidos').innerHTML = filas.length
    ? filas.map((p) => `<tr class="clickable" data-href="#/pedidos/${p.id}">
        ${celda('Siniestro', `<strong>${esc(p.siniestro)}</strong>`)}${celda('Patente', esc(p.patente))}
        ${celda('Vehículo', esc(p.vehiculo))}${celda('Taller', esc(p.taller))}${celda('Perito', esc(p.perito))}
        ${celda('Compañía', esc(p.compania))}${celda('Estado', pillEstado(p, true))}
        ${celda('Actualizado', `<span class="small muted">${fecha(p.updated_at)}</span>`)}</tr>`).join('')
    : '<tr><td colspan="8" class="empty">No hay pedidos.</td></tr>';
}

// ---------------------------------------------------------------- Alta / edición

export async function abrirPedido(id) {
  form.reset();
  alerta($('#pedido-msg'), '', '');
  $('#borrar-pedido').classList.toggle('hidden', !id);
  $('#vista-previa').classList.toggle('hidden', !id);
  $('#pedido-titulo').textContent = 'Nuevo pedido';
  form.dataset.id = id || '';
  form.dataset.version = '';
  comboTaller.set(null);
  comboPerito.set(null);
  pintarEnvios([]);
  if (!id) return form.elements.siniestro.focus();

  const p = await apiPrivada(`/api/admin/pedidos/${id}`);
  $('#pedido-titulo').textContent = `Siniestro ${p.siniestro}`;
  for (const el of form.elements) if (el.name) el.value = p[el.name] ?? '';
  form.dataset.version = p.version;
  comboTaller.set(p.taller_id);
  comboPerito.set(p.perito_id);
  pintarEnvios(p.envios);
  $('#preview').innerHTML = renderSeguimiento(p.seguimiento);
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id = form.dataset.id;
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  try {
    const body = { ...Object.fromEntries(new FormData(form)), envios: leerEnvios(), version: form.dataset.version };
    const p = await apiPrivada(id ? `/api/admin/pedidos/${id}` : '/api/admin/pedidos', { method: id ? 'PUT' : 'POST', body });
    if (!id) return (location.hash = `#/pedidos/${p.id}`);
    await abrirPedido(id);
    alerta($('#pedido-msg'), 'ok', 'Cambios guardados.');
  } catch (err) {
    alerta($('#pedido-msg'), 'error', err.message, avisoDeError(err, () => abrirPedido(id), '#/'));
  } finally {
    btn.disabled = false;
  }
});

$('#borrar-pedido').addEventListener('click', async () => {
  if (!confirm('¿Eliminar este pedido? No se puede deshacer.')) return;
  try {
    await apiPrivada(`/api/admin/pedidos/${form.dataset.id}`, { method: 'DELETE' });
    location.hash = '#/';
  } catch (err) {
    alerta($('#pedido-msg'), 'error', err.message);
  }
});
