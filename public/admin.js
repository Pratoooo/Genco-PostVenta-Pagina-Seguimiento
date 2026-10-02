const $ = (sel) => document.querySelector(sel);
const formPedido = $('#form-pedido');
const formUsuario = $('#form-usuario');
const VISTAS = ['pedidos', 'pedido', 'usuarios', 'usuario'];
let opciones = null;
let yo = null;
let avisoPendiente = null;

function mostrar(vista) {
  VISTAS.forEach((v) => $(`#view-${v}`).classList.toggle('hidden', v !== vista));
  const tab = vista.startsWith('usuario') ? 'usuarios' : 'pedidos';
  document.querySelectorAll('.tabs a').forEach((a) =>
    a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  scrollTo(0, 0);
}

// Rearma las opciones conservando lo que estaba elegido.
function llenarSelect(select, valores, vacio) {
  const actual = select.value;
  select.innerHTML = (vacio ? `<option value="">${vacio}</option>` : '') +
    Object.entries(valores).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  if ([...select.options].some((o) => o.value === actual)) select.value = actual;
}

// Talleres: "Taller Sur (Carlos Fernández)". Peritos y admins: su nombre.
function etiquetaUsuario(u) {
  return u.rol === 'taller' && u.empresa ? `${u.empresa} (${u.nombre})` : u.nombre;
}

const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Resalta la parte que coincide con lo buscado (sin importar acentos ni mayúsculas).
function resaltar(texto, q) {
  const i = q ? sinAcentos(texto).indexOf(q) : -1;
  if (i < 0) return esc(texto);
  return esc(texto.slice(0, i)) + `<mark>${esc(texto.slice(i, i + q.length))}</mark>` + esc(texto.slice(i + q.length));
}

// Buscador para elegir un taller o un perito escribiendo su nombre.
function crearCombo(raiz, { lista, titulo, detalle, buscarEn }) {
  const input = raiz.querySelector('input[type=text]');
  const oculto = raiz.querySelector('input[type=hidden]');
  const ul = raiz.querySelector('ul');
  const quitar = raiz.querySelector('.combo-quitar');
  let elegido = null;
  let resultados = [];
  let activo = -1;
  let q = '';

  function pintar() {
    ul.innerHTML = resultados.length
      ? resultados.map((u, i) => `<li role="option" id="${ul.id}-${i}" data-i="${i}" aria-selected="${i === activo}">
          <span>${resaltar(titulo(u), q)}</span>${detalle(u) ? `<small>${esc(detalle(u))}</small>` : ''}</li>`).join('')
      : '<li class="vacio">No se encontró. Revisá el nombre o creá el usuario.</li>';
    input.setAttribute('aria-activedescendant', activo >= 0 ? `${ul.id}-${activo}` : '');
  }
  function abrir(texto = input.value) {
    q = sinAcentos(texto.trim());
    resultados = lista().filter((u) => !q || buscarEn(u).some((t) => sinAcentos(t).includes(q))).slice(0, 50);
    activo = resultados.length ? 0 : -1;
    pintar();
    ul.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  }
  function cerrar() {
    ul.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
  }
  function elegir(u) {
    elegido = u;
    oculto.value = u ? u.id : '';
    input.value = u ? titulo(u) : '';
    quitar.classList.toggle('hidden', !u);
    cerrar();
  }

  input.addEventListener('focus', () => {
    input.select();
    abrir('');
  });
  input.addEventListener('input', () => abrir());
  input.addEventListener('keydown', (ev) => {
    const abierto = !ul.classList.contains('hidden');
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!abierto) return abrir();
      if (!resultados.length) return;
      activo = (activo + (ev.key === 'ArrowDown' ? 1 : -1) + resultados.length) % resultados.length;
      pintar();
      ul.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter' && abierto) {
      ev.preventDefault();
      if (resultados[activo]) elegir(resultados[activo]);
    } else if (ev.key === 'Escape') {
      cerrar();
    }
  });
  // mousedown: elegir antes de que el campo pierda el foco.
  ul.addEventListener('mousedown', (ev) => {
    const li = ev.target.closest('li[data-i]');
    ev.preventDefault();
    if (li) elegir(resultados[li.dataset.i]);
  });
  // Si se escribió algo y no se eligió de la lista, queda lo que estaba asignado. Para sacarlo, la ×.
  input.addEventListener('blur', () => elegir(elegido));
  quitar.addEventListener('click', () => {
    elegir(null);
    input.focus();
  });

  return { set: (id) => elegir(lista().find((u) => String(u.id) === String(id)) ?? null) };
}

