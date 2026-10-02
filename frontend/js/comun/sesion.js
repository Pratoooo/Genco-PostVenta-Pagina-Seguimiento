// Sesión del usuario en las páginas privadas: control de acceso, menú y cambio de contraseña.
import { api } from './api.js';
import { $, esc, alerta, icono } from './ui.js';

export async function sesionActual() {
  try {
    return await api('/api/auth/me');
  } catch {
    return null;
  }
}

// Sin sesión va al login; con otro rol, a su propia sección. Si está todo bien, muestra la página.
export async function exigirSesion(roles) {
  const u = await sesionActual();
  if (!u) {
    location.replace('/login');
    return null;
  }
  if (!roles.includes(u.rol)) {
    location.replace(u.destino);
    return null;
  }
  montarMenuUsuario(u);
  document.body.classList.remove('cargando');
  return u;
}

const iniciales = (nombre) => nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

function montarMenuUsuario(u) {
  const el = $('#menu-usuario');
  el.innerHTML = `<details class="user-menu">
    <summary aria-label="Menú de ${esc(u.nombre)}">
      <span class="avatar">${esc(iniciales(u.nombre))}</span>
      <span class="user-txt"><strong>${esc(u.nombre)}</strong><small>${esc(u.rol_nombre)}</small></span>
      ${icono('chevron')}
    </summary>
    <div class="menu">
      <div class="menu-head"><strong>${esc(u.nombre)}</strong>
        <small>${esc(u.email)} · ${esc(u.rol_nombre)}${u.empresa ? ` · ${esc(u.empresa)}` : ''}</small></div>
      <button type="button" data-accion="password">${icono('llave')} Cambiar contraseña</button>
      <button type="button" data-accion="salir">${icono('salir')} Cerrar sesión</button>
    </div>
  </details>`;
  const details = $('details', el);
  document.addEventListener('click', (ev) => {
    if (!details.contains(ev.target)) details.open = false;
  });
  $('[data-accion=salir]', el).addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.replace('/login');
  });
  $('[data-accion=password]', el).addEventListener('click', () => {
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
    <p class="hint">Si otras personas usan esta misma cuenta, se les va a cerrar la sesión y van a tener que ingresar con la contraseña nueva.</p>
    <div class="msg"></div>
    <div class="row" style="justify-content:flex-end;margin-top:18px">
      <button type="button" class="btn ghost" value="cancelar">Cancelar</button>
      <button type="submit" class="btn">Guardar</button>
    </div>
  </form>`;
  document.body.append(dlg);
  $('[value=cancelar]', dlg).addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  $('form', dlg).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('.msg', dlg);
    if ($('#pw-nueva', dlg).value !== $('#pw-repetir', dlg).value) return alerta(msg, 'error', 'Las contraseñas nuevas no coinciden.');
    try {
      await api('/api/auth/password', { method: 'POST', body: { actual: $('#pw-actual', dlg).value, nueva: $('#pw-nueva', dlg).value } });
      alerta(msg, 'ok', 'Contraseña actualizada.');
      setTimeout(() => dlg.close(), 1200);
    } catch (err) {
      alerta(msg, 'error', err.message);
    }
  });
  dlg.showModal();
}
