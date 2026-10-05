// Panel admin · Envíos de un pedido. Con despacho parcial se manda una parte y lo que falta va en
// otro envío, cada uno con su remito, expreso, número de guía, estado del viaje y entrega.
import { $, esc } from '../../comun/ui.js';
import { estado } from './estado.js';

const form = $('#form-pedido');
const contenedor = $('#envios');
const botonAgregar = $('#agregar-envio');
const despacho = () => form.elements.despacho.value;
let siguienteId = 0;

const opciones = (valores, elegido, vacio) =>
  `<option value="">${vacio}</option>` +
  Object.entries(valores).map(([k, v]) => `<option value="${k}" ${k === elegido ? 'selected' : ''}>${esc(v)}</option>`).join('');

function tarjeta(e = {}) {
  const { transportes, entregas } = estado.opciones;
  const id = `envio-${siguienteId++}`;
  return `<div class="envio-form" data-id="${e.id ?? ''}">
    <div class="envio-head">
      <strong class="envio-titulo"></strong>
      <button type="button" class="btn danger" data-quitar>Quitar</button>
    </div>
    <div class="grid">
      <div><label for="${id}-remito">N° de remito *</label><input id="${id}-remito" data-campo="remito" value="${esc(e.remito)}"></div>
      <div><label for="${id}-transporte">Expreso</label>
        <select id="${id}-transporte" data-campo="transporte">${opciones(transportes, e.transporte, 'Sin asignar')}</select></div>
      <div><label for="${id}-guia">N° de guía</label><input id="${id}-guia" data-campo="guia" value="${esc(e.guia)}"></div>
      <div><label for="${id}-viaje">Estado del viaje</label>
        <input id="${id}-viaje" data-campo="estado_viaje" list="estados-viaje" placeholder="Ej: En viaje" value="${esc(e.estado_viaje)}"></div>
      <div><label for="${id}-entrega">Entrega</label>
        <select id="${id}-entrega" data-campo="entrega">${opciones(entregas, e.entrega, '—')}</select></div>
    </div>
  </div>`;
}

// Títulos ("Envío" o "Envío 1, 2...") y textos que dependen de cuántos envíos hay y del tipo de despacho.
function actualizar() {
  const tarjetas = [...contenedor.querySelectorAll('.envio-form')];
  const numerar = tarjetas.length > 1 || despacho() === 'parcial';
  tarjetas.forEach((t, i) => ($('.envio-titulo', t).textContent = numerar ? `Envío ${i + 1}` : 'Envío'));
  botonAgregar.textContent = !tarjetas.length ? '+ Agregar envío'
    : despacho() === 'parcial' ? '+ Agregar envío con lo que falta' : '+ Agregar otro envío';
  $('#envios-ayuda').classList.toggle('hidden', despacho() !== 'parcial');
}

export function pintarEnvios(lista = []) {
  contenedor.innerHTML = lista.map(tarjeta).join('');
  actualizar();
}

function agregarEnvio() {
  contenedor.insertAdjacentHTML('beforeend', tarjeta());
  actualizar();
  $('[data-campo=remito]', contenedor.lastElementChild).focus();
}

export const leerEnvios = () =>
  [...contenedor.querySelectorAll('.envio-form')].map((t) => ({
    id: t.dataset.id || null,
    ...Object.fromEntries([...t.querySelectorAll('[data-campo]')].map((c) => [c.dataset.campo, c.value])),
  }));

botonAgregar.addEventListener('click', agregarEnvio);

contenedor.addEventListener('click', (ev) => {
  if (!ev.target.closest('[data-quitar]')) return;
  const t = ev.target.closest('.envio-form');
  if (t.dataset.id && !confirm('¿Quitar este envío? Se borra al guardar el pedido.')) return;
  t.remove();
  actualizar();
});

// Al elegir el tipo de despacho, si todavía no hay envíos aparece el primero para cargar.
form.elements.despacho.addEventListener('change', () => {
  if (despacho() && !contenedor.children.length) agregarEnvio();
  actualizar();
});
