<?php
// Pedido y respuesta HTTP de la API: cabeceras de seguridad, datos que llegan, IP del visitante, protección
// contra pedidos de otros sitios (CSRF) y límites de intentos (OWASP A01, A02, A06).
defined('GENCO') || exit;

const LIMITE_CUERPO = 32 * 1024;

function metodo(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

// "/api/admin/pedidos/3" -> "/admin/pedidos/3"
function ruta_api(): string
{
    $ruta = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $ruta = '/' . ltrim(substr($ruta, (int) strpos($ruta, '/api') + 4), '/');
    return rtrim($ruta, '/') ?: '/';
}

function es_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

// Si la página se publicó con https:// y ya entran por https, el .htaccess pasa a exigirlo (redirige http a
// https y avisa a los navegadores con HSTS). Lo hace el instalador y se repite en las tareas, por si se
// instaló antes de tener el certificado o al actualizar se subió el .htaccess nuevo (que viene sin activar).
function exigir_https(): void
{
    if (!sitio_https() || !es_https()) return;
    $archivo = DIR_PUBLICO . '/.htaccess';
    $texto = @file_get_contents($archivo);
    if ($texto === false || !str_contains($texto, '#HTTPS# ') || !is_writable($archivo)) return;
    file_put_contents($archivo, str_replace('#HTTPS# ', '', $texto), LOCK_EX);
}

// Solo se cargan scripts, estilos, imágenes y fuentes de la propia página; el mapa del destino es el de
// OpenStreetMap. Lo mismo que manda el .htaccess para las pantallas.
function cabeceras_seguridad(): void
{
    $csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; "
        . "connect-src 'self'; frame-src https://www.openstreetmap.org; form-action 'self'; frame-ancestors 'none'; "
        . "base-uri 'self'; object-src 'none'" . (sitio_https() ? '; upgrade-insecure-requests' : '');
    header("Content-Security-Policy: $csp");
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');
    if (sitio_https()) header('Strict-Transport-Security: max-age=31536000');
    header('Cache-Control: no-store');
    header_remove('X-Powered-By');
}

// Datos JSON del pedido (como mucho 32 KB).
function cuerpo(): array
{
    static $datos = null;
    if ($datos !== null) return $datos;
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > LIMITE_CUERPO) throw new HttpError(413, 'Los datos enviados son demasiado grandes.');
    $crudo = (string) file_get_contents('php://input', false, null, 0, LIMITE_CUERPO + 1);
    if (strlen($crudo) > LIMITE_CUERPO) throw new HttpError(413, 'Los datos enviados son demasiado grandes.');
    if (trim($crudo) === '') return $datos = [];
    $j = json_decode($crudo, true);
    if (!is_array($j)) throw new HttpError(400, 'Datos inválidos');
    return $datos = $j;
}

function dato(string $clave, mixed $omision = null): mixed
{
    return cuerpo()[$clave] ?? $omision;
}

