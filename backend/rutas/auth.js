// Inicio de sesión, registro y recuperación de contraseña.
import { Router } from 'express';
import { config } from '../config.js';
import { HttpError } from '../lib/errores.js';
import { limitador, MINUTO } from '../lib/limitador.js';
import { HASH_FALSO, verifyPassword, crearSesion, cerrarSesion, requireRol } from '../lib/auth.js';
import { enviarMail, plantillaMail } from '../lib/mailer.js';
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

router.post('/login', (req, res) => {
  const email = norm.email(req.body?.email);
  const password = String(req.body?.password ?? '');
  if (!email || !password) throw new HttpError(400, 'Ingresá tu email y contraseña.');

  const clave = `${req.ip}|${email}`;
  loginsFallidos.controlar(clave);
  const u = usuarios.buscarPorEmail(email);
  if (!verifyPassword(password, u?.password_hash ?? HASH_FALSO) || !u) {
    loginsFallidos.sumar(clave);
    throw new HttpError(401, 'Email o contraseña incorrectos.');
  }
  if (!u.aprobado) throw new HttpError(403, 'Tu cuenta todavía está pendiente de aprobación. Genco la va a habilitar a la brevedad.');
  if (!u.activo) throw new HttpError(403, 'Tu cuenta está desactivada. Consultá con Genco.');

  loginsFallidos.limpiar(clave);
  crearSesion(res, u);
  res.json(usuarios.publico(u));
});

// Registro de talleres y peritos: la cuenta queda pendiente hasta que un admin la aprueba.
router.post('/registro', (req, res) => {
  registros.controlar(req.ip);
  const rol = norm.texto(req.body?.rol);
  if (!['taller', 'perito'].includes(rol)) throw new HttpError(400, 'Elegí si sos taller o perito.');
  const { d, password } = usuarios.leer({ ...req.body, rol, activo: true }, { nuevo: true, registro: true });
  const u = usuarios.crear(d, password, { aprobado: false });
  registros.sumar(req.ip);
  res.status(201).json({ nombre: u.nombre, email: u.email, rol_nombre: usuarios.ROLES[u.rol] });
});

// Siempre responde lo mismo, exista o no la cuenta, para no revelar quién está registrado.
router.post('/recuperar', async (req, res) => {
  const email = norm.email(req.body?.email);
  if (!norm.esEmail(email)) throw new HttpError(400, 'Ingresá el email de tu cuenta.');
  recuperacionesPorIp.controlar(req.ip);
  recuperacionesPorIp.sumar(req.ip);

  const u = usuarios.buscarPorEmail(email);
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
  const { email } = recuperaciones.usar(req.body?.token, String(req.body?.password ?? ''));
  // Por si la cuenta había quedado bloqueada por intentos fallidos desde esta conexión.
  loginsFallidos.limpiar(`${req.ip}|${email}`);
  res.json({ email });
});

router.post('/logout', (req, res) => {
  cerrarSesion(res);
  res.json({ ok: true });
});

router.get('/me', requireRol(), (req, res) => res.json(usuarios.publico(req.usuario)));

// Si la cuenta es compartida, cambiar la contraseña cierra la sesión en las otras computadoras.
router.post('/password', requireRol(), (req, res) => {
  if (!verifyPassword(String(req.body?.actual ?? ''), req.usuario.password_hash)) {
    throw new HttpError(400, 'La contraseña actual no es correcta.');
  }
  const hash = usuarios.cambiarPassword(req.usuario.id, String(req.body?.nueva ?? ''));
  crearSesion(res, { ...req.usuario, password_hash: hash });
  res.json({ ok: true });
});

export default router;
