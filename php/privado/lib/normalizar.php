<?php
// Limpieza y validación de los datos que llegan de los formularios (OWASP A05). Todo texto se recorta a un
// largo máximo y pierde los caracteres de control (saltos de línea, tabs, nulos...), que no tienen sentido
// en estos campos y podrían colarse en asuntos de mails o en el registro.
defined('GENCO') || exit;

function texto(mixed $s, int $max = 200): string
{
    $t = is_scalar($s) ? (string) $s : '';
    if (!mb_check_encoding($t, 'UTF-8')) $t = mb_convert_encoding($t, 'UTF-8', 'UTF-8');
    $t = (string) preg_replace('/[\p{Cc}\p{Zl}\p{Zp}]/u', ' ', $t);
    $t = (string) preg_replace('/\s{2,}/u', ' ', trim($t));
    return mb_substr($t, 0, $max);
}

function email(mixed $s): string
{
    $t = is_scalar($s) ? (string) $s : '';
    if (!mb_check_encoding($t, 'UTF-8')) return '';
    $t = (string) preg_replace('/[\p{Cc}\p{Zl}\p{Zp}]/u', '', $t);
    return mb_substr(mb_strtolower(trim($t)), 0, 254);
}

function es_email(string $s): bool
{
    return (bool) preg_match('/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/u', $s);
}

// "ab 123-cd" -> "AB123CD"
function patente(mixed $s): string
{
    $t = strtoupper(is_scalar($s) ? (string) $s : '');
    return substr((string) preg_replace('/[^A-Z0-9]/', '', $t), 0, 10);
}

function esc(mixed $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function entero_o_nulo(mixed $v): ?int
{
    if ($v === null || $v === '') return null;
    return is_numeric($v) ? (int) $v : null;
}
