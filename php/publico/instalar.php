<?php
// Instalador de la página. Se usa UNA sola vez, al subirla al hosting: revisa que el hosting tenga lo necesario,
// pide los datos (código de instalación, cuenta de administración, mail y base de datos), crea la
// configuración y las tablas, y después queda bloqueado.
//
// Esta primera parte está escrita para que funcione incluso con un PHP viejo, así puede avisar qué falta.
declare(strict_types=1);

header('Cache-Control: no-store');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");

$privado = __DIR__ . '/privado';
$archivoCodigo = $privado . '/codigo-instalacion.php';

function h($s)
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

function pagina($titulo, $cuerpo, $status = 200)
{
    http_response_code($status);
    echo '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<meta name="robots" content="noindex"><title>' . h($titulo) . ' — Genco Siniestros</title>'
        . '<link rel="icon" href="/img/genco.png"><link rel="stylesheet" href="/css/estilos.css"></head><body>'
        . '<main class="container" style="max-width:780px;padding-top:36px;padding-bottom:48px">'
        . '<img src="/img/genco.png" alt="Grupo Genco" style="height:46px;margin-bottom:18px">'
        . '<h1 style="margin-bottom:6px">' . h($titulo) . '</h1>' . $cuerpo . '</main></body></html>';
    exit;
}

if (is_file($privado . '/config.php')) {
    pagina('La página ya está instalada', '<p>Para entrar, andá a <a href="/login">iniciar sesión</a>. El instalador ya no se puede volver a usar.</p>', 403);
}

$requisitos = [
    ['PHP 8.1 o más nuevo (este hosting tiene ' . PHP_VERSION . '; se cambia en Mi Sitio Web → Configuración de PHP)', version_compare(PHP_VERSION, '8.1.0', '>=')],
    ['Extensión mbstring (textos con acentos)', extension_loaded('mbstring')],
    ['Extensión openssl (mails y conexiones seguras)', extension_loaded('openssl')],
    ['Base de datos: SQLite o MySQL', extension_loaded('pdo_sqlite') || extension_loaded('pdo_mysql')],
    ['Conexiones a internet desde PHP (curl o allow_url_fopen), para el mapa', function_exists('curl_init') || ini_get('allow_url_fopen')],
    ['Se puede escribir en la carpeta "privado" (permisos)', is_writable($privado)],
];
$faltan = array_filter($requisitos, function ($r) { return !$r[1]; });
if ($faltan) {
    $lista = '';
    foreach ($requisitos as $r) $lista .= '<li>' . ($r[1] ? '✓ ' : '<strong style="color:#c62828">✗ ') . h($r[0]) . ($r[1] ? '' : '</strong>') . '</li>';
    pagina('Falta algo en el hosting', '<p>Antes de instalar hay que resolver lo marcado con ✗ (desde el panel del hosting o con su soporte):</p><ul>' . $lista . '</ul>', 500);
}
if (!is_file($archivoCodigo)) {
    pagina('Falta el código de instalación', '<p>No está el archivo <code>privado/codigo-instalacion.php</code>. Volvé a subir la carpeta completa de la página.</p>', 500);
}

// ---------------------------------------------------------------- A partir de acá, PHP 8.1 o más nuevo

require $privado . '/inicio.php';

