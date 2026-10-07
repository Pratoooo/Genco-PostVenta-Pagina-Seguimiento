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

// Los avisos por mail van solos al email de la cuenta del taller y del perito: se muestra cuál es.
// (Los emails provisorios "@genco.local" y los de prueba como "@example.com" no reciben avisos.)
const EMAIL_DE_PRUEBA = /@((.+\.)?(example\.(com|net|org)|test|invalid|local|localhost))$/i;
function mostrarEmailDeAvisos(el, u, quien) {
  if (!u) el.textContent = `Ve el pedido desde su cuenta y recibe los avisos por mail.`;
  else if (EMAIL_DE_PRUEBA.test(u.email)) el.textContent = `${quien} no tiene un email real (${u.email}): no recibe avisos. Cargalo en Usuarios.`;
  else el.textContent = `Los avisos por mail le llegan a ${u.email}.`;
}

// El taller se busca por el nombre del taller.
const comboTaller = crearCombo($('#combo-taller'), {
  lista: () => estado.opciones?.talleres ?? [],
  titulo: (u) => u.empresa || u.nombre,
  detalle: (u) => [u.empresa && u.nombre, u.email, inactivo(u)].filter(Boolean).join(' · '),
  buscarEn: (u) => [u.empresa, u.nombre],
  alElegir: (u) => mostrarEmailDeAvisos($('#f-taller-aviso'), u, 'Este taller'),
});

// El perito se busca por su nombre, no por compañía (hay muchos más peritos que compañías).
const comboPerito = crearCombo($('#combo-perito'), {
  lista: () => estado.opciones?.peritos ?? [],
  titulo: (u) => u.nombre,
  detalle: (u) => [u.email, inactivo(u)].filter(Boolean).join(' · '),
  buscarEn: (u) => [u.nombre, u.email],
  alElegir: (u) => mostrarEmailDeAvisos($('#f-perito-aviso'), u, 'Este perito'),
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

// ---------------------------------------------------------------- Avisos por mail

function pintarAvisos(a) {
  $('#avisos-mail').classList.toggle('hidden', !a);
  if (!a) return;
  const para = a.destinatarios.join(', ');
  let texto;
  if (!a.destinatarios.length) {
    texto = 'No hay a quién avisar: el taller y el perito no tienen un email real o desactivaron los avisos de este pedido.';
  } else if (a.pendientes) {
    texto = `Hay ${a.pendientes} novedad(es) sin avisar. Salen solas por mail en ${a.espera_segundos} segundos a: ${para}.`;
  } else if (a.ultimo_aviso_at) {
    texto = `Último aviso: ${fecha(a.ultimo_aviso_at)} a ${a.ultimo_aviso_para}. Los próximos cambios de estado se avisan a: ${para}.`;
  } else {
    texto = `Cuando cambie el estado se avisa por mail a: ${para}.`;
  }
  $('#avisos-texto').textContent = texto;
  $('#avisar-ahora').classList.toggle('hidden', !a.pendientes || !a.destinatarios.length);
}

$('#avisar-ahora').addEventListener('click', async () => {
  const btn = $('#avisar-ahora');
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    const r = await apiPrivada(`/api/admin/pedidos/${form.dataset.id}/avisar`, { method: 'POST' });
    pintarAvisos(r);
    alerta($('#pedido-msg'), 'ok', `Aviso enviado a ${r.enviados.join(', ')}.`);
  } catch (err) {
    alerta($('#pedido-msg'), 'error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar aviso ahora';
  }
});

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
  pintarAvisos(null);
  if (!id) return form.elements.siniestro.focus();

  const p = await apiPrivada(`/api/admin/pedidos/${id}`);
  $('#pedido-titulo').textContent = `Siniestro ${p.siniestro}`;
  for (const el of form.elements) if (el.name) el.value = p[el.name] ?? '';
  form.dataset.version = p.version;
  comboTaller.set(p.taller_id);
  comboPerito.set(p.perito_id);
  pintarEnvios(p.envios);
  pintarAvisos(p.avisos);
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
