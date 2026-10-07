// Panel admin · Estado de la lectura automática de Sendbox (arriba de la lista de pedidos).
import { apiPrivada } from '../../comun/api.js';
import { $, esc, fecha } from '../../comun/ui.js';

const caja = $('#estado-sendbox');
const boton = $('#sendbox-leer');
let alActualizar = () => {};

// Para recargar la lista de pedidos después de "Actualizar ahora".
export const despuesDeLeer = (fn) => (alActualizar = fn);

function pintar(s) {
  caja.classList.remove('hidden');
  const badge = $('#sendbox-badge');
  let resumen;
  if (!s.configurado) {
    badge.className = 'badge gris';
    badge.textContent = 'Manual';
    resumen = 'La lectura automática no está configurada: completá SENDBOX_USUARIO y SENDBOX_CLAVE en el archivo .env.';
  } else if (s.error) {
    badge.className = 'badge error';
    badge.textContent = 'No se pudo leer';
    resumen = `${s.error}. Mientras tanto, los envíos de Sendbox se pueden actualizar a mano.`;
  } else {
    badge.className = 'badge ok';
    badge.textContent = 'Automático';
    resumen = s.ultimaLectura
      ? `Última lectura: ${fecha(s.ultimaLectura)} · ${s.consultados} envío(s) en curso · ${s.actualizados} actualizado(s). Se lee sola cada ${s.intervaloMin} min.`
      : `Se lee sola cada ${s.intervaloMin} minutos. La primera lectura está por empezar.`;
  }
  $('#sendbox-resumen').textContent = resumen;
  boton.classList.toggle('hidden', !s.configurado);
  boton.disabled = s.leyendo;
  boton.textContent = s.leyendo ? 'Leyendo Sendbox…' : 'Actualizar ahora';
  $('#sendbox-avisos').innerHTML = (s.avisos ?? [])
    .map((a) => `<li><a href="#/pedidos/${a.pedido_id}">Siniestro ${esc(a.siniestro)}</a> · guía ${esc(a.guia)}: ${esc(a.texto)}</li>`)
    .join('');
}

export async function cargarEstadoSendbox() {
  pintar(await apiPrivada('/api/admin/sendbox'));
}

boton.addEventListener('click', async () => {
  boton.disabled = true;
  boton.textContent = 'Leyendo Sendbox…';
  try {
    pintar(await apiPrivada('/api/admin/sendbox/leer', { method: 'POST' }));
    await alActualizar();
  } catch (err) {
    alert(err.message);
    await cargarEstadoSendbox().catch(() => {});
  }
});
