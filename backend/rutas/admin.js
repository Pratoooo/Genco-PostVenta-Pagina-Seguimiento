// Panel de administración: pedidos y usuarios. Solo para administradores.
import { Router } from 'express';
import { requireRol, crearSesion } from '../lib/auth.js';
import * as pedidos from '../modelos/pedidos.js';
import * as usuarios from '../modelos/usuarios.js';
import { estadoAvisos, avisarAhora } from '../servicios/avisosPedido.js';
import { infoDestino, calcularDestino, recalcularDestinos } from '../servicios/mapas.js';
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
    paginasSeguimiento: pedidos.PAGINAS_SEGUIMIENTO,
    destinos: pedidos.DESTINOS_ENVIO,
    entregas: pedidos.ENTREGAS,
    roles: usuarios.ROLES,
    talleres: usuarios.asignables('taller'),
    peritos: usuarios.asignables('perito'),
    pendientes: usuarios.contarPendientes(),
  });
});

// ---------------------------------------------------------------- Pedidos

// Todos los pedidos para la reseña (los filtros se aplican en la pantalla).
router.get('/pedidos', (req, res) => {
  res.json(pedidos.listar().map((p) => ({ ...pedidos.resumen(p), ubicacion: infoDestino(p) })));
});

// Al guardar, se espera unos segundos a que el destino se ubique en el mapa; si tarda más, sigue solo.
const conTope = (promesa, ms) => Promise.race([promesa, new Promise((r) => setTimeout(r, ms))]);

router.get('/pedidos/:id', (req, res) => {
  const p = pedidos.obtener(req.params.id);
  const ubicacion = infoDestino(p);
  if (ubicacion.estado === 'calculando' || ubicacion.estado === 'error') calcularDestino(p.id);
  res.json({ ...p, envios: pedidos.listarEnvios(p.id), seguimiento: pedidos.seguimiento(p), avisos: estadoAvisos(p), ubicacion });
});

// "Enviar aviso ahora" por mail, sin esperar.
router.post('/pedidos/:id/avisar', async (req, res) => res.json(await avisarAhora(req.params.id)));

router.post('/pedidos', async (req, res) => {
  const p = pedidos.crear(pedidos.leer(req.body));
  await conTope(calcularDestino(p.id), 4000);
  res.status(201).json(pedidos.obtener(p.id));
});

router.put('/pedidos/:id', async (req, res) => {
  const p = pedidos.actualizar(req.params.id, pedidos.leer(req.body), versionDe(req));
  await conTope(calcularDestino(p.id), 4000);
  res.json(pedidos.obtener(p.id));
});

router.delete('/pedidos/:id', (req, res) => {
  const { siniestro } = pedidos.obtener(req.params.id);
  pedidos.eliminar(req.params.id);
  registrar('pedido_eliminado', { siniestro }, req, 'aviso');
  res.json({ ok: true });
});

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
  // Si cambió su dirección, sus pedidos se vuelven a ubicar en el mapa (en segundo plano).
  recalcularDestinos().catch(() => {});
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
