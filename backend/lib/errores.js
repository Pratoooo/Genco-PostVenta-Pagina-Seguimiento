// Errores con código HTTP y mensaje para mostrar al usuario.
import { registrar } from './registroSeguridad.js';

export class HttpError extends Error {
  constructor(status, mensaje, codigo) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

// Otra persona guardó cambios en el mismo registro mientras se editaba (pasa con cuentas compartidas).
export const conflicto = (que) =>
  new HttpError(409, `Otra persona modificó ${que} mientras lo editabas. Recargá para ver los cambios y volvé a aplicar los tuyos.`, 'conflicto');

export function noEncontrado(req, res) {
  res.status(404).json({ error: 'No encontrado' });
}

// Al usuario nunca le llegan detalles internos (OWASP A10): solo un mensaje claro. El detalle queda
// en la consola y en el registro de seguridad.
export function manejarErrores(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, codigo: err.codigo });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos inválidos' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Los datos enviados son demasiado grandes.' });
  // Dos personas creando lo mismo al mismo tiempo: la base rechaza el duplicado.
  if (/UNIQUE constraint failed/.test(err.message)) {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos. Recargá la página para verlo.' });
  }
  // Otros errores del pedido en sí (dirección mal formada, codificación no soportada...).
  const status = err.status ?? err.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(status).json({ error: 'Solicitud inválida' });
  }
  console.error(err);
  registrar('error_interno', { ruta: req.originalUrl, metodo: req.method, mensaje: String(err?.message ?? err).slice(0, 300) }, req, 'aviso');
  res.status(500).json({ error: 'Error interno del servidor' });
}
