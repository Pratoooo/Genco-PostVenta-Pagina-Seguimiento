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
  // Cuenta creada o modificada por un admin (o el admin inicial): antes de ver nada, contraseña propia.
  if (u.cambiar_password) await dialogoPassword({ obligatorio: true });
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
  $('[data-accion=salir]', el).addEventListener('click', cerrarSesion);
  $('[data-accion=password]', el).addEventListener('click', () => {
    details.open = false;
    dialogoPassword();
  });
}

const REGLAS = 'Mínimo 8 caracteres. Que no sea una contraseña común (como 12345678) ni contenga tu email.';

// obligatorio: no se puede cerrar sin cambiarla (solo cerrar sesión). Devuelve una promesa que se
// cumple cuando la contraseña quedó cambiada.
function dialogoPassword({ obligatorio = false } = {}) {
  let listo;
  const cambiada = new Promise((resolver) => (listo = resolver));
  let guardada = false;
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog';
  dlg.innerHTML = `<form method="dialog" class="dialog-body">
    <h3>${obligatorio ? 'Elegí una contraseña nueva' : 'Cambiar contraseña'}</h3>
    ${obligatorio ? '<p class="small" style="margin:-6px 0 14px">Por seguridad, antes de seguir tenés que reemplazar la contraseña que te dieron por una que solo sepas vos.</p>' : ''}
    <label for="pw-actual">Contraseña actual</label>
    <input id="pw-actual" type="password" autocomplete="current-password" required>
    <label for="pw-nueva" style="margin-top:12px">Nueva contraseña</label>
    <input id="pw-nueva" type="password" autocomplete="new-password" minlength="8" required>
    <label for="pw-repetir" style="margin-top:12px">Repetir nueva contraseña</label>
    <input id="pw-repetir" type="password" autocomplete="new-password" minlength="8" required>
    <p class="hint">${REGLAS}</p>
    <p class="hint">Si otras personas usan esta misma cuenta, se les va a cerrar la sesión y van a tener que ingresar con la contraseña nueva.</p>
    <div class="msg"></div>
    <div class="row" style="justify-content:flex-end;margin-top:18px">
      ${obligatorio
        ? '<button type="button" class="btn ghost" value="salir">Cerrar sesión</button>'
        : '<button type="button" class="btn ghost" value="cancelar">Cancelar</button>'}
      <button type="submit" class="btn">Guardar</button>
    </div>
  </form>`;
  document.body.append(dlg);
  $('[value=cancelar]', dlg)?.addEventListener('click', () => dlg.close());
  $('[value=salir]', dlg)?.addEventListener('click', cerrarSesion);
  // Obligatorio: Escape no lo cierra, y si el navegador lo cierra igual, se vuelve a abrir.
  if (obligatorio) dlg.addEventListener('cancel', (ev) => ev.preventDefault());
  dlg.addEventListener('close', () => {
    if (obligatorio && !guardada) return dlg.showModal();
    dlg.remove();
  });
  $('form', dlg).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('.msg', dlg);
    if ($('#pw-nueva', dlg).value !== $('#pw-repetir', dlg).value) return alerta(msg, 'error', 'Las contraseñas nuevas no coinciden.');
    try {
      await api('/api/auth/password', { method: 'POST', body: { actual: $('#pw-actual', dlg).value, nueva: $('#pw-nueva', dlg).value } });
      guardada = true;
      alerta(msg, 'ok', 'Contraseña actualizada.');
      setTimeout(() => {
        dlg.close();
        listo();
      }, 1200);
    } catch (err) {
      alerta(msg, 'error', err.message);
    }
  });
  dlg.showModal();
  return cambiada;
}

async function cerrarSesion() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.replace('/login');
}
