<?php
// Solo para probar en una computadora con el servidor que trae PHP: imita las reglas del .htaccess del hosting.
//   php -S 127.0.0.1:3200 -t dist/genco-seguimiento-php php/servidor-dev.php
$ruta = (string) parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH);
$raiz = (string) $_SERVER['DOCUMENT_ROOT'];

if (preg_match('#^/privado(/|$)#', $ruta) || preg_match('/\.(sqlite|db|log|ini|sh|md|zip)$/', $ruta)) {
    http_response_code(403);
    exit('Prohibido');
}
if ($ruta === '/') {
    header('Location: /login', true, 302);
    exit;
}
if (preg_match('#^/api(/|$)#', $ruta)) {
    require $raiz . '/api/index.php';
    return true;
}
$html = preg_match('#^/([a-z-]+)/?$#', $ruta, $m) ? "$raiz/{$m[1]}.html" : null;
if ($html && is_file($html)) {
    header('Content-Type: text/html; charset=utf-8');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-src https://www.openstreetmap.org; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    readfile($html);
    return true;
}
return false;