$esHttps = es_https();
$valores = [
    'codigo' => '',
    'app_url' => ($esHttps ? 'https' : 'http') . '://' . strtolower((string) ($_SERVER['HTTP_HOST'] ?? 'localhost')),
    'admin_nombre' => 'Administración',
    'admin_email' => '',
    'mail_modo' => 'gmail',
    'gmail_usuario' => '',
    'mail_remitente' => '',
    'db_tipo' => extension_loaded('pdo_sqlite') ? 'sqlite' : 'mysql',
    'db_host' => 'localhost',
    'db_nombre' => '',
    'db_usuario' => '',
    'genco_direccion' => 'Carril Rodríguez Peña, Godoy Cruz, Mendoza',
    'genco_coordenadas' => '-32.9264973,-68.8320528',
];
$errores = [];

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    foreach ($valores as $k => $_) $valores[$k] = trim((string) ($_POST[$k] ?? ''));
    $codigoEsperado = (string) (require $archivoCodigo);
    if (!hash_equals($codigoEsperado, strtoupper($valores['codigo']))) $errores[] = 'El código de instalación no es correcto.';

    $appUrl = rtrim($valores['app_url'], '/');
    if (!preg_match('#^https?://[a-z0-9.\-]+(:\d+)?$#i', $appUrl)) $errores[] = 'La dirección del sitio no es válida (ej: https://seguimiento.gencorepair.com.ar).';
    $nombre = texto($valores['admin_nombre'], 100) ?: 'Administración';
    $email = email($valores['admin_email']);
    if (!es_email($email)) $errores[] = 'El email de la cuenta de administración no es válido.';
    $password = (string) ($_POST['admin_password'] ?? '');
    if ($password !== (string) ($_POST['admin_password2'] ?? '')) $errores[] = 'Las contraseñas de administración no coinciden.';
    try {
        validar_password($password, $email);
    } catch (HttpError $e) {
        $errores[] = $e->getMessage();
    }

    $mail = ['modo' => $valores['mail_modo'] === 'hosting' ? 'hosting' : 'gmail', 'remitente' => ''];
    $gmail = ['usuario' => '', 'clave_app' => ''];
    if ($mail['modo'] === 'gmail') {
        $gmail = ['usuario' => email($valores['gmail_usuario']), 'clave_app' => str_replace(' ', '', (string) ($_POST['gmail_clave'] ?? ''))];
        if (!es_email($gmail['usuario']) || $gmail['clave_app'] === '') $errores[] = 'Completá el Gmail y su contraseña de aplicación.';
    } else {
        $mail['remitente'] = email($valores['mail_remitente']);
        if (!es_email($mail['remitente'])) $errores[] = 'Completá la casilla del hosting desde la que salen los mails (ej: pedidos@gencorepair.com.ar).';
    }

    if ($valores['db_tipo'] === 'mysql') {
        $db = ['tipo' => 'mysql', 'host' => $valores['db_host'] ?: 'localhost', 'nombre' => $valores['db_nombre'], 'usuario' => $valores['db_usuario'], 'clave' => (string) ($_POST['db_clave'] ?? '')];
        if (!extension_loaded('pdo_mysql')) {
            $errores[] = 'Este hosting no tiene MySQL para PHP: elegí SQLite.';
        } elseif ($db['nombre'] === '' || $db['usuario'] === '') {
            $errores[] = 'Completá el nombre de la base de datos MySQL y su usuario.';
        } elseif (!$errores) {
            try {
                conectar_db($db);
            } catch (Throwable $e) {
                $errores[] = 'No se pudo conectar a la base de datos MySQL: ' . $e->getMessage();
            }
        }
    } else {
        if (!extension_loaded('pdo_sqlite')) $errores[] = 'Este hosting no tiene SQLite para PHP: elegí MySQL.';
        $db = ['tipo' => 'sqlite', 'archivo' => 'genco.sqlite'];
    }

    $lat = $lon = null;
    if ($valores['genco_coordenadas'] !== '') {
        if (preg_match('/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/', $valores['genco_coordenadas'], $c)) {
            [$lat, $lon] = [(float) $c[1], (float) $c[2]];
        } else {
            $errores[] = 'Las coordenadas de Genco tienen que ser "latitud,longitud" (ej: -32.9264973,-68.8320528).';
        }
    }

    if (!$errores) {
        $carpeta = 'datos-' . bin2hex(random_bytes(8));
        $dirDatos = "$privado/$carpeta";
        $config = [
            'app_url' => $appUrl,
            'secreto' => bin2hex(random_bytes(32)),
            'token_tareas' => bin2hex(random_bytes(16)),
            'carpeta_datos' => $carpeta,
            'db' => $db,
            'gmail' => $gmail,
            'mail' => $mail,
            'alertas_email' => '',
            'genco' => ['direccion' => texto($valores['genco_direccion'], 200), 'lat' => $lat, 'lon' => $lon],
        ];
        try {
            mkdir($dirDatos, 0750, true);
            copy("$privado/.htaccess", "$dirDatos/.htaccess");
            file_put_contents("$dirDatos/index.html", '');
            $php = "<?php\n// Configuración de la página (la creó el instalador el " . gmdate('d/m/Y H:i') . " UTC).\n"
                . "// NO compartir este archivo: tiene las claves de la base de datos, del mail y de las sesiones.\nreturn " . var_export($config, true) . ";\n";
            file_put_contents("$privado/config.php.tmp", $php, LOCK_EX);
            rename("$privado/config.php.tmp", "$privado/config.php");
            @chmod("$privado/config.php", 0640);

            db();
            if (!usuario_por_email($email)) {
                usuario_crear(['email' => $email, 'nombre' => $nombre, 'empresa' => '', 'direccion' => '', 'rol' => 'admin', 'activo' => 1], $password);
            }
        } catch (Throwable $e) {
            @unlink("$privado/config.php");
            pagina('No se pudo instalar', '<div class="alert error">' . h($e->getMessage()) . '</div><p><a href="/instalar.php">Volver a intentar</a></p>', 500);
        }

        // Con HTTPS funcionando, la página pasa a exigirlo (y avisa a los navegadores que siempre lo usen).
        exigir_https();
        $pruebaMail = '';
        if ($mail['modo'] === 'gmail') {
            try {
                verificar_mail();
                $pruebaMail = '<div class="alert ok">✓ Gmail funciona: los avisos salen desde ' . h($gmail['usuario']) . '.</div>';
            } catch (Throwable $e) {
                $pruebaMail = '<div class="alert error">El mail todavía no funciona: ' . h($e->getMessage())
                    . '. Se corrige en <code>privado/config.php</code> (parte "gmail") desde el Administrador de archivos.</div>';
            }
        }
        @unlink($archivoCodigo);
        registrar('instalacion', ['email' => $email]);
        $cron = h($appUrl . '/tareas.php?token=' . $config['token_tareas']);
        pagina('¡Listo! La página está instalada', $pruebaMail
            . '<p>Ya podés <a class="btn" href="/login" style="margin:8px 0">Iniciar sesión</a> con <strong>' . h($email) . '</strong> y la contraseña que elegiste.</p>'
            . ($esHttps ? '' : '<div class="alert info">La página se abrió sin https://. Cuando el certificado SSL del subdominio esté activo, entrá por https:// y la página va a empezar a exigirlo sola.</div>')
            . '<h3 style="margin-top:22px">Avisos por mail aunque nadie tenga la página abierta (opcional)</h3>'
            . '<p class="small">Si el hosting tiene <strong>Tareas programadas (Cron)</strong>, creá una que corra cada minuto y abra esta dirección:</p>'
            . '<p><code style="word-break:break-all">' . $cron . '</code></p>'
            . '<p class="small muted">Guardala en un lugar seguro. Sin la tarea programada, los avisos salen igual cada vez que alguien usa la página.</p>');
    }
}

