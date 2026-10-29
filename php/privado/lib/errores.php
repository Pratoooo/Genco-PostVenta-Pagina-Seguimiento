<?php
// Errores con código HTTP y mensaje para mostrar al usuario.
defined('GENCO') || exit;

final class HttpError extends Exception
{
    public function __construct(public int $status, string $mensaje, public ?string $codigo = null)
    {
        parent::__construct($mensaje);
    }
}

// Otra persona guardó cambios en el mismo registro mientras se editaba (pasa con cuentas compartidas).
function conflicto(string $que): HttpError
{
    return new HttpError(409, "Otra persona modificó $que mientras lo editabas. Recargá para ver los cambios y volvé a aplicar los tuyos.", 'conflicto');
}

// Los avisos de PHP (variables indefinidas, etc.) se tratan como errores, para no seguir con datos incompletos.
set_error_handler(function (int $nivel, string $mensaje, string $archivo = '', int $linea = 0): bool {
    if (!(error_reporting() & $nivel)) return false;
    throw new ErrorException($mensaje, 0, $nivel, $archivo, $linea);
});
