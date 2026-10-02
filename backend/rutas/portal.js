// "Mis pedidos": cada taller o perito ve solo los pedidos que tiene asignados.
import { Router } from 'express';
import { HttpError } from '../lib/errores.js';
import { requireRol } from '../lib/auth.js';
import * as pedidos from '../modelos/pedidos.js';

const router = Router();
router.use(requireRol('perito', 'taller'));

router.get('/', (req, res) => {
  res.json(pedidos.listarAsignados(req.usuario).map(pedidos.resumen));
});

router.get('/:id', (req, res) => {
  const pedido = pedidos.obtener(req.params.id);
  if (!pedidos.estaAsignado(pedido, req.usuario)) throw new HttpError(404, 'Pedido no encontrado');
  res.json(pedidos.seguimiento(pedido));
});

export default router;