const inactivo = (u) => (u.activo ? '' : 'inactivo');

const comboTaller = crearCombo($('#combo-taller'), {
  lista: () => opciones?.talleres ?? [],
  titulo: (u) => u.empresa || u.nombre,
  detalle: (u) => [u.empresa && u.nombre, inactivo(u)].filter(Boolean).join(' · '),
  buscarEn: (u) => [u.empresa, u.nombre],
});

// Los peritos se buscan por su nombre (o usuario), no por compañía.
const comboPerito = crearCombo($('#combo-perito'), {
  lista: () => opciones?.peritos ?? [],
  titulo: (u) => u.nombre,
  detalle: (u) => [u.usuario, u.empresa, inactivo(u)].filter(Boolean).join(' · '),
  buscarEn: (u) => [u.nombre, u.usuario],
});

// Compañías de un perito: se escriben (o se eligen de la lista) y quedan como etiquetas.
function crearChips(raiz) {
  const input = raiz.querySelector('input');
  let valores = [];

  function pintar() {
    raiz.querySelectorAll('.chip').forEach((c) => c.remove());
    valores.forEach((v, i) => input.insertAdjacentHTML('beforebegin',
      `<span class="chip">${esc(v)}<button type="button" data-i="${i}" aria-label="Quitar ${esc(v)}">×</button></span>`));
  }
  function agregar(texto) {
    for (const v of texto.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean)) {
      if (!valores.some((x) => sinAcentos(x) === sinAcentos(v))) valores.push(v);
    }
    input.value = '';
    pintar();
  }

  input.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ',') && input.value.trim()) {
      ev.preventDefault();
      agregar(input.value);
    } else if (ev.key === 'Backspace' && !input.value && valores.length) {
      valores.pop();
      pintar();
    }
  });
  // Elegir una sugerencia de la lista la agrega directo.
  input.addEventListener('input', (ev) => {
    if (ev.inputType === 'insertReplacementText' || (ev.inputType === undefined && COMPANIAS.includes(input.value))) {
      agregar(input.value);
    }
  });
  input.addEventListener('blur', () => input.value.trim() && agregar(input.value));
  raiz.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-i]');
    if (btn) {
      valores.splice(Number(btn.dataset.i), 1);
      pintar();
    }
    input.focus();
  });

  return {
    valor: () => valores.join(', '),
    set(texto) {
      valores = [];
      agregar(texto || '');
    },
  };
}

const chipsCompanias = crearChips($('#u-chips'));
$('#u-companias').innerHTML = COMPANIAS.map((c) => `<option>${esc(c)}</option>`).join('');

// Taller: nombre del taller. Perito: sus compañías. Admin: nada.
function actualizarCampoEmpresa() {
  const rol = formUsuario.elements.rol.value;
  $('#u-taller-campo').classList.toggle('hidden', rol !== 'taller');
  $('#u-companias-campo').classList.toggle('hidden', rol !== 'perito');
}
formUsuario.elements.rol.addEventListener('change', actualizarCampoEmpresa);

function empresaDelFormulario() {
  const rol = formUsuario.elements.rol.value;
  return rol === 'taller' ? $('#u-empresa').value : rol === 'perito' ? chipsCompanias.valor() : '';
}

