// Utilidades de interfaz compartidas por todas las páginas.

export const $ = (selector, raiz = document) => raiz.querySelector(selector);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function fecha(s) {
  if (!s) return '';
  // Las fechas de la base vienen en UTC sin zona ("YYYY-MM-DD HH:MM:SS").
  const d = new Date(/^\d{4}-\d{2}-\d{2} /.test(s) ? s.replace(' ', 'T') + 'Z' : s);
  if (isNaN(d)) return esc(s);
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

// Muestra un aviso dentro de `el` (tipo: ok | error | info). Con `accion` ({ texto, alHacerClic })
// agrega un botón, por ejemplo "Recargar".
export function alerta(el, tipo, mensaje, accion) {
  el.innerHTML = mensaje
    ? `<div class="alert ${tipo}" role="${tipo === 'error' ? 'alert' : 'status'}">
        <span>${esc(mensaje)}</span>${accion ? `<button type="button" class="btn sm">${esc(accion.texto)}</button>` : ''}
      </div>`
    : '';
  if (mensaje && accion) el.querySelector('button').addEventListener('click', accion.alHacerClic);
}

export const ICONOS = {
  origen: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  despacho: '<path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1Z"/><path d="M16 5h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2"/><path d="M9 12h6M9 16h4"/>',
  expreso: '<path d="M2 6h12v10H2z"/><path d="M14 9h4.5L22 12.5V16h-8z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="18" cy="17.5" r="1.8"/>',
  entrega: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="m9 15 2 2 4-4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  llave: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  salir: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  taller: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5Z"/>',
  perito: '<path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1Z"/><path d="M16 5h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2"/><path d="m9 14 2 2 4-4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  ojo: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
};

export const icono = (nombre) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONOS[nombre]}</svg>`;

// Completa los elementos marcados con data-icono="nombre".
export function pintarIconos(raiz = document) {
  raiz.querySelectorAll('[data-icono]').forEach((el) => (el.innerHTML = icono(el.dataset.icono)));
}

// Celda de tabla con etiqueta (en celular cada fila se muestra como tarjeta). `html` ya escapado.
export const celda = (etiqueta, html) => `<td data-label="${etiqueta}">${html ?? ''}</td>`;

export function pillEstado({ estado, recibido }, chico = false) {
  return `<span class="pill ${recibido ? 'ok' : ''}${chico ? ' sm' : ''}">${recibido ? '' : '<span class="pulse"></span>'}${esc(estado)}</span>`;
}

// Botón de mostrar / ocultar contraseña (data-ver="id-del-input").
export function activarVerPassword(raiz = document) {
  raiz.querySelectorAll('[data-ver]').forEach((btn) => {
    btn.innerHTML = icono('ojo');
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.ver);
      const mostrar = input.type === 'password';
      input.type = mostrar ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(mostrar));
      btn.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
  });
}

// Ejecuta `fn` cuando la pestaña vuelve a estar visible y cada `cadaMs` mientras lo está,
// para ver lo que cargan otras personas sin recargar la página.
export function refrescarPeriodicamente(fn, cadaMs = 60_000) {
  const siVisible = () => document.visibilityState === 'visible' && fn();
  document.addEventListener('visibilitychange', siVisible);
  setInterval(siVisible, cadaMs);
}
