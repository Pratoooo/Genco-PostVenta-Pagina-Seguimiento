// "Mis pedidos": cada taller o perito ve solo los pedidos que tiene asignados.
import { Router } from 'express';
import { HttpError } from '../lib/errores.js';
import { requireRol } from '../lib/auth.js';
import * as pedidos from '../modelos/pedidos.js';
import { avisosActivos, cambiarAvisos } from '../servicios/avisosPedido.js';

const router = Router();
router.use(requireRol('perito', 'taller'));

function pedidoPropio(req) {
  const pedido = pedidos.obtener(req.params.id);
  if (!pedidos.estaAsignado(pedido, req.usuario)) throw new HttpError(404, 'Pedido no encontrado');
  return pedido;
}

// El pedido como lo ve el taller o el perito, con lo que puede hacer en él.
const detalle = (pedido, usuario) => ({
  ...pedidos.seguimiento(pedido),
  avisos_por_mail: avisosActivos(usuario.id, pedido.id),
  puede_confirmar: pedidos.puedeConfirmarRecepcion(pedido, usuario),
});

// `por_confirmar`: hay un envío en viaje que esta cuenta puede confirmar que le llegó.
router.get('/', (req, res) => {
  res.json(pedidos.listarAsignados(req.usuario).map((p) => {
    const r = pedidos.resumen(p);
    return { ...r, por_confirmar: r.en_viaje > 0 && pedidos.puedeConfirmarRecepcion(p, req.usuario) };
  }));
});

router.get('/:id', (req, res) => {
  res.json(detalle(pedidoPropio(req), req.usuario));
});

// Recibir (o no) por mail las novedades de este pedido. Por defecto, sí.
router.put('/:id/avisos', (req, res) => {
  const pedido = pedidoPropio(req);
  cambiarAvisos(req.usuario.id, pedido.id, Boolean(req.body?.activos));
  res.json({ avisos_por_mail: avisosActivos(req.usuario.id, pedido.id) });
});

// "Ya me llegó": el taller o el perito confirma que recibió un envío.
router.post('/:id/envios/:envio/recibido', (req, res) => {
  const pedido = pedidoPropio(req);
  pedidos.confirmarRecepcion(pedido, req.params.envio, req.usuario);
  res.json(detalle(pedidos.obtener(pedido.id), req.usuario));
});

export default router;