async function cargarOpciones() {
  opciones = await apiPrivada('/api/admin/opciones');
  const f = formPedido.elements;
  llenarSelect(f.origen, opciones.origenes, 'En revisión');
  llenarSelect(f.despacho, opciones.despachos, 'Sin despachar');
  llenarSelect(f.transporte, opciones.transportes, 'Sin asignar');
  llenarSelect(f.entrega, opciones.entregas, '—');
  llenarSelect(formUsuario.elements.rol, opciones.roles);
  $('#tab-pendientes').textContent = opciones.pendientes;
  $('#tab-pendientes').classList.toggle('hidden', !opciones.pendientes);
}

// ------------------------------------------------------------ Pedidos

let timer;
$('#buscar').addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(cargarPedidos, 250);
});

async function cargarPedidos() {
  const rows = await apiPrivada(`/api/admin/pedidos?q=${encodeURIComponent($('#buscar').value)}`);
  $('#tabla-pedidos').innerHTML = rows.length
    ? rows.map((p) => `<tr class="clickable" data-href="#/pedidos/${p.id}">
        ${celda('Siniestro', `<strong>${esc(p.siniestro)}</strong>`)}${celda('Patente', esc(p.patente))}
        ${celda('Vehículo', esc(p.vehiculo))}${celda('Taller', esc(p.taller))}${celda('Perito', esc(p.perito))}
        ${celda('Compañía', esc(p.compania))}${celda('Estado', pillEstado(p, true))}
        ${celda('Actualizado', `<span class="small muted">${fecha(p.updated_at)}</span>`)}</tr>`).join('')
    : '<tr><td colspan="8" class="empty">No hay pedidos.</td></tr>';
}

async function abrirPedido(id) {
  mostrar('pedido');
  formPedido.reset();
  alerta($('#pedido-msg'), '', '');
  $('#borrar-pedido').classList.toggle('hidden', !id);
  $('#vista-previa').classList.toggle('hidden', !id);
  $('#pedido-titulo').textContent = 'Nuevo pedido';
  formPedido.dataset.id = id || '';
  comboTaller.set(null);
  comboPerito.set(null);
  if (!id) return formPedido.elements.siniestro.focus();

  const p = await apiPrivada(`/api/admin/pedidos/${id}`);
  $('#pedido-titulo').textContent = `Siniestro ${p.siniestro}`;
  for (const el of formPedido.elements) if (el.name) el.value = p[el.name] ?? '';
  comboTaller.set(p.taller_id);
  comboPerito.set(p.perito_id);
  $('#preview').innerHTML = renderSeguimiento(p.seguimiento);
}

formPedido.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id = formPedido.dataset.id;
  const btn = formPedido.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(formPedido));
    const p = await apiPrivada(id ? `/api/admin/pedidos/${id}` : '/api/admin/pedidos', { method: id ? 'PUT' : 'POST', body });
    if (!id) return (location.hash = `#/pedidos/${p.id}`);
    await abrirPedido(id);
    alerta($('#pedido-msg'), 'ok', 'Cambios guardados.');
  } catch (err) {
    alerta($('#pedido-msg'), 'error', err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#borrar-pedido').addEventListener('click', async () => {
  if (!confirm('¿Eliminar este pedido? No se puede deshacer.')) return;
  await apiPrivada(`/api/admin/pedidos/${formPedido.dataset.id}`, { method: 'DELETE' });
  location.hash = '#/';
});

// ------------------------------------------------------------ Usuarios

