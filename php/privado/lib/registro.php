<?php
// Registro de eventos de seguridad (OWASP A09): ingresos, intentos fallidos, bloqueos, cambios de contraseña,
// cambios de cuentas y accesos denegados. Líneas JSON en privado/datos (nunca contraseñas, tokens ni cookies).
// Ante eventos graves se manda un mail de alerta (como mucho uno por hora por motivo).
defined('GENCO') || exit;

const TAMANO_MAXIMO_REGISTRO = 5 * 1024 * 1024;

$GLOBALS['usuario_actual'] = null;

function archivo_registro(): string
{
    return dir_datos() . '/' . (config('archivo_registro') ?: 'seguridad.log');
}

// nivel: 'info' (normal) | 'aviso' (sospechoso) | 'alerta' (grave: además se avisa por mail)
function registrar(string $evento, array $datos = [], string $nivel = 'info'): void
{
    $entrada = [
        'fecha' => gmdate('c'),
        'nivel' => $nivel,
        'evento' => $evento,
        'ip' => ip_cliente(),
        'usuario' => $GLOBALS['usuario_actual']['email'] ?? null,
    ] + $datos;
    try {
        $archivo = archivo_registro();
        if (is_file($archivo) && filesize($archivo) > TAMANO_MAXIMO_REGISTRO) @rename($archivo, $archivo . '.1');
        file_put_contents($archivo, json_encode($entrada, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
    } catch (Throwable $e) {
        error_log('No se pudo escribir el registro de seguridad: ' . $e->getMessage());
    }
    if ($nivel === 'alerta') {
        $clave = $evento . '|' . ($datos['email'] ?? '') . '|' . $entrada['ip'];
        despues(fn () => alertar($evento, $entrada, $clave));
    }
}

function alertar(string $evento, array $entrada, string $clave): void
{
    $l = limite('alerta', 1, 3600);
    if (limite_excedido($l, $clave)) return;
    limite_sumar($l, $clave);
    $destino = config('alertas_email') ?: (config('gmail')['usuario'] ?? '');
    if (!$destino) return;
    try {
        enviar_mail($destino, "Alerta de seguridad — Genco Siniestros: $evento",
            "Se registró un evento de seguridad en la página:\n\n" . json_encode($entrada, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            . "\n\nSi no lo reconocés, revisá el registro de seguridad en el hosting (carpeta privado/datos).");
    } catch (Throwable $e) {
        error_log('No se pudo mandar la alerta de seguridad: ' . $e->getMessage());
    }
}
