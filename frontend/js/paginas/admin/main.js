// Panel admin: arranque, navegación entre secciones y actualización automática.
import { $, refrescarPeriodicamente } from '../../comun/ui.js';
import { exigirSesion } from '../../comun/sesion.js';
import { estado, cargarOpciones, alCargarOpciones } from './estado.js';
import { cargarPedidos, abrirPedido } from './pedidos.js';
import { cargarUsuarios, abrirUsuario } from './usuarios.js';
import { cargarEstadoSendbox, despuesDeLeer } from './sendbox.js';

// La lista de pedidos viene con el estado de la lectura de Sendbox arriba.
const cargarListaPedidos = () => Promise.all([cargarPedidos(), cargarEstadoSendbox()]);
despuesDeLeer(cargarPedidos);

const VISTAS = ['pedidos', 'pedido', 'usuarios', 'usuario'];
let vistaActual = null;

function mostrar(vista) {
  vistaActual = vista;
  VISTAS.forEach((v) => $(`#view-${v}`).classList.toggle('hidden', v !== vista));
  const tab = vista.startsWith('usuario') ? 'usuarios' : 'pedidos';
  document.querySelectorAll('.tabs a').forEach((a) =>
    a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  scrollTo(0, 0);
}

// Contador de cuentas por aprobar en la pestaña "Usuarios".
alCargarOpciones(({ pendientes }) => {
  $('#tab-pendientes').textContent = pendientes;
  $('#tab-pendientes').classList.toggle('hidden', !pendientes);
});

const RUTAS = [
  [/^#\/pedidos\/nuevo$/, 'pedido', () => abrirPedido(null)],
  [/^#\/pedidos\/(\d+)$/, 'pedido', (m) => abrirPedido(m[1])],
  [/^#\/usuarios\/nuevo$/, 'usuario', () => abrirUsuario(null)],
  [/^#\/usuarios\/(\d+)$/, 'usuario', (m) => abrirUsuario(m[1])],
  [/^#\/usuarios$/, 'usuarios', () => cargarUsuarios()],
  [/.*/, 'pedidos', () => cargarListaPedidos()],
];

async function route() {
  const hash = location.hash || '#/';
  const [regex, vista, abrir] = RUTAS.find(([re]) => re.test(hash));
  mostrar(vista);
  try {
    await abrir(hash.match(regex));
  } catch (err) {
    if (err.status !== 401) alert(err.message);
  }
}

// Las filas de las tablas llevan a su ficha.
document.addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr[data-href]');
  if (tr) location.hash = tr.dataset.href;
});
window.addEventListener('hashchange', route);

estado.yo = await exigirSesion(['admin']);
if (estado.yo) {
  await cargarOpciones();
  await route();
  // Para ver lo que cargan los demás administradores sin recargar: se actualizan las listas
  // (los formularios abiertos no se tocan, para no perder lo que se está escribiendo).
  refrescarPeriodicamente(async () => {
    try {
      await cargarOpciones();
      if (vistaActual === 'pedidos') await cargarListaPedidos();
      if (vistaActual === 'usuarios') await cargarUsuarios();
    } catch {
      // Sin conexión por un momento: se reintenta en el próximo ciclo.
    }
  });
}
