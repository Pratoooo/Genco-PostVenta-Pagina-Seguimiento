<?php
// Arranque común de la versión PHP (hosting compartido, por ejemplo Ferozo / DonWeb): configuración,
// base de datos y librerías. Lo cargan la API, las tareas y el instalador.
//
// Es la misma página que la versión Node.js: la API responde igual, así las pantallas (frontend) no cambian.
declare(strict_types=1);

define('GENCO', true);
define('DIR_PRIVADO', __DIR__);
define('DIR_PUBLICO', dirname(__DIR__));

date_default_timezone_set('UTC');
mb_internal_encoding('UTF-8');

require __DIR__ . '/lib/errores.php';
require __DIR__ . '/lib/config.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/http.php';
require __DIR__ . '/lib/normalizar.php';
require __DIR__ . '/lib/registro.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/mail.php';
require __DIR__ . '/modelos/usuarios.php';
require __DIR__ . '/modelos/pedidos.php';
require __DIR__ . '/modelos/recuperaciones.php';
require __DIR__ . '/servicios/avisos.php';
require __DIR__ . '/servicios/mapas.php';
require __DIR__ . '/servicios/tareas.php';
require __DIR__ . '/rutas.php';
