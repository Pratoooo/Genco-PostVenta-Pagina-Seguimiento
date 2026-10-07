// Inicio de sesión, registro y recuperación de contraseña.
import { Router } from 'express';
import { config } from '../config.js';
import { HttpError } from '../lib/errores.js';
import { limitador, MINUTO } from '../lib/limitador.js';
import { HASH_FALSO, verifyPassword, necesitaRehash, crearSesion, cerrarSesion, requireSesion } from '../lib/auth.js';
import { enviarMail, plantillaMail } from '../lib/mailer.js';
import { registrar } from '../lib/registroSeguridad.js';
import * as norm from '../lib/normalizar.js';
import * as usuarios from '../modelos/usuarios.js';
import * as recuperaciones from '../modelos/recuperaciones.js';

const router = Router();

// En una oficina varias personas salen por la misma IP y pueden compartir la cuenta: el límite es por
// IP + email y bastante holgado, para que un par de errores de tipeo no los bloquee a todos.
const loginsFallidos = limitador(15, 15 * MINUTO, 'Demasiados intentos fallidos con esta cuenta. Probá de nuevo en 15 minutos.');
const registros = limitador(10, 60 * MINUTO, 'Se crearon demasiadas cuentas desde esta conexión. Probá de nuevo más tarde.');
const recuperacionesPorIp = limitador(10, 15 * MINUTO, 'Demasiadas solicitudes. Probá de nuevo en 15 minutos.');
// Evita llenarle la casilla a alguien: como mucho 3 mails de recuperación por hora a la misma cuenta.
const mailsPorCuenta = limitador(3, 60 * MINUTO);
// Cambios de contraseña con la actual equivocada (alguien con una sesión ajena intentando adivinarla).
const cambiosFallidos = limitador(10, 15 * MINUTO, 'Demasiados intentos. Probá de nuevo en 15 minutos.');

router.post('/login', (req, res) => {
  const email = norm.email(req.body?.email);
  const password = String(req.body?.password ?? '');
  if (!email || !password) throw new HttpError(400, 'Ingresá tu email y contraseña.');

  const clave = `${req.ip}|${email}`;
  if (loginsFallidos.excedido(clave)) registrar('login_bloqueado', { email }, req, 'aviso');
  loginsFallidos.controlar(clave);
  const u = usuarios.buscarPorEmail(email);
  if (!verifyPassword(password, u?.password_hash ?? HASH_FALSO) || !u) {
    loginsFallidos.sumar(clave);
    const bloqueado = loginsFallidos.excedido(clave);
    registrar(bloqueado ? 'cuenta_bloqueada_por_intentos' : 'login_fallido', { email, existe: Boolean(u) }, req,
      bloqueado ? 'alerta' : 'info');
    throw new HttpError(401, 'Email o contraseña incorrectos.');
  }
  if (!u.aprobado) throw new HttpError(403, 'Tu cuenta todavía está pendiente de aprobación. Genco la va a habilitar a la brevedad.');
  if (!u.activo) {
    registrar('login_cuenta_desactivada', { email }, req, 'aviso');
    throw new HttpError(403, 'Tu cuenta está desactivada. Consultá con Genco.');
  }

  loginsFallidos.limpiar(clave);
  // Contraseñas guardadas con parámetros viejos se actualizan ahora que tenemos la contraseña correcta.
  const hash = necesitaRehash(u.password_hash) ? usuarios.actualizarHash(u.id, password) : u.password_hash;
  crearSesion(res, { ...u, password_hash: hash });
  registrar('login', { email }, req);
  res.json(usuarios.publico(u));
});

// Registro de talleres y peritos: la cuenta queda pendiente hasta que un admin la aprueba.
router.post('/registro', (req, res) => {
  registros.controlar(req.ip);
  const rol = norm.texto(req.body?.rol, 20);
  if (!['taller', 'perito'].includes(rol)) throw new HttpError(400, 'Elegí si sos taller o perito.');
  const { d, password } = usuarios.leer({ ...req.body, rol, activo: true }, { nuevo: true, registro: true });
  const u = usuarios.crear(d, password, { aprobado: false });
  registros.sumar(req.ip);
  registrar('registro', { email: u.email, rol: u.rol }, req);
  res.status(201).json({ nombre: u.nombre, email: u.email, rol_nombre: usuarios.ROLES[u.rol] });
});

