// Consulta de un pedido sin cuenta, con el número de siniestro y la patente.
import { Router } from 'express';
import { HttpError } from '../lib/errores.js';
import * as norm from '../lib/normalizar.js';
import * as pedidos from '../modelos/pedidos.js';

const router = Router();

// Por POST para que el siniestro y la patente no queden en la URL ni en los logs.
router.post('/seguimiento', (req, res) => {
  const siniestro = norm.texto(req.body?.siniestro);
  const patente = norm.patente(req.body?.patente);
  if (!siniestro || !patente) throw new HttpError(400, 'Ingresá el número de siniestro y la patente.');
  const pedido = pedidos.buscarPorSiniestroYPatente(siniestro, patente);
  if (!pedido) throw new HttpError(404, 'No encontramos un pedido con ese siniestro y patente. Revisá los datos o consultá con tu taller.');
  res.json(pedidos.seguimiento(pedido));
});

export default router;
