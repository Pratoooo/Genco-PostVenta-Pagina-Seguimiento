<?php
// Tareas automáticas: avisos por mail pendientes, ubicación de destinos en el mapa y limpieza.
// Si el hosting tiene tareas programadas (cron), llamar cada minuto a:
//   https://seguimiento.gencorepair.com.ar/tareas.php?token=EL_TOKEN   (el token lo muestra el instalador)
// o desde la línea de comandos:  php tareas.php
require __DIR__ . '/privado/inicio.php';

header('Cache-Control: no-store');
header('Content-Type: text/plain; charset=utf-8');
if (!instalado()) {
    http_response_code(503);
    exit('La página todavía no está instalada.');
}
$token = PHP_SAPI === 'cli' ? (string) config('token_tareas') : (string) ($_GET['token'] ?? '');
if (!hash_equals((string) config('token_tareas'), $token)) {
    http_response_code(403);
    exit('No autorizado.');
}
@set_time_limit(120);
tareas_ejecutar(true);
echo 'ok';