async function cargarUsuarios() {
  const todos = await apiPrivada('/api/admin/usuarios');
  const pendientes = todos.filter((u) => !u.aprobado);
  $('#pendientes').classList.toggle('hidden', !pendientes.length);
  $('#lista-pendientes').innerHTML = pendientes
    .map((u) => `<div class="pendiente-item">
      <div><strong>${esc(u.nombre)}</strong> <span class="badge">${esc(opciones.roles[u.rol])}</span>
        ${u.rol === 'taller' && u.empresa ? `<div>Taller: <strong>${esc(u.empresa)}</strong></div>` : ''}        <div class="small muted">Usuario: ${esc(u.usuario)}${u.email ? ` · ${esc(u.email)}` : ''} · se registró el ${fecha(u.created_at)}</div></div>
      <div class="acciones">
        <button class="btn danger" type="button" data-rechazar="${u.id}">Rechazar</button>
        ${u.rol === 'perito'
          ? `<a class="btn sm" href="#/usuarios/${u.id}">Cargar compañías y aprobar</a>`
          : `<button class="btn sm" type="button" data-aprobar="${u.id}">Aprobar</button>`}
      </div>
    </div>`)
    .join('');

  $('#tabla-usuarios').innerHTML = todos
    .filter((u) => u.aprobado)
    .map((u) => `<tr class="clickable" data-href="#/usuarios/${u.id}">
      ${celda('Nombre', `<strong>${esc(u.nombre)}</strong>${u.id === yo.id ? ' <span class="small muted">(vos)</span>' : ''}`)}
      ${celda('Taller / Compañías', esc(u.empresa))}
      ${celda('Usuario', esc(u.usuario))}
      ${celda('Rol', `<span class="badge ${u.rol === 'admin' ? 'admin' : ''}">${esc(opciones.roles[u.rol])}</span>`)}
      ${celda('Pedidos', u.rol === 'admin' ? '—' : u.pedidos)}
      ${celda('Estado', u.activo ? '<span class="badge ok">Activo</span>' : '<span class="badge gris">Inactivo</span>')}
      ${celda('Alta', `<span class="small muted">${fecha(u.created_at)}</span>`)}</tr>`)
    .join('');
}

async function aprobar(id) {
  await apiPrivada(`/api/admin/usuarios/${id}/aprobar`, { method: 'POST' });
  await cargarOpciones();
}

$('#lista-pendientes').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  try {
    if (btn.dataset.aprobar) {
      btn.disabled = true;
      await aprobar(btn.dataset.aprobar);
    } else if (btn.dataset.rechazar) {
      if (!confirm('¿Rechazar esta solicitud? Se elimina la cuenta.')) return;
      await apiPrivada(`/api/admin/usuarios/${btn.dataset.rechazar}`, { method: 'DELETE' });
      await cargarOpciones();
    }
    await cargarUsuarios();
  } catch (err) {
    alert(err.message);
  }
});

// Guarda lo cargado en el formulario (por ejemplo las compañías del perito) y aprueba la cuenta.
$('#aprobar-usuario').addEventListener('click', async () => {
  const id = formUsuario.dataset.id;
  try {
    await apiPrivada(`/api/admin/usuarios/${id}`, { method: 'PUT', body: datosUsuario() });
    await aprobar(id);
    await abrirUsuario(id);
    alerta($('#usuario-msg'), 'ok', 'Cuenta aprobada. Ya puede iniciar sesión.');
  } catch (err) {
    alerta($('#usuario-msg'), 'error', err.message);
  }
});

function generarPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

$('#generar').addEventListener('click', () => {
  formUsuario.elements.password.value = generarPassword();
  formUsuario.elements.password.select();
});

