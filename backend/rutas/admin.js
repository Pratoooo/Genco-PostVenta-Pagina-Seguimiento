// Panel de administración: pedidos y usuarios. Solo para administradores.
import { Router } from 'express';
import { requireRol, crearSesion } from '../lib/auth.js';
import * as pedidos from '../modelos/pedidos.js';
import * as usuarios from '../modelos/usuarios.js';

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
  res.json({ ...p, envios: pedidos.listarEnvios(p.id), seguimiento: pedidos.seguimiento(p) });
});

router.post('/pedidos', (req, res) => {
  res.status(201).json(pedidos.crear(pedidos.leer(req.body)));
});

router.put('/pedidos/:id', (req, res) => {
  res.json(pedidos.actualizar(req.params.id, pedidos.leer(req.body), versionDe(req)));
});

router.delete('/pedidos/:id', (req, res) => {
  pedidos.eliminar(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Usuarios

router.get('/usuarios', (req, res) => res.json(usuarios.listar()));

router.get('/usuarios/:id', (req, res) => res.json(usuarios.obtener(req.params.id)));

router.post('/usuarios', (req, res) => {
  const { d, password } = usuarios.leer(req.body, { nuevo: true });
  res.status(201).json(usuarios.crear(d, password));
});

router.put('/usuarios/:id', (req, res) => {
  const { d, password } = usuarios.leer(req.body);
  const { usuario, nuevoHash } = usuarios.actualizar(req.params.id, d, { password, version: versionDe(req), editor: req.usuario });
  // Si cambió la contraseña de su propia cuenta, la sesión de quien edita sigue abierta.
  if (nuevoHash && usuario.id === req.usuario.id) crearSesion(res, { id: usuario.id, password_hash: nuevoHash });
  res.json(usuario);
});

router.post('/usuarios/:id/aprobar', (req, res) => res.json(usuarios.aprobar(req.params.id)));

router.delete('/usuarios/:id', (req, res) => {
  usuarios.eliminar(req.params.id, req.usuario);
  res.json({ ok: true });
});

export default router;
