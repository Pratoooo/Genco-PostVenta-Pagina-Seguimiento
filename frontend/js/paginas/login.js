// Página de ingreso: iniciar sesión, registrarse y recuperar la contraseña.
import { api } from '../comun/api.js';
import { $, alerta, pintarIconos, activarVerPassword } from '../comun/ui.js';
import { sesionActual } from '../comun/sesion.js';

pintarIconos();
activarVerPassword();

// El token del enlace de recuperación llega después del "#" (así no viaja al servidor).
let tokenRestablecer = null;
const mToken = location.hash.match(/^#restablecer=([\w-]+)$/);
if (mToken) {
  tokenRestablecer = mToken[1];
  history.replaceState(null, '', location.pathname + '#restablecer');
} else {
  // Si ya hay sesión, ir directo a la sección que corresponde.
  sesionActual().then((u) => u && location.replace(u.destino));
}

// ---------------------------------------------------------------- Pantallas

function vista(nombre) {
  document.querySelectorAll('[data-vista]').forEach((el) => el.classList.toggle('hidden', el.id !== `view-${nombre}`));
  document.querySelectorAll('[id$="-msg"]').forEach((el) => alerta(el, '', ''));
  scrollTo(0, 0);
}

function route() {
  const h = location.hash;
  if (h === '#registro') {
    vista('registro');
    if (!$('#form-registro').rol.value) $('#rol-taller').focus();
  } else if (h === '#recuperar') {
    vista('recuperar');
    $('#rec-email').value = $('#email').value;
    $('#rec-email').focus();
  } else if (h === '#restablecer' && tokenRestablecer) {
    vista('restablecer');
    $('#n-password').focus();
  } else {
    vista('login');
    $('#email').focus();
  }
}

function irAlLogin() {
  history.replaceState(null, '', location.pathname);
  route();
}

window.addEventListener('hashchange', route);
route();

// Se cerró la sesión desde una página privada (venció, o cambiaron la contraseña de la cuenta).
if (new URLSearchParams(location.search).get('sesion') === 'cerrada') {
  alerta($('#login-msg'), 'info', 'Tu sesión se cerró. Ingresá de nuevo (si la cuenta es compartida, puede que hayan cambiado la contraseña).');
  history.replaceState(null, '', location.pathname + location.hash);
}

// Los enlaces "#" vuelven al ingreso.
document.querySelectorAll('a[href="#"]').forEach((a) =>
  a.addEventListener('click', (ev) => {
    ev.preventDefault();
    irAlLogin();
  }));

// Envía un formulario: deshabilita el botón mientras tanto y muestra los errores.
function alEnviar(form, msg, fn) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('button[type=submit]', form);
    alerta(msg, '', '');
    const error = (texto, campo) => {
      alerta(msg, 'error', texto);
      campo?.focus();
    };
    btn.disabled = true;
    try {
      await fn(form, error);
    } catch (err) {
      error(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

const esEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

// ---------------------------------------------------------------- Ingresar

alEnviar($('#form-login'), $('#login-msg'), async (f, error) => {
  if (!f.email.value.trim() || !f.password.value) return error('Ingresá tu email y contraseña.');
  try {
    const u = await api('/api/auth/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
    location.replace(u.destino);
  } catch (err) {
    f.password.select();
    throw err;
  }
});

// ---------------------------------------------------------------- Registrarse

// El taller pone el nombre del taller. Al perito las compañías se las carga Genco.
document.querySelectorAll('input[name=rol]').forEach((r) =>
  r.addEventListener('change', () => {
    $('#campo-empresa').classList.toggle('hidden', r.value !== 'taller');
    $('#r-empresa').value = '';
  }));

alEnviar($('#form-registro'), $('#registro-msg'), async (f, error) => {
  if (!f.rol.value) return error('Elegí si sos taller o perito.', $('#rol-taller'));
  if (f.rol.value === 'taller' && !f.empresa.value.trim()) return error('Ingresá el nombre del taller.', f.empresa);
  if (!f.nombre.value.trim()) return error('Ingresá tu nombre y apellido.', f.nombre);
  if (!esEmail(f.email.value)) return error('Ingresá un email válido.', f.email);
  if (f.password.value.length < 8) return error('La contraseña debe tener al menos 8 caracteres.', f.password);
  if (f.password.value !== f.repetir.value) return error('Las contraseñas no coinciden.', f.repetir);
  try {
    const r = await api('/api/auth/registro', {
      method: 'POST',
      body: { rol: f.rol.value, empresa: f.empresa.value, nombre: f.nombre.value, email: f.email.value, password: f.password.value },
    });
    f.reset();
    $('#campo-empresa').classList.add('hidden');
    $('#registrado-texto').textContent =
      `Gracias, ${r.nombre}. Tu cuenta de ${r.rol_nombre.toLowerCase()} quedó pendiente de aprobación. ` +
      `Cuando Genco la habilite vas a poder ingresar con ${r.email}.`;
    history.replaceState(null, '', location.pathname);
    vista('registrado');
  } catch (err) {
    if (err.codigo === 'email') return error(err.message, f.email);
    throw err;
  }
});

// ---------------------------------------------------------------- Olvidé mi contraseña

alEnviar($('#form-recuperar'), $('#recuperar-msg'), async (f, error) => {
  if (!esEmail(f.email.value)) return error('Ingresá el email de tu cuenta.', f.email);
  await api('/api/auth/recuperar', { method: 'POST', body: { email: f.email.value } });
  $('#enviado-email').textContent = f.email.value.trim();
  f.reset();
  history.replaceState(null, '', location.pathname);
  vista('enviado');
});

// ---------------------------------------------------------------- Nueva contraseña (desde el mail)

alEnviar($('#form-restablecer'), $('#restablecer-msg'), async (f, error) => {
  if (f.password.value.length < 8) return error('La contraseña debe tener al menos 8 caracteres.', f.password);
  if (f.password.value !== f.repetir.value) return error('Las contraseñas no coinciden.', f.repetir);
  const r = await api('/api/auth/restablecer', { method: 'POST', body: { token: tokenRestablecer, password: f.password.value } });
  tokenRestablecer = null;
  f.reset();
  history.replaceState(null, '', location.pathname);
  $('#email').value = r.email;
  $('#restablecido-texto').textContent = `Ya podés ingresar con ${r.email} y tu nueva contraseña.`;
  vista('restablecido');
});
