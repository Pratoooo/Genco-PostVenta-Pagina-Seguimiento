// Panel admin · Envíos de un pedido. Con despacho parcial se manda una parte y lo que falta va en
// otro envío, cada uno con su remito, expreso, número de guía y estado.
// Todo se carga a mano: el expreso y el estado se eligen con un clic, y los estados más comunes
// están a mano como botones.
import { $, esc } from '../../comun/ui.js';
import { estado } from './estado.js';

const form = $('#form-pedido');
const contenedor = $('#envios');
const botonAgregar = $('#agregar-envio');
const despacho = () => form.elements.despacho.value;
let siguienteId = 0;

// Dónde está el envío (define si el pedido figura en camino o recibido).
const UBICACIONES = [['', 'Preparando'], ['en_camino', 'En camino'], ['recibido', 'Recibido']];

// Estados del viaje más comunes: un clic completa el texto y la ubicación.
const ESTADOS_RAPIDOS = [
  ['Retirado por el expreso', 'en_camino'],
  ['En viaje', 'en_camino'],
  ['En sucursal de destino', 'en_camino'],
  ['En reparto', 'en_camino'],
  ['Entregado en el taller', 'recibido'],
];

const opcionesChip = (nombre, grupo, valores, elegido) =>
  valores.map(([valor, texto]) => `<label class="chip-opcion">
      <input type="radio" name="${nombre}" value="${valor}" data-radio="${grupo}" ${valor === (elegido ?? '') ? 'checked' : ''}>
      <span>${esc(texto)}</span>
    </label>`).join('');

function tarjeta(e = {}) {
  const id = `envio-${siguienteId++}`;
  const expresos = Object.entries(estado.opciones.transportes);
  return `<div class="envio-form" data-id="${e.id ?? ''}">
    <div class="envio-head">
      <strong class="envio-titulo"></strong>
      <button type="button" class="btn danger" data-quitar>Quitar</button>
    </div>
    <div class="grid">
      <div><label for="${id}-remito">N° de remito *</label><input id="${id}-remito" data-campo="remito" value="${esc(e.remito)}"></div>
      <div><label for="${id}-guia">N° de guía</label><input id="${id}-guia" data-campo="guia" value="${esc(e.guia)}" autocomplete="off">
        <div class="hint envio-pagina"></div></div>
    </div>
    <fieldset class="campo-chips">
      <legend>Expreso</legend>
      <div class="chips-elegir">${opcionesChip(`${id}-transporte`, 'transporte', expresos, e.transporte)}</div>
    </fieldset>
    <fieldset class="campo-chips">
      <legend>¿Dónde está?</legend>
      <div class="chips-elegir">${opcionesChip(`${id}-entrega`, 'entrega', UBICACIONES, e.entrega)}</div>
    </fieldset>
    <div class="campo-viaje">
      <label for="${id}-viaje">Estado del viaje <span class="muted">· lo ven el taller y el perito</span></label>
      <input id="${id}-viaje" data-campo="estado_viaje" placeholder="Escribilo o elegí uno de abajo" value="${esc(e.estado_viaje)}" autocomplete="off">
      <div class="estados-rapidos">${ESTADOS_RAPIDOS.map(([texto, entrega]) =>
        `<button type="button" class="chip-rapido" data-estado="${esc(texto)}" data-entrega="${entrega}">${esc(texto)}</button>`).join('')}</div>
    </div>
  </div>`;
}

// Debajo de la guía: enlace a la página del expreso (copia la guía y la abre), para revisar el estado.
function actualizarTarjeta(t) {
  const expreso = t.querySelector('[data-radio=transporte]:checked')?.value ?? '';
  const guia = $('[data-campo=guia]', t).value.trim();
  const url = estado.opciones.paginasSeguimiento?.[expreso];
  const nombre = estado.opciones.transportes[expreso];
  const ayuda = $('.envio-pagina', t);
  if (url && guia) {
    ayuda.innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-copiar="${esc(guia)}" data-copiar-destino="${esc(nombre)}">Ver el estado en ${esc(nombre)} ↗</a> · copia la guía y abre su página`;
  } else if (expreso && !url) {
    ayuda.textContent = `${nombre}: el estado del viaje se carga a mano acá abajo.`;
  } else {
    ayuda.textContent = '';
  }
  const texto = $('[data-campo=estado_viaje]', t).value.trim();
  t.querySelectorAll('.chip-rapido').forEach((b) => b.classList.toggle('activo', b.dataset.estado === texto));
}

// Títulos ("Envío" o "Envío 1, 2...") y textos que dependen de cuántos envíos hay y del tipo de despacho.
function actualizar() {
  const tarjetas = [...contenedor.querySelectorAll('.envio-form')];
  const numerar = tarjetas.length > 1 || despacho() === 'parcial';
  tarjetas.forEach((t, i) => {
    $('.envio-titulo', t).textContent = numerar ? `Envío ${i + 1}` : 'Envío';
    actualizarTarjeta(t);
  });
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
    transporte: t.querySelector('[data-radio=transporte]:checked')?.value ?? '',
    entrega: t.querySelector('[data-radio=entrega]:checked')?.value ?? '',
  }));

botonAgregar.addEventListener('click', agregarEnvio);

contenedor.addEventListener('click', (ev) => {
  // Estado rápido: completa el texto y marca dónde está el envío.
  const rapido = ev.target.closest('.chip-rapido');
  if (rapido) {
    const t = rapido.closest('.envio-form');
    $('[data-campo=estado_viaje]', t).value = rapido.dataset.estado;
    const ubicacion = t.querySelector(`[data-radio=entrega][value="${rapido.dataset.entrega}"]`);
    if (ubicacion) ubicacion.checked = true;
    actualizarTarjeta(t);
    return;
  }
  if (!ev.target.closest('[data-quitar]')) return;
  const t = ev.target.closest('.envio-form');
  if (t.dataset.id && !confirm('¿Quitar este envío? Se borra al guardar el pedido.')) return;
  t.remove();
  actualizar();
});

contenedor.addEventListener('input', (ev) => {
  const t = ev.target.closest('.envio-form');
  if (t) actualizarTarjeta(t);
});
contenedor.addEventListener('change', (ev) => {
  const t = ev.target.closest('.envio-form');
  if (t) actualizarTarjeta(t);
});

// Al elegir el tipo de despacho, si todavía no hay envíos aparece el primero para cargar.
form.elements.despacho.addEventListener('change', () => {
  if (despacho() && !contenedor.children.length) agregarEnvio();
  actualizar();
});
