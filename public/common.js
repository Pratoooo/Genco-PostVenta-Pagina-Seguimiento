// Utilidades compartidas entre todas las páginas.

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Para páginas privadas: si la sesión venció, vuelve al login.
async function apiPrivada(path, options) {
  try {
    return await api(path, options);
  } catch (err) {
    if (err.status === 401) location.replace('/login');
    throw err;
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fecha(s) {
  if (!s) return '';
  // Las fechas de SQLite vienen en UTC sin zona ("YYYY-MM-DD HH:MM:SS").
  const d = new Date(/^\d{4}-\d{2}-\d{2} /.test(s) ? s.replace(' ', 'T') + 'Z' : s);
  if (isNaN(d)) return esc(s);
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function alerta(el, tipo, msg) {
  el.innerHTML = msg ? `<div class="alert ${tipo}" role="${tipo === 'error' ? 'alert' : 'status'}">${esc(msg)}</div>` : '';
}

const ICONOS = {
  origen: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  despacho: '<path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1Z"/><path d="M16 5h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2"/><path d="M9 12h6M9 16h4"/>',
  expreso: '<path d="M2 6h12v10H2z"/><path d="M14 9h4.5L22 12.5V16h-8z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="18" cy="17.5" r="1.8"/>',
  entrega: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="m9 15 2 2 4-4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  llave: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  salir: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  taller: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5Z"/>',
  perito: '<path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1Z"/><path d="M16 5h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2"/><path d="m9 14 2 2 4-4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  ojo: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
};
// Sugerencias para el campo "Compañía de seguro" (se puede escribir cualquier otra).
const COMPANIAS = [
  'Allianz', 'Federación Patronal', 'La Caja', 'La Segunda', 'Mapfre', 'Mercantil Andina', 'Provincia Seguros',
  'Rivadavia Seguros', 'Rio Uruguay Seguros', 'San Cristóbal', 'Sancor Seguros', 'Sura', 'Zurich',
];

const icono = (nombre) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONOS[nombre]}</svg>`;
const CLAVES = ['origen', 'despacho', 'expreso', 'entrega'];

// Datos del pedido + puntos de estado + historial.
function renderSeguimiento(s) {
  const etapas = s.etapas
    .map((e, i) => {
      const estado = i < s.etapa_actual ? 'done' : i === s.etapa_actual ? 'current' : '';
      const final = i === s.etapas.length - 1 ? ' final' : '';
      return `<li class="step ${estado}${final}" ${estado === 'current' ? 'aria-current="step"' : ''}>
        <div class="dot">${icono(CLAVES[i])}</div>
        <div class="txt"><div class="t">${esc(e.titulo)}</div>${e.detalle ? `<div class="d">${esc(e.detalle)}</div>` : ''}</div>
      </li>`;
    })
    .join('');

  const p = s.pedido;
  const dato = (k, v) => (v || v === 0 ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
  return `
    <article class="card">
      <header class="result-head">
        <div><div class="label">Siniestro</div><h2>${esc(p.siniestro)}</h2></div>
        ${pillEstado(s)}
      </header>
      <dl class="chips">
        ${dato('Patente', p.patente)}${dato('Vehículo', p.vehiculo)}${dato('Taller', p.taller)}
        ${dato('Perito', p.perito)}${dato('Compañía', p.compania)}${dato('Piezas', p.cantidad_piezas)}
      </dl>
      <ol class="stepper" aria-label="Estado del pedido">${etapas}</ol>
      ${s.estado_viaje && !s.recibido ? `<div class="viaje">${icono('expreso')}<span><strong>Estado del viaje:</strong> ${esc(s.estado_viaje)}</span></div>` : ''}
      <p class="updated">Última actualización: ${fecha(s.actualizado)}</p>
    </article>
    <article class="card">
      <h3>Historial</h3>
      <ul class="timeline">${s.eventos.map((ev) => `<li><time>${fecha(ev.fecha)}</time>${esc(ev.descripcion)}</li>`).join('')}</ul>
    </article>`;
}

// Celda de tabla con etiqueta (en celular cada fila se muestra como tarjeta). `html` ya escapado.
const celda = (label, html) => `<td data-label="${label}">${html ?? ''}</td>`;

function pillEstado({ estado, recibido }, chico = false) {
  return `<span class="pill ${recibido ? 'ok' : ''}${chico ? ' sm' : ''}">${recibido ? '' : '<span class="pulse"></span>'}${esc(estado)}</span>`;
}

// ---------------------------------------------------------------- Sesión

async function sesionActual() {
  try {
    return await api('/api/auth/me');
  } catch {
    return null;
  }
}

// Páginas privadas: sin sesión va al login; con otro rol, a su propia sección.
async function exigirSesion(roles) {
  const u = await sesionActual();
  if (!u) return location.replace('/login'), null;
  if (!roles.includes(u.rol)) return location.replace(u.destino), null;
  montarMenuUsuario(u);
  document.body.classList.remove('cargando');
  return u;
}

function iniciales(nombre) {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function montarMenuUsuario(u) {
  const el = document.getElementById('menu-usuario');
  el.innerHTML = `<details class="user-menu">
    <summary aria-label="Menú de ${esc(u.nombre)}">
      <span class="avatar">${esc(iniciales(u.nombre))}</span>
      <span class="user-txt"><strong>${esc(u.nombre)}</strong><small>${esc(u.rol_nombre)}</small></span>
      ${icono('chevron')}
    </summary>
    <div class="menu">
      <div class="menu-head"><strong>${esc(u.nombre)}</strong>
        <small>${esc(u.usuario)} · ${esc(u.rol_nombre)}${u.empresa ? ` · ${esc(u.empresa)}` : ''}</small></div>
      <button type="button" data-accion="password">${icono('llave')} Cambiar contraseña</button>
      <button type="button" data-accion="salir">${icono('salir')} Cerrar sesión</button>
    </div>
  </details>`;
  const details = el.querySelector('details');
  document.addEventListener('click', (ev) => { if (!details.contains(ev.target)) details.open = false; });
  el.querySelector('[data-accion=salir]').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.replace('/login');
  });
  el.querySelector('[data-accion=password]').addEventListener('click', () => {
    details.open = false;
    dialogoPassword();
  });
}

function dialogoPassword() {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog';
  dlg.innerHTML = `<form method="dialog" class="dialog-body">
    <h3>Cambiar contraseña</h3>
    <label for="pw-actual">Contraseña actual</label>
    <input id="pw-actual" type="password" autocomplete="current-password" required>
    <label for="pw-nueva" style="margin-top:12px">Nueva contraseña</label>
    <input id="pw-nueva" type="password" autocomplete="new-password" minlength="8" required>
    <label for="pw-repetir" style="margin-top:12px">Repetir nueva contraseña</label>
    <input id="pw-repetir" type="password" autocomplete="new-password" minlength="8" required>
    <div class="msg"></div>
    <div class="row" style="justify-content:flex-end;margin-top:18px">
      <button type="button" class="btn ghost" value="cancel">Cancelar</button>
      <button type="submit" class="btn">Guardar</button>
    </div>
  </form>`;
  document.body.append(dlg);
  const $d = (s) => dlg.querySelector(s);
  $d('[value=cancel]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  $d('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $d('.msg');
    if ($d('#pw-nueva').value !== $d('#pw-repetir').value) return alerta(msg, 'error', 'Las contraseñas nuevas no coinciden.');
    try {
      await api('/api/auth/password', { method: 'POST', body: { actual: $d('#pw-actual').value, nueva: $d('#pw-nueva').value } });
      alerta(msg, 'ok', 'Contraseña actualizada.');
      setTimeout(() => dlg.close(), 1200);
    } catch (err) {
      alerta(msg, 'error', err.message);
    }
  });
  dlg.showModal();
}
