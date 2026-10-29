// Panel admin · Pedidos: lista, alta y edición (con el estado de cada etapa y sus envíos).
import { apiPrivada } from '../../comun/api.js';
import { $, esc, fecha, alerta, pillEstado, duracion } from '../../comun/ui.js';
import { renderSeguimiento } from '../../comun/seguimiento.js';
import { crearResena, FILTROS, plazoHtml } from '../../comun/resena.js';
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
  alElegir: (u) => {
    mostrarEmailDeAvisos($('#f-taller-aviso'), u, 'Este taller');
    sugerirDireccion();
  },
});

// El perito se busca por su nombre, no por compañía (hay muchos más peritos que compañías).
const comboPerito = crearCombo($('#combo-perito'), {
  lista: () => estado.opciones?.peritos ?? [],
  titulo: (u) => u.nombre,
  detalle: (u) => [u.email, inactivo(u)].filter(Boolean).join(' · '),
  buscarEn: (u) => [u.nombre, u.email],
  alElegir: (u) => {
    mostrarEmailDeAvisos($('#f-perito-aviso'), u, 'Este perito');
    sugerirDireccion();
  },
});

// ---------------------------------------------------------------- Reseña de pedidos

const resena = crearResena($('#resena-pedidos'), {
  columnas: [
    { titulo: 'Siniestro', html: (p) => `<strong class="nowrap">${esc(p.siniestro)}</strong><div class="small muted">${esc(p.patente)}</div>` },
    { titulo: 'Vehículo', html: (p) => esc(p.vehiculo) },
    { titulo: 'Taller', html: (p) => esc(p.taller) },
    { titulo: 'Perito', html: (p) => esc(p.perito) },
    { titulo: 'Compañía', html: (p) => esc(p.compania) },
    { titulo: 'Expreso', html: (p) => esc(p.expresos.join(', ')) || '<span class="muted">—</span>' },
    { titulo: 'Estado', html: (p) => pillEstado(p, true) },
    { titulo: 'Entrega estimada', html: (p) => plazoHtml(p, true) },
    { titulo: 'Destino', html: (p) => destinoCorto(p.ubicacion) },
    { titulo: 'Actualizado', html: (p) => `<span class="small muted">${fecha(p.updated_at)}</span>` },
  ],
  selects: [FILTROS.expreso, FILTROS.compania, FILTROS.taller, FILTROS.perito],
  extrasExcel: [
    ['Dirección de entrega', (p) => p.ubicacion?.direccion ?? ''],
    ['Distancia desde Genco (km)', (p) => (p.ubicacion?.km != null ? Number(p.ubicacion.km).toLocaleString('es-AR') : '')],
    ['Tiempo en auto', (p) => duracion(p.ubicacion?.minutos)],
  ],
  vencidos: true,
  enlace: (p) => `#/pedidos/${p.id}`,
  vacio: 'Todavía no hay pedidos. Cargá el primero con «+ Nuevo pedido».',
});

export async function cargarPedidos() {
  resena.cargar(await apiPrivada('/api/admin/pedidos'));
}

// Plazo de entrega con un clic: hoy + N días.
$('#plazos-rapidos').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-dias]');
  if (!b) return;
  const d = new Date();
  d.setDate(d.getDate() + Number(b.dataset.dias));
  form.elements.plazo_entrega.value = d.toLocaleDateString('en-CA');
});

// ---------------------------------------------------------------- Destino del envío

// 694.5 -> "694,5 km"
const kms = (km) => `${Number(km).toLocaleString('es-AR')} km`;

// En la reseña: distancia y tiempo (la dirección completa al pasar el mouse).
function destinoCorto(u) {
  if (!u || u.estado === 'sin_direccion') return '<span class="muted">—</span>';
  const titulo = `title="${esc(u.direccion)}"`;
  if (u.estado === 'ok') return `<span ${titulo}><strong class="nowrap">${esc(kms(u.km))}</strong><div class="small muted nowrap">${esc(duracion(u.minutos))}</div></span>`;
  if (u.estado === 'no_encontrada') return `<span class="badge pendiente" ${titulo}>Revisar dirección</span>`;
  return `<span class="small muted" ${titulo}>Sin calcular</span>`;
}

