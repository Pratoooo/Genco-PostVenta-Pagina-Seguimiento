// Consulta pública de un pedido con el número de siniestro y la patente.
import { api } from '../comun/api.js';
import { $, alerta, pintarIconos } from '../comun/ui.js';
import { renderSeguimiento } from '../comun/seguimiento.js';
import { sesionActual } from '../comun/sesion.js';

pintarIconos();
$('#anio').textContent = new Date().getFullYear();

// Con sesión iniciada, el botón lleva directo a su sección.
sesionActual().then((u) => {
  if (!u) return;
  $('#btn-ingresar').href = u.destino;
  $('#btn-ingresar').textContent = u.rol === 'admin' ? 'Panel admin' : 'Mis pedidos';
  $('#btn-registro').remove();
});

const form = $('#form-buscar');
const resultado = $('#resultado');

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('button', form);
  btn.disabled = true;
  alerta($('#msg'), '', '');
  try {
    const s = await api('/api/seguimiento', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    resultado.innerHTML = renderSeguimiento(s);
    $('#como').classList.add('hidden');
    resultado.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    resultado.innerHTML = '';
    $('#como').classList.remove('hidden');
    alerta($('#msg'), 'error', err.message);
  } finally {
    btn.disabled = false;
  }
});
