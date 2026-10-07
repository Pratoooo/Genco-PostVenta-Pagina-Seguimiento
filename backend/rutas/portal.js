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

router.get('/', (req, res) => {
  res.json(pedidos.listarAsignados(req.usuario).map(pedidos.resumen));
});

router.get('/:id', (req, res) => {
  const pedido = pedidoPropio(req);
  res.json({ ...pedidos.seguimiento(pedido), avisos_por_mail: avisosActivos(req.usuario.id, pedido.id) });
});

// Recibir (o no) por mail las novedades de este pedido. Por defecto, sí.
router.put('/:id/avisos', (req, res) => {
  const pedido = pedidoPropio(req);
  cambiarAvisos(req.usuario.id, pedido.id, Boolean(req.body?.activos));
  res.json({ avisos_por_mail: avisosActivos(req.usuario.id, pedido.id) });
});

export default router;
