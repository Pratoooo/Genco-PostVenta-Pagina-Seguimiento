<?php
// Configuración: privado/config.php, que crea el instalador (instalar.php). No se sube a git.
defined('GENCO') || exit;

function instalado(): bool
{
    return is_file(DIR_PRIVADO . '/config.php');
}

function config(?string $clave = null): mixed
{
    static $c = null;
    if ($c === null) {
        if (!instalado()) throw new HttpError(503, 'La página todavía no está instalada.');
        $c = require DIR_PRIVADO . '/config.php';
    }
    return $clave === null ? $c : ($c[$clave] ?? null);
}

function app_url(): string
{
    return rtrim((string) config('app_url'), '/');
}

// Publicada con HTTPS: cookies solo por conexión segura y HSTS.
function sitio_https(): bool
{
    return str_starts_with(app_url(), 'https://');
}

// Carpeta de la base de datos y los registros: su nombre lleva una parte al azar (la elige el instalador),
// así nadie puede adivinar dónde está aunque el hosting no respetara el .htaccess.
function dir_datos(): string
{
    return DIR_PRIVADO . '/' . (config('carpeta_datos') ?: 'datos');
}