const inputDestino = form.elements.destino_direccion;
const destinoElegido = () => form.querySelector('input[name=destino]:checked')?.value ?? '';
let ubicacionGuardada = null;

// Cuenta (taller o perito) elegida arriba en el formulario.
function cuentaDestino(tipo) {
  const lista = tipo === 'taller' ? estado.opciones?.talleres : tipo === 'perito' ? estado.opciones?.peritos : null;
  const id = form.elements[`${tipo}_id`]?.value;
  return (lista ?? []).find((u) => String(u.id) === String(id));
}

// Con "Al taller" / "Al perito" la dirección se completa con la de su cuenta (salvo que se haya escrito otra).
function sugerirDireccion() {
  const tipo = destinoElegido();
  const ayuda = $('#destino-ayuda');
  if (tipo === 'taller' || tipo === 'perito') {
    const quien = tipo === 'taller' ? 'el taller' : 'el perito';
    const u = cuentaDestino(tipo);
    if (!u) {
      ayuda.textContent = `Elegí ${quien} arriba y se usa su dirección.`;
    } else if (u.direccion) {
      if (!inputDestino.dataset.manual) inputDestino.value = u.direccion;
      ayuda.textContent = inputDestino.value.trim() === u.direccion
        ? `Dirección de ${u.empresa || u.nombre}.`
        : `Se usa la dirección escrita (la de ${u.empresa || u.nombre} es ${u.direccion}).`;
    } else {
      ayuda.textContent = `${u.empresa || u.nombre} no tiene dirección cargada: escribila acá o cargala en Usuarios.`;
    }
  } else {
    ayuda.textContent = 'Escribí la dirección completa: calle y número, ciudad y provincia.';
  }
  marcarDesactualizado();
}

// Si se cambió la dirección y todavía no se guardó, el mapa de abajo es el de la dirección anterior.
function marcarDesactualizado() {
  const nota = $('#destino-mapa .destino-pendiente');
  if (nota) nota.classList.toggle('hidden', inputDestino.value.trim() === (ubicacionGuardada?.direccion ?? ''));
}

form.addEventListener('change', (ev) => {
  if (ev.target.name !== 'destino') return;
  inputDestino.dataset.manual = '';
  if (ev.target.value === 'otra') {
    inputDestino.value = '';
    inputDestino.focus();
  }
  sugerirDireccion();
});
inputDestino.addEventListener('input', () => {
  inputDestino.dataset.manual = inputDestino.value.trim() ? '1' : '';
  marcarDesactualizado();
});

const MENSAJES_UBICACION = {
  no_encontrada: 'No encontramos esta dirección en el mapa. Revisala: calle y número, ciudad y provincia (ej: Av. Colón 1234, Córdoba).',
  sin_origen: 'Para calcular la distancia y el tiempo falta cargar la dirección de Genco (GENCO_DIRECCION en la configuración).',
  origen_no_encontrado: 'No encontramos la dirección de Genco en el mapa: revisá GENCO_DIRECCION en la configuración.',
  sin_ruta: 'No hay una ruta en auto hasta ese punto.',
  error: 'El servicio de mapas no respondió. Se vuelve a intentar solo.',
  calculando: 'Buscando la dirección en el mapa…',
};

