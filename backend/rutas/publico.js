// Consulta de un pedido sin cuenta, con el número de siniestro y la patente.
import { Router } from 'express';
import { HttpError } from '../lib/errores.js';
import { limitador, MINUTO } from '../lib/limitador.js';
import { registrar } from '../lib/registroSeguridad.js';
import * as norm from '../lib/normalizar.js';
import * as pedidos from '../modelos/pedidos.js';

const router = Router();

// Evita que alguien pruebe siniestros y patentes a ciegas: como mucho 20 consultas sin resultado
// cada 15 minutos desde la misma conexión.
const consultasFallidas = limitador(20, 15 * MINUTO, 'Demasiadas consultas sin resultado. Probá de nuevo en 15 minutos.');

// Por POST para que el siniestro y la patente no queden en la URL ni en los logs.
router.post('/seguimiento', (req, res) => {
  consultasFallidas.controlar(req.ip);
  const siniestro = norm.texto(req.body?.siniestro, 40);
  const patente = norm.patente(req.body?.patente);
  if (!siniestro || !patente) throw new HttpError(400, 'Ingresá el número de siniestro y la patente.');
  const pedido = pedidos.buscarPorSiniestroYPatente(siniestro, patente);
  if (!pedido) {
    consultasFallidas.sumar(req.ip);
    if (consultasFallidas.excedido(req.ip)) registrar('consulta_publica_bloqueada', {}, req, 'aviso');
    throw new HttpError(404, 'No encontramos un pedido con ese siniestro y patente. Revisá los datos o consultá con tu taller.');
  }
  res.json(pedidos.seguimiento(pedido));
});

export default router;