// IP del visitante. En hostings compartidos el pedido puede llegar a través de un proxy interno: en ese
// caso se toma la última IP pública de X-Forwarded-For.
function ip_cliente(): string
{
    static $ip = null;
    if ($ip !== null) return $ip;
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    if (es_ip_privada($ip) && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $lista = array_map('trim', explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']));
        for ($i = count($lista) - 1; $i >= 0; $i--) {
            if (filter_var($lista[$i], FILTER_VALIDATE_IP) && !es_ip_privada($lista[$i])) return $ip = $lista[$i];
        }
    }
    return $ip;
}

function es_ip_privada(string $ip): bool
{
    return $ip === '' || filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false;
}

function host_de(string $url): ?string
{
    $p = parse_url($url);
    if (empty($p['host'])) return null;
    return strtolower($p['host']) . (isset($p['port']) ? ':' . $p['port'] : '');
}

// Un cambio (crear, editar, borrar, ingresar...) solo se acepta si lo pide la propia página: los
// navegadores mandan Sec-Fetch-Site y Origin, que un sitio ajeno no puede falsificar. Además los datos
// tienen que venir como JSON, algo que un formulario de otro sitio no puede mandar.
function solo_mismo_sitio(): void
{
    if (!in_array(metodo(), ['POST', 'PUT', 'PATCH', 'DELETE'], true)) return;
    $sitio = (string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '');
    $origen = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    $hostOrigen = $origen !== '' ? host_de($origen) : null;
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    $ajeno = ($sitio !== '' && !in_array($sitio, ['same-origin', 'none'], true))
        || ($origen !== '' && $hostOrigen !== $host && $hostOrigen !== host_de(app_url()));
    if ($ajeno) {
        registrar('pedido_de_otro_sitio_bloqueado', ['ruta' => ruta_api(), 'origen' => $origen, 'sitio' => $sitio], 'aviso');
        throw new HttpError(403, 'Pedido no permitido.');
    }
    $tipo = (string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '');
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0 && stripos($tipo, 'application/json') !== 0) {
        throw new HttpError(415, 'Los datos tienen que enviarse como JSON.');
    }
}

// ---------------------------------------------------------------- Límites de intentos (guardados en la base)

// Un límite: como mucho `max` eventos por clave dentro de `ventana` segundos.
function limite(string $nombre, int $max, int $ventana, string $mensaje = 'Demasiados intentos. Probá de nuevo más tarde.'): array
{
    return compact('nombre', 'max', 'ventana', 'mensaje');
}

function clave_limite(array $l, string $clave): string
{
    return $l['nombre'] . '|' . hash('sha256', $clave);
}

function limite_cuenta(array $l, string $clave): int
{
    $f = fila('SELECT n, desde FROM limites WHERE clave = ?', [clave_limite($l, $clave)]);
    if (!$f || time() - (int) $f['desde'] > $l['ventana']) return 0;
    return (int) $f['n'];
}

function limite_excedido(array $l, string $clave): bool
{
    return limite_cuenta($l, $clave) >= $l['max'];
}

function limite_controlar(array $l, string $clave): void
{
    if (limite_excedido($l, $clave)) throw new HttpError(429, $l['mensaje']);
}

function limite_sumar(array $l, string $clave): void
{
    $k = clave_limite($l, $clave);
    transaccion(function () use ($l, $k) {
        $f = fila('SELECT n, desde FROM limites WHERE clave = ?', [$k]);
        if ($f && time() - (int) $f['desde'] <= $l['ventana']) {
            ejecutar('UPDATE limites SET n = n + 1 WHERE clave = ?', [$k]);
        } else {
            ejecutar('DELETE FROM limites WHERE clave = ?', [$k]);
            ejecutar('INSERT INTO limites (clave, n, desde) VALUES (?, 1, ?)', [$k, time()]);
        }
    });
}

function limite_limpiar(array $l, string $clave): void
{
    ejecutar('DELETE FROM limites WHERE clave = ?', [clave_limite($l, $clave)]);
}

// ---------------------------------------------------------------- Respuesta

$GLOBALS['respuesta'] = [200, null];
$GLOBALS['despues'] = [];

function responder(mixed $datos, int $status = 200): void
{
    $GLOBALS['respuesta'] = [$status, $datos];
}

// Trabajo para hacer después de contestar (mandar mails, ubicar direcciones en el mapa...), así la
// persona no espera.
function despues(callable $fn): void
{
    $GLOBALS['despues'][] = $fn;
}

// Manda la respuesta y cierra la conexión; lo que sigue corre sin que el navegador espere.
function enviar_respuesta(): void
{
    [$status, $datos] = $GLOBALS['respuesta'];
    $json = (string) json_encode($datos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    while (ob_get_level() > 0) ob_end_clean();
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Length: ' . strlen($json));
    header('Connection: close');
    echo $json;
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    } else {
        flush();
    }
}
