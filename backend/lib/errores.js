// Errores con código HTTP y mensaje para mostrar al usuario.
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

export function manejarErrores(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, codigo: err.codigo });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos inválidos' });
  // Dos personas creando lo mismo al mismo tiempo: la base rechaza el duplicado.
  if (/UNIQUE constraint failed/.test(err.message)) {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos. Recargá la página para verlo.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
}
