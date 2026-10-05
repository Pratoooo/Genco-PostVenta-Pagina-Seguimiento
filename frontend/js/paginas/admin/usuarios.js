// Panel admin · Usuarios: solicitudes de registro, lista, alta y edición de cuentas.
import { apiPrivada } from '../../comun/api.js';
import { $, esc, fecha, alerta, celda } from '../../comun/ui.js';
import { estado, alCargarOpciones, cargarOpciones, llenarSelect, avisoDeError } from './estado.js';

const form = $('#form-usuario');
let avisoPendiente = null;

alCargarOpciones((op) => llenarSelect(form.elements.rol, op.roles));

// Talleres: "Taller Sur (Carlos Fernández)". Peritos y administradores: su nombre.
const etiqueta = (u) => (u.rol === 'taller' && u.empresa ? `${u.empresa} (${u.nombre})` : u.nombre);

// ---------------------------------------------------------------- Lista y solicitudes

export async function cargarUsuarios() {
  const { roles } = estado.opciones;
  const todos = await apiPrivada('/api/admin/usuarios');
  const pendientes = todos.filter((u) => !u.aprobado);

  $('#pendientes').classList.toggle('hidden', !pendientes.length);
  $('#lista-pendientes').innerHTML = pendientes
    .map((u) => `<div class="pendiente-item">
      <div><strong>${esc(u.nombre)}</strong> <span class="badge">${esc(roles[u.rol])}</span>
        ${u.rol === 'taller' && u.empresa ? `<div>Taller: <strong>${esc(u.empresa)}</strong></div>` : ''}
        <div class="small muted">${esc(u.email)} · se registró el ${fecha(u.created_at)}</div></div>
      <div class="acciones">
        <button class="btn danger" type="button" data-rechazar="${u.id}">Rechazar</button>
        <button class="btn sm" type="button" data-aprobar="${u.id}">Aprobar</button>
      </div>
    </div>`)
    .join('');

  $('#tabla-usuarios').innerHTML = todos
    .filter((u) => u.aprobado)
    .map((u) => `<tr class="clickable" data-href="#/usuarios/${u.id}">
      ${celda('Nombre', `<strong>${esc(u.nombre)}</strong>${u.id === estado.yo.id ? ' <span class="small muted">(esta cuenta)</span>' : ''}`)}
      ${celda('Taller', u.rol === 'taller' ? esc(u.empresa) : '')}
      ${celda('Email', esc(u.email))}
      ${celda('Rol', `<span class="badge ${u.rol === 'admin' ? 'admin' : ''}">${esc(roles[u.rol])}</span>`)}
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
  } catch (err) {
    alert(err.message);
  }
  await cargarUsuarios();
});

// ---------------------------------------------------------------- Formulario

// Solo los talleres llevan un dato extra: el nombre del taller.
function mostrarCamposDelRol() {
  $('#u-taller-campo').classList.toggle('hidden', form.elements.rol.value !== 'taller');
}
form.elements.rol.addEventListener('change', mostrarCamposDelRol);

function datosDelFormulario() {
  const f = form.elements;
  const rol = f.rol.value;
  return {
    nombre: f.nombre.value,
    email: f.email.value,
    rol,
    empresa: rol === 'taller' ? $('#u-empresa').value : '',
    activo: f.activo.checked,
    password: f.password.value,
    version: form.dataset.version,
  };
}

function generarPassword() {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => letras[b % letras.length]).join('');
}

$('#generar').addEventListener('click', () => {
  form.elements.password.value = generarPassword();
  form.elements.password.select();
});

export async function abrirUsuario(id) {
  form.reset();
  alerta($('#usuario-msg'), '', '');
  $('#aviso-pendiente').classList.add('hidden');
  form.dataset.id = id || '';
  form.dataset.version = '';
  $('#borrar-usuario').classList.toggle('hidden', !id);
  $('#usuario-titulo').textContent = 'Nuevo usuario';
  $('#u-password-label').textContent = id ? 'Nueva contraseña' : 'Contraseña *';
  $('#u-password-hint').textContent = id
    ? 'Dejala vacía para no cambiarla. Si la cambiás, se cierran todas sus sesiones abiertas.'
    : 'Mínimo 8 caracteres. Compartila con la persona para que ingrese.';
  form.elements.password.required = !id;
  if (!id) {
    form.elements.rol.value = 'taller';
    mostrarCamposDelRol();
    form.elements.password.value = generarPassword();
    return $('#u-empresa').focus();
  }

  const u = await apiPrivada(`/api/admin/usuarios/${id}`);
  $('#usuario-titulo').textContent = etiqueta(u);
  form.elements.nombre.value = u.nombre;
  form.elements.email.value = u.email;
  form.elements.rol.value = u.rol;
  form.elements.activo.checked = Boolean(u.activo);
  form.dataset.version = u.version;
  $('#u-empresa').value = u.rol === 'taller' ? u.empresa : '';
  mostrarCamposDelRol();
  $('#aviso-pendiente').classList.toggle('hidden', Boolean(u.aprobado));
  if (avisoPendiente) alerta($('#usuario-msg'), 'ok', avisoPendiente);
  avisoPendiente = null;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id = form.dataset.id;
  const datos = datosDelFormulario();
  try {
    const u = await apiPrivada(id ? `/api/admin/usuarios/${id}` : '/api/admin/usuarios', { method: id ? 'PUT' : 'POST', body: datos });
    await cargarOpciones();
    if (!id) {
      avisoPendiente = `Cuenta creada. Para ingresar: ${u.email} y la contraseña "${datos.password}".`;
      location.hash = `#/usuarios/${u.id}`;
      return;
    }
    await abrirUsuario(id);
    alerta($('#usuario-msg'), 'ok', datos.password ? 'Cambios guardados. La contraseña se actualizó.' : 'Cambios guardados.');
  } catch (err) {
    alerta($('#usuario-msg'), 'error', err.message, avisoDeError(err, () => abrirUsuario(id), '#/usuarios'));
  }
});

// Guarda lo cargado (por ejemplo las compañías del perito) y aprueba la cuenta.
$('#aprobar-usuario').addEventListener('click', async () => {
  const id = form.dataset.id;
  try {
    await apiPrivada(`/api/admin/usuarios/${id}`, { method: 'PUT', body: datosDelFormulario() });
    await aprobar(id);
    await abrirUsuario(id);
    alerta($('#usuario-msg'), 'ok', 'Cuenta aprobada. Ya puede iniciar sesión.');
  } catch (err) {
    alerta($('#usuario-msg'), 'error', err.message, avisoDeError(err, () => abrirUsuario(id), '#/usuarios'));
  }
});

$('#borrar-usuario').addEventListener('click', async () => {
  if (!confirm('¿Eliminar esta cuenta? Sus pedidos quedan sin asignar. Si solo querés quitarle el acceso, desactivala.')) return;
  try {
    await apiPrivada(`/api/admin/usuarios/${form.dataset.id}`, { method: 'DELETE' });
    await cargarOpciones();
    location.hash = '#/usuarios';
  } catch (err) {
    alerta($('#usuario-msg'), 'error', err.message);
  }
});