let reintentos = 0;
function pintarUbicacion(u) {
  ubicacionGuardada = u;
  const caja = $('#destino-mapa');
  if (!u || u.estado === 'sin_direccion') {
    caja.classList.add('hidden');
    caja.innerHTML = '';
    return;
  }
  const punto = u.direccion;
  const enGoogle = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(punto)}`;
  const desde = u.origen_punto || u.origen;
  const rutaGoogle = desde
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(desde)}&destination=${encodeURIComponent(punto)}&travelmode=driving`
    : '';
  const d = 0.02;
  const mapa = u.lat != null
    ? `<iframe title="Mapa del destino" loading="lazy" referrerpolicy="no-referrer"
        src="https://www.openstreetmap.org/export/embed.html?bbox=${u.lon - d},${u.lat - d * 0.6},${u.lon + d},${u.lat + d * 0.6}&layer=mapnik&marker=${u.lat},${u.lon}"></iframe>`
    : '';
  const numeros = u.estado === 'ok'
    ? `<div class="destino-numeros">
        <div><strong>${esc(kms(u.km))}</strong><span>Distancia</span></div>
        <div><strong>${esc(duracion(u.minutos))}</strong><span>En auto, aprox.</span></div>
      </div>`
    : '';
  caja.classList.remove('hidden');
  caja.classList.toggle('sin-mapa', !mapa);
  caja.innerHTML = `${mapa}
    <div class="destino-datos">
      <p class="destino-direccion"><strong>${esc(u.direccion)}</strong>
        ${u.lugar ? `<span class="small muted">Ubicado en el mapa como: ${esc(u.lugar)}. Si no es ahí, completá la ciudad y la provincia.</span>` : ''}</p>
      ${numeros}
      ${MENSAJES_UBICACION[u.estado] ? `<p class="destino-aviso">${esc(MENSAJES_UBICACION[u.estado])}</p>` : ''}
      ${u.estado === 'ok' ? `<p class="small muted">Desde Genco: ${esc(u.origen)}. El expreso puede tardar más que un auto.</p>` : ''}
      <p class="destino-aviso destino-pendiente hidden">Cambiaste la dirección: guardá para actualizar el mapa.</p>
      <div class="destino-acciones">
        ${rutaGoogle ? `<a class="btn outline" href="${esc(rutaGoogle)}" target="_blank" rel="noopener noreferrer">Ver ruta en Google Maps ↗</a>` : ''}
        <a class="btn ghost" href="${esc(enGoogle)}" target="_blank" rel="noopener noreferrer">Abrir en Google Maps ↗</a>
      </div>
    </div>`;
  marcarDesactualizado();
  // Si la dirección todavía se está buscando, se vuelve a consultar en unos segundos.
  if (u.estado === 'calculando' && reintentos < 4 && form.dataset.id) {
    reintentos++;
    const id = form.dataset.id;
    setTimeout(async () => {
      if (form.dataset.id !== id) return;
      try {
        pintarUbicacion((await apiPrivada(`/api/admin/pedidos/${id}`)).ubicacion);
      } catch {
        // Se ve la próxima vez que se abra el pedido.
      }
    }, 3000);
  }
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
    alerta($('#pedido-msg'), 'ok', `Aviso enviado a ${r.enviados.join(', ')}. Si no lo ven, que revisen la carpeta de Spam.`);
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
  reintentos = 0;
  pintarUbicacion(null);
  inputDestino.dataset.manual = '';
  if (!id) {
    sugerirDireccion();
    return form.elements.siniestro.focus();
  }

  const p = await apiPrivada(`/api/admin/pedidos/${id}`);
  $('#pedido-titulo').textContent = `Siniestro ${p.siniestro}`;
  for (const el of form.elements) if (el.name && el.type !== 'radio') el.value = p[el.name] ?? '';
  form.querySelectorAll('input[name=destino]').forEach((r) => (r.checked = r.value === (p.destino || 'taller')));
  inputDestino.dataset.manual = p.destino_direccion ? '1' : '';
  form.dataset.version = p.version;
  comboTaller.set(p.taller_id);
  comboPerito.set(p.perito_id);
  pintarEnvios(p.envios);
  pintarAvisos(p.avisos);
  pintarUbicacion(p.ubicacion);
  sugerirDireccion();
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
