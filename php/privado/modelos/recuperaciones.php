<?php
// Enlaces de "¿Olvidaste tu contraseña?". Se guarda solo el hash del token: quien vea la base no puede usarlos.
defined('GENCO') || exit;

const VIGENCIA_RECUPERACION_MINUTOS = 60;

// Crea un enlace nuevo (anula los anteriores de esa cuenta) y devuelve el token.
function recuperacion_crear(int $usuarioId): string
{
    $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    transaccion(function () use ($usuarioId, $token) {
        ejecutar('DELETE FROM recuperaciones WHERE usuario_id = ? OR expira < ?', [$usuarioId, time()]);
        ejecutar('INSERT INTO recuperaciones (usuario_id, token_hash, expira, created_at) VALUES (?, ?, ?, ?)',
            [$usuarioId, hash('sha256', $token), time() + VIGENCIA_RECUPERACION_MINUTOS * 60, ahora()]);
    });
    return $token;
}

// Cambia la contraseña con un token válido. El enlace sirve una sola vez. Devuelve el email de la cuenta.
function recuperacion_usar(mixed $token, string $password): string
{
    $rec = is_string($token) && $token !== '' ? fila('SELECT * FROM recuperaciones WHERE token_hash = ?', [hash('sha256', $token)]) : null;
    if (!$rec || $rec['usado'] || (int) $rec['expira'] < time()) {
        throw new HttpError(400, 'El enlace no es válido o ya venció. Pedí uno nuevo desde "¿Olvidaste tu contraseña?".');
    }
    validar_password($password);
    transaccion(function () use ($rec, $password) {
        usuario_cambiar_password((int) $rec['usuario_id'], $password);
        ejecutar('DELETE FROM recuperaciones WHERE usuario_id = ?', [(int) $rec['usuario_id']]);
    });
    return (string) valor('SELECT email FROM usuarios WHERE id = ?', [(int) $rec['usuario_id']]);
}