// Siempre responde lo mismo, exista o no la cuenta, para no revelar quién está registrado.
router.post('/recuperar', async (req, res) => {
  const email = norm.email(req.body?.email);
  if (!norm.esEmail(email)) throw new HttpError(400, 'Ingresá el email de tu cuenta.');
  recuperacionesPorIp.controlar(req.ip);
  recuperacionesPorIp.sumar(req.ip);

  const u = usuarios.buscarPorEmail(email);
  registrar('recuperacion_pedida', { email, existe: Boolean(u) }, req);
  if (u?.activo && !mailsPorCuenta.excedido(u.id)) {
    mailsPorCuenta.sumar(u.id);
    // El token va después del "#": el navegador no lo manda al servidor ni queda en los logs.
    const enlace = `${config.appUrl}/login#restablecer=${recuperaciones.crear(u.id)}`;
    try {
      await enviarMailRecuperacion(u, enlace);
    } catch (err) {
      console.error(`No se pudo enviar el mail de recuperación a ${u.email}: ${err.message}`);
      throw new HttpError(502, 'No pudimos enviar el mail en este momento. Probá de nuevo en unos minutos o avisale a Genco.');
    }
  }
  res.json({ ok: true });
});

function enviarMailRecuperacion(u, enlace) {
  const minutos = recuperaciones.VIGENCIA_MINUTOS;
  return enviarMail({
    para: u.email,
    asunto: 'Recuperar tu contraseña — Grupo Genco Siniestros',
    texto: `Hola ${u.nombre}:\n\nPediste crear una nueva contraseña para tu cuenta ${u.email}.\n` +
      `Entrá a este enlace (vence en ${minutos} minutos):\n\n${enlace}\n\nSi no fuiste vos, ignorá este mensaje: tu contraseña no cambia.\n\nGrupo Genco · Siniestros`,
    html: plantillaMail({
      titulo: 'Recuperar tu contraseña',
      parrafos: [
        `Hola ${norm.escHtml(u.nombre)}:`,
        `Pediste crear una nueva contraseña para tu cuenta <strong>${norm.escHtml(u.email)}</strong>.`,
      ],
      boton: { url: enlace, texto: 'Crear nueva contraseña' },
      pie: `El enlace vence en ${minutos} minutos y sirve una sola vez. Si no fuiste vos, ignorá este mensaje: tu contraseña no cambia.`,
    }),
  });
}

router.post('/restablecer', (req, res) => {
  recuperacionesPorIp.controlar(req.ip);
  try {
    const { email } = recuperaciones.usar(req.body?.token, String(req.body?.password ?? ''));
    // Por si la cuenta había quedado bloqueada por intentos fallidos desde esta conexión.
    loginsFallidos.limpiar(`${req.ip}|${email}`);
    registrar('password_restablecida', { email }, req);
    res.json({ email });
  } catch (err) {
    if (/enlace no es válido/.test(err.message)) {
      recuperacionesPorIp.sumar(req.ip);
      registrar('enlace_recuperacion_invalido', {}, req, 'aviso');
    }
    throw err;
  }
});

router.post('/logout', (req, res) => {
  cerrarSesion(res);
  res.json({ ok: true });
});

// /me y el cambio de contraseña funcionan aunque la cuenta tenga que cambiar la contraseña.
router.get('/me', requireSesion, (req, res) => res.json(usuarios.publico(req.usuario)));

// Si la cuenta es compartida, cambiar la contraseña cierra la sesión en las otras computadoras.
router.post('/password', requireSesion, (req, res) => {
  const clave = `${req.ip}|${req.usuario.id}`;
  cambiosFallidos.controlar(clave);
  const actual = String(req.body?.actual ?? '');
  const nueva = String(req.body?.nueva ?? '');
  if (!verifyPassword(actual, req.usuario.password_hash)) {
    cambiosFallidos.sumar(clave);
    registrar('cambio_password_fallido', {}, req, 'aviso');
    throw new HttpError(400, 'La contraseña actual no es correcta.');
  }
  if (actual === nueva) throw new HttpError(400, 'La contraseña nueva tiene que ser distinta de la actual.');
  const hash = usuarios.cambiarPassword(req.usuario.id, nueva);
  crearSesion(res, { ...req.usuario, password_hash: hash });
  registrar('password_cambiada', {}, req);
  res.json({ ok: true });
});

export default router;