async function abrirUsuario(id) {
  mostrar('usuario');
  formUsuario.reset();
  alerta($('#usuario-msg'), '', '');
  $('#aviso-pendiente').classList.add('hidden');
  formUsuario.dataset.id = id || '';
  $('#borrar-usuario').classList.toggle('hidden', !id);
  $('#usuario-titulo').textContent = 'Nuevo usuario';
  $('#u-password-label').textContent = id ? 'Nueva contraseña' : 'Contraseña *';
  $('#u-password-hint').textContent = id
    ? 'Dejala vacía para no cambiarla. Si la cambiás, se cierran sus sesiones abiertas.'
    : 'Mínimo 8 caracteres. Compartila con la persona para que ingrese.';
  formUsuario.elements.password.required = !id;
  chipsCompanias.set('');
  if (!id) {
    formUsuario.elements.rol.value = 'taller';
    actualizarCampoEmpresa();
    formUsuario.elements.password.value = generarPassword();
    return $('#u-empresa').focus();
  }
  const u = await apiPrivada(`/api/admin/usuarios/${id}`);
  $('#usuario-titulo').textContent = etiquetaUsuario(u);
  for (const campo of ['nombre', 'usuario', 'rol', 'email']) formUsuario.elements[campo].value = u[campo] ?? '';
  $('#u-empresa').value = u.rol === 'taller' ? u.empresa : '';
  chipsCompanias.set(u.rol === 'perito' ? u.empresa : '');
  formUsuario.elements.activo.checked = Boolean(u.activo);
  actualizarCampoEmpresa();
  $('#aviso-pendiente').classList.toggle('hidden', Boolean(u.aprobado));
  if (avisoPendiente) alerta($('#usuario-msg'), 'ok', avisoPendiente);
  avisoPendiente = null;
}

function datosUsuario() {
  const f = formUsuario.elements;
  return {
    nombre: f.nombre.value, usuario: f.usuario.value, rol: f.rol.value, empresa: empresaDelFormulario(),
    email: f.email.value, activo: f.activo.checked, password: f.password.value,
  };
}

formUsuario.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id = formUsuario.dataset.id;
  const f = formUsuario.elements;
  const body = datosUsuario();
  try {
    const u = await apiPrivada(id ? `/api/admin/usuarios/${id}` : '/api/admin/usuarios', { method: id ? 'PUT' : 'POST', body });
    await cargarOpciones();
    if (!id) {
      avisoPendiente = `Usuario creado. Para ingresar: usuario "${u.usuario}" y la contraseña "${body.password}".`;
      location.hash = `#/usuarios/${u.id}`;
      return;
    }
    f.password.value = '';
    $('#usuario-titulo').textContent = etiquetaUsuario(u);
    alerta($('#usuario-msg'), 'ok', body.password ? 'Cambios guardados. La contraseña se actualizó.' : 'Cambios guardados.');
  } catch (err) {
    alerta($('#usuario-msg'), 'error', err.message);
  }
});

$('#borrar-usuario').addEventListener('click', async () => {
  if (!confirm('¿Eliminar este usuario? Sus pedidos quedan sin asignar. Si solo querés quitarle el acceso, desactivalo.')) return;
  try {
    await apiPrivada(`/api/admin/usuarios/${formUsuario.dataset.id}`, { method: 'DELETE' });
    await cargarOpciones();
    location.hash = '#/usuarios';
  } catch (err) {
    alerta($('#usuario-msg'), 'error', err.message);
  }
});

// ------------------------------------------------------------ Navegación

document.addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr[data-href]');
  if (tr) location.hash = tr.dataset.href;
});

async function route() {
  const h = location.hash || '#/';
  try {
    let m;
    if (h === '#/pedidos/nuevo') return await abrirPedido(null);
    if ((m = h.match(/^#\/pedidos\/(\d+)$/))) return await abrirPedido(m[1]);
    if (h === '#/usuarios/nuevo') return await abrirUsuario(null);
    if ((m = h.match(/^#\/usuarios\/(\d+)$/))) return await abrirUsuario(m[1]);
    if (h === '#/usuarios') {
      mostrar('usuarios');
      return await cargarUsuarios();
    }
    mostrar('pedidos');
    await cargarPedidos();
  } catch (err) {
    if (err.status !== 401) alert(err.message);
  }
}

window.addEventListener('hashchange', route);

exigirSesion(['admin']).then(async (u) => {
  if (!u) return;
  yo = u;
  await cargarOpciones();
  route();
});