$sel = function (string $campo, string $valor) use ($valores): string {
    return $valores[$campo] === $valor ? 'checked' : '';
};
$v = fn (string $k) => h($valores[$k]);
$listaErrores = $errores ? '<div class="alert error" role="alert"><div>' . implode('<br>', array_map('h', $errores)) . '</div></div>' : '';
$sinSqlite = extension_loaded('pdo_sqlite') ? '' : 'disabled';
$sinMysql = extension_loaded('pdo_mysql') ? '' : 'disabled';

pagina('Instalar la página de seguimiento', $listaErrores . <<<HTML
<p class="muted">Se hace una sola vez. Después de instalar, esta página queda bloqueada.</p>
<form method="post" autocomplete="off" novalidate>
  <div class="card" style="margin-top:18px">
    <h3>1 · Código de instalación</h3>
    <label for="codigo" style="margin-top:12px">Código (te lo pasó quien armó la página)</label>
    <input id="codigo" name="codigo" value="{$v('codigo')}" placeholder="XXXX-XXXX-XXXX" required>
    <label for="app_url" style="margin-top:14px">Dirección del sitio</label>
    <input id="app_url" name="app_url" value="{$v('app_url')}" required>
    <div class="hint">La que van a usar todos, por ejemplo https://seguimiento.gencorepair.com.ar (se usa en los enlaces de los mails).</div>
  </div>

  <div class="card">
    <h3>2 · Cuenta de administración</h3>
    <div class="grid" style="margin-top:12px">
      <div><label for="admin_nombre">Nombre</label><input id="admin_nombre" name="admin_nombre" value="{$v('admin_nombre')}"></div>
      <div><label for="admin_email">Email (para ingresar)</label><input id="admin_email" name="admin_email" type="email" value="{$v('admin_email')}" required></div>
      <div><label for="admin_password">Contraseña</label><input id="admin_password" name="admin_password" type="password" autocomplete="new-password" required></div>
      <div><label for="admin_password2">Repetir contraseña</label><input id="admin_password2" name="admin_password2" type="password" autocomplete="new-password" required></div>
    </div>
    <div class="hint">Mínimo 8 caracteres. Que no sea una contraseña común (como 12345678) ni contenga el email.</div>
  </div>

  <div class="card">
    <h3>3 · Mails (avisos y recuperación de contraseña)</h3>
    <label class="check" style="margin-top:12px"><input type="radio" name="mail_modo" value="gmail" {$sel('mail_modo', 'gmail')}> Desde Gmail (recomendado)</label>
    <div class="grid" style="margin-top:10px">
      <div><label for="gmail_usuario">Gmail</label><input id="gmail_usuario" name="gmail_usuario" type="email" value="{$v('gmail_usuario')}" placeholder="avisos.genco@gmail.com"></div>
      <div><label for="gmail_clave">Contraseña de aplicación</label><input id="gmail_clave" name="gmail_clave" type="password" autocomplete="off"></div>
    </div>
    <div class="hint">No es la contraseña normal de la cuenta: son las 16 letras de "Contraseñas de aplicación" de Google (la misma que se usa hoy).</div>
    <label class="check" style="margin-top:16px"><input type="radio" name="mail_modo" value="hosting" {$sel('mail_modo', 'hosting')}> Desde una casilla del hosting</label>
    <div style="margin-top:10px"><label for="mail_remitente">Casilla</label><input id="mail_remitente" name="mail_remitente" type="email" value="{$v('mail_remitente')}" placeholder="pedidos@gencorepair.com.ar"></div>
  </div>

  <div class="card">
    <h3>4 · Base de datos</h3>
    <label class="check" style="margin-top:12px"><input type="radio" name="db_tipo" value="sqlite" {$sel('db_tipo', 'sqlite')} {$sinSqlite}> SQLite: un archivo dentro de la página, no hay que crear nada (recomendado)</label>
    <label class="check" style="margin-top:12px"><input type="radio" name="db_tipo" value="mysql" {$sel('db_tipo', 'mysql')} {$sinMysql}> MySQL: una base creada en el panel del hosting (Bases de datos)</label>
    <div class="grid" style="margin-top:10px">
      <div><label for="db_host">Servidor</label><input id="db_host" name="db_host" value="{$v('db_host')}"></div>
      <div><label for="db_nombre">Nombre de la base</label><input id="db_nombre" name="db_nombre" value="{$v('db_nombre')}"></div>
      <div><label for="db_usuario">Usuario</label><input id="db_usuario" name="db_usuario" value="{$v('db_usuario')}"></div>
      <div><label for="db_clave">Contraseña</label><input id="db_clave" name="db_clave" type="password" autocomplete="off"></div>
    </div>
    <div class="hint">Los datos de MySQL solo hacen falta si elegís MySQL.</div>
  </div>

  <div class="card">
    <h3>5 · Desde dónde salen los pedidos</h3>
    <div class="grid" style="margin-top:12px">
      <div><label for="genco_direccion">Dirección de Genco</label><input id="genco_direccion" name="genco_direccion" value="{$v('genco_direccion')}"></div>
      <div><label for="genco_coordenadas">Punto exacto (latitud,longitud)</label><input id="genco_coordenadas" name="genco_coordenadas" value="{$v('genco_coordenadas')}"></div>
    </div>
    <div class="hint">Para calcular la distancia y el tiempo hasta cada taller o perito. Ya viene cargado con GENCO SA (Godoy Cruz).</div>
  </div>

  <button class="btn" type="submit" style="width:100%;margin-top:6px">Instalar</button>
</form>
HTML);
