// Panel de administración: pedidos y usuarios. Solo para administradores.
import { Router } from 'express';
import { requireRol, crearSesion } from '../lib/auth.js';
import * as pedidos from '../modelos/pedidos.js';
import * as usuarios from '../modelos/usuarios.js';
import { estadoLectura, leerSendbox } from '../servicios/seguimientoSendbox.js';
import { estadoAvisos, avisarAhora } from '../servicios/avisosPedido.js';
import { registrar } from '../lib/registroSeguridad.js';

const router = Router();
router.use(requireRol('admin'));

// Versión que tenía el formulario al abrirse (para detectar si otra persona guardó en el medio).
const versionDe = (req) => (req.body?.version == null || req.body.version === '' ? undefined : Number(req.body.version));

// Listas para los formularios y cantidad de cuentas por aprobar.
router.get('/opciones', (req, res) => {
  res.json({
    origenes: pedidos.ORIGENES,
    despachos: pedidos.DESPACHOS,
    transportes: pedidos.TRANSPORTES,
    entregas: pedidos.ENTREGAS,
    roles: usuarios.ROLES,
    talleres: usuarios.asignables('taller'),
    peritos: usuarios.asignables('perito'),
    pendientes: usuarios.contarPendientes(),
  });
});

// ---------------------------------------------------------------- Pedidos

router.get('/pedidos', (req, res) => {
  res.json(pedidos.listar(String(req.query.q ?? '').trim()).map(pedidos.resumen));
});

router.get('/pedidos/:id', (req, res) => {
  const p = pedidos.obtener(req.params.id);
  res.json({ ...p, envios: pedidos.listarEnvios(p.id), seguimiento: pedidos.seguimiento(p), avisos: estadoAvisos(p) });
});

// "Enviar aviso ahora" por mail, sin esperar.
router.post('/pedidos/:id/avisar', async (req, res) => res.json(await avisarAhora(req.params.id)));

router.post('/pedidos', (req, res) => {
  res.status(201).json(pedidos.crear(pedidos.leer(req.body)));
});

router.put('/pedidos/:id', (req, res) => {
  res.json(pedidos.actualizar(req.params.id, pedidos.leer(req.body), versionDe(req)));
});

router.delete('/pedidos/:id', (req, res) => {
  const { siniestro } = pedidos.obtener(req.params.id);
  pedidos.eliminar(req.params.id);
  registrar('pedido_eliminado', { siniestro }, req, 'aviso');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Lectura automática de Sendbox

router.get('/sendbox', (req, res) => res.json(estadoLectura()));

// "Actualizar ahora": lee Sendbox en el momento (tarda unos segundos por guía).
router.post('/sendbox/leer', async (req, res) => res.json(await leerSendbox()));

// ---------------------------------------------------------------- Usuarios

router.get('/usuarios', (req, res) => res.json(usuarios.listar()));

router.get('/usuarios/:id', (req, res) => res.json(usuarios.obtener(req.params.id)));

router.post('/usuarios', (req, res) => {
  const { d, password } = usuarios.leer(req.body, { nuevo: true });
  // La contraseña la eligió el admin: la persona la tiene que cambiar al ingresar por primera vez.
  const u = usuarios.crear(d, password, { cambiarPassword: true });
  registrar('usuario_creado', { cuenta: u.email, rol: u.rol }, req);
  res.status(201).json(u);
});

router.put('/usuarios/:id', (req, res) => {
  const { d, password } = usuarios.leer(req.body);
  const { usuario, nuevoHash } = usuarios.actualizar(req.params.id, d, { password, version: versionDe(req), editor: req.usuario });
  // Si cambió la contraseña de su propia cuenta, la sesión de quien edita sigue abierta.
  if (nuevoHash && usuario.id === req.usuario.id) crearSesion(res, { id: usuario.id, password_hash: nuevoHash });
  registrar('usuario_modificado', { cuenta: usuario.email, rol: usuario.rol, activo: usuario.activo, password_cambiada: Boolean(nuevoHash) }, req,
    nuevoHash ? 'aviso' : 'info');
  res.json(usuario);
});

router.post('/usuarios/:id/aprobar', (req, res) => {
  const u = usuarios.aprobar(req.params.id);
  registrar('usuario_aprobado', { cuenta: u.email, rol: u.rol }, req);
  res.json(u);
});

router.delete('/usuarios/:id', (req, res) => {
  const { email } = usuarios.obtener(req.params.id);
  usuarios.eliminar(req.params.id, req.usuario);
  registrar('usuario_eliminado', { cuenta: email }, req, 'aviso');
  res.json({ ok: true });
});

export default router;
