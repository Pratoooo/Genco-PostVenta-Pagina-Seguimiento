<?php
// Base de datos: SQLite (un archivo en privado/datos) o MySQL (la que da el hosting). Las consultas son las
// mismas para las dos; solo cambia cómo se crean las tablas. Todas las consultas usan parámetros (OWASP A05).
defined('GENCO') || exit;

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = config('db');
    $pdo = conectar_db($c);
    migrar($pdo);
    return $pdo;
}

function conectar_db(array $c): PDO
{
    $opciones = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ];
    if (($c['tipo'] ?? 'sqlite') === 'mysql') {
        $pdo = new PDO("mysql:host={$c['host']};dbname={$c['nombre']};charset=utf8mb4", $c['usuario'], $c['clave'], $opciones);
        $pdo->exec("SET time_zone = '+00:00'");
    } else {
        // El archivo va en la carpeta de datos (con nombre al azar), salvo que se indique una ruta completa.
        $archivo = str_contains($c['archivo'], '/') ? $c['archivo'] : dir_datos() . '/' . $c['archivo'];
        $pdo = new PDO('sqlite:' . $archivo, null, null, $opciones);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA busy_timeout = 5000');
    }
    return $pdo;
}

function es_mysql(): bool
{
    return (config('db')['tipo'] ?? 'sqlite') === 'mysql';
}

function consulta(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute(array_values($params));
    return $st;
}

function fila(string $sql, array $params = []): ?array
{
    $f = consulta($sql, $params)->fetch();
    return $f === false ? null : $f;
}

function filas(string $sql, array $params = []): array
{
    return consulta($sql, $params)->fetchAll();
}

function valor(string $sql, array $params = []): mixed
{
    $v = consulta($sql, $params)->fetchColumn();
    return $v === false ? null : $v;
}

function ejecutar(string $sql, array $params = []): int
{
    return consulta($sql, $params)->rowCount();
}

function ultimo_id(): int
{
    return (int) db()->lastInsertId();
}

function transaccion(callable $fn): mixed
{
    $pdo = db();
    if ($pdo->inTransaction()) return $fn();
    $pdo->beginTransaction();
    try {
        $r = $fn();
        $pdo->commit();
        return $r;
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

// Fecha y hora en UTC, como se guardan en la base: "AAAA-MM-DD HH:MM:SS".
function ahora(int $segundos = 0): string
{
    return gmdate('Y-m-d H:i:s', time() + $segundos);
}

function es_duplicado(Throwable $e): bool
{
    return $e instanceof PDOException && (str_contains($e->getMessage(), 'UNIQUE constraint failed') || str_contains($e->getMessage(), 'Duplicate entry'));
}

// ---------------------------------------------------------------- Tablas

const VERSION_ESQUEMA = 1;

function migrar(PDO $pdo): void
{
    $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    $pdo->exec($mysql
        ? 'CREATE TABLE IF NOT EXISTS meta (clave VARCHAR(40) NOT NULL PRIMARY KEY, valor VARCHAR(255) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
        : 'CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
    $st = $pdo->prepare('SELECT valor FROM meta WHERE clave = ?');
    $st->execute(['version']);
    $actual = (int) ($st->fetchColumn() ?: 0);
    if ($actual >= VERSION_ESQUEMA) return;

    $sentencias = $mysql ? esquema_mysql() : esquema_sqlite();
    // MySQL no deshace un CREATE TABLE con ROLLBACK: por eso todas usan IF NOT EXISTS.
    foreach ($sentencias as $sql) $pdo->exec($sql);
    $pdo->prepare('DELETE FROM meta WHERE clave = ?')->execute(['version']);
    $pdo->prepare('INSERT INTO meta (clave, valor) VALUES (?, ?)')->execute(['version', (string) VERSION_ESQUEMA]);
}

function esquema_sqlite(): array
{
    return [
        "CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            nombre TEXT NOT NULL,
            rol TEXT NOT NULL,
            empresa TEXT NOT NULL DEFAULT '',
            direccion TEXT NOT NULL DEFAULT '',
            password_hash TEXT NOT NULL,
            activo INTEGER NOT NULL DEFAULT 1,
            aprobado INTEGER NOT NULL DEFAULT 1,
            cambiar_password INTEGER NOT NULL DEFAULT 0,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS pedidos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            siniestro TEXT NOT NULL UNIQUE,
            patente TEXT NOT NULL,
            taller_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
            perito_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
            taller TEXT NOT NULL DEFAULT '',
            compania TEXT NOT NULL DEFAULT '',
            vehiculo TEXT NOT NULL DEFAULT '',
            cantidad_piezas INTEGER,
            origen TEXT NOT NULL DEFAULT '',
            despacho TEXT NOT NULL DEFAULT '',
            plazo_entrega TEXT NOT NULL DEFAULT '',
            destino TEXT NOT NULL DEFAULT '',
            destino_direccion TEXT NOT NULL DEFAULT '',
            destino_lat REAL,
            destino_lon REAL,
            destino_lugar TEXT NOT NULL DEFAULT '',
            destino_km REAL,
            destino_minutos INTEGER,
            destino_estado TEXT NOT NULL DEFAULT '',
            destino_calculado TEXT NOT NULL DEFAULT '',
            version INTEGER NOT NULL DEFAULT 1,
            ultimo_evento_avisado INTEGER NOT NULL DEFAULT 0,
            ultimo_aviso_at TEXT,
            ultimo_aviso_para TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL)",
        'CREATE INDEX IF NOT EXISTS idx_pedidos_patente ON pedidos(patente)',
        'CREATE INDEX IF NOT EXISTS idx_pedidos_taller ON pedidos(taller_id)',
        'CREATE INDEX IF NOT EXISTS idx_pedidos_perito ON pedidos(perito_id)',
        "CREATE TABLE IF NOT EXISTS envios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
            remito TEXT NOT NULL DEFAULT '',
            transporte TEXT NOT NULL DEFAULT '',
            guia TEXT NOT NULL DEFAULT '',
            estado_viaje TEXT NOT NULL DEFAULT '',
            entrega TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL)",
        'CREATE INDEX IF NOT EXISTS idx_envios_pedido ON envios(pedido_id)',
        'CREATE TABLE IF NOT EXISTS eventos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
            descripcion TEXT NOT NULL,
            fecha TEXT NOT NULL)',
        'CREATE INDEX IF NOT EXISTS idx_eventos_pedido ON eventos(pedido_id)',
        'CREATE TABLE IF NOT EXISTS recuperaciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            expira INTEGER NOT NULL,
            usado INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS avisos_desactivados (
            usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
            pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (usuario_id, pedido_id))',
        "CREATE TABLE IF NOT EXISTS ubicaciones (
            direccion TEXT PRIMARY KEY,
            lat REAL,
            lon REAL,
            lugar TEXT NOT NULL DEFAULT '',
            encontrada INTEGER NOT NULL,
            created_at TEXT NOT NULL)",
        'CREATE TABLE IF NOT EXISTS limites (clave TEXT PRIMARY KEY, n INTEGER NOT NULL, desde INTEGER NOT NULL)',
        'CREATE TABLE IF NOT EXISTS tareas (nombre TEXT PRIMARY KEY, ultima REAL NOT NULL)',
    ];
}

function esquema_mysql(): array
{
    $t = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    return [
        "CREATE TABLE IF NOT EXISTS usuarios (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(254) NOT NULL UNIQUE,
            nombre VARCHAR(100) NOT NULL,
            rol VARCHAR(10) NOT NULL,
            empresa VARCHAR(120) NOT NULL DEFAULT '',
            direccion VARCHAR(200) NOT NULL DEFAULT '',
            password_hash VARCHAR(255) NOT NULL,
            activo TINYINT NOT NULL DEFAULT 1,
            aprobado TINYINT NOT NULL DEFAULT 1,
            cambiar_password TINYINT NOT NULL DEFAULT 0,
            version INT NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL) $t",
        "CREATE TABLE IF NOT EXISTS pedidos (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            siniestro VARCHAR(40) NOT NULL UNIQUE,
            patente VARCHAR(10) NOT NULL,
            taller_id INT UNSIGNED NULL,
            perito_id INT UNSIGNED NULL,
            taller VARCHAR(120) NOT NULL DEFAULT '',
            compania VARCHAR(100) NOT NULL DEFAULT '',
            vehiculo VARCHAR(100) NOT NULL DEFAULT '',
            cantidad_piezas INT NULL,
            origen VARCHAR(20) NOT NULL DEFAULT '',
            despacho VARCHAR(20) NOT NULL DEFAULT '',
            plazo_entrega VARCHAR(10) NOT NULL DEFAULT '',
            destino VARCHAR(10) NOT NULL DEFAULT '',
            destino_direccion VARCHAR(200) NOT NULL DEFAULT '',
            destino_lat DOUBLE NULL,
            destino_lon DOUBLE NULL,
            destino_lugar VARCHAR(255) NOT NULL DEFAULT '',
            destino_km DOUBLE NULL,
            destino_minutos INT NULL,
            destino_estado VARCHAR(30) NOT NULL DEFAULT '',
            destino_calculado VARCHAR(500) NOT NULL DEFAULT '',
            version INT NOT NULL DEFAULT 1,
            ultimo_evento_avisado INT NOT NULL DEFAULT 0,
            ultimo_aviso_at DATETIME NULL,
            ultimo_aviso_para VARCHAR(600) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            INDEX idx_pedidos_patente (patente),
            FOREIGN KEY (taller_id) REFERENCES usuarios(id) ON DELETE SET NULL,
            FOREIGN KEY (perito_id) REFERENCES usuarios(id) ON DELETE SET NULL) $t",
        "CREATE TABLE IF NOT EXISTS envios (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            pedido_id INT UNSIGNED NOT NULL,
            remito VARCHAR(40) NOT NULL DEFAULT '',
            transporte VARCHAR(20) NOT NULL DEFAULT '',
            guia VARCHAR(40) NOT NULL DEFAULT '',
            estado_viaje VARCHAR(120) NOT NULL DEFAULT '',
            entrega VARCHAR(20) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE) $t",
        "CREATE TABLE IF NOT EXISTS eventos (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            pedido_id INT UNSIGNED NOT NULL,
            descripcion VARCHAR(300) NOT NULL,
            fecha DATETIME NOT NULL,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE) $t",
        "CREATE TABLE IF NOT EXISTS recuperaciones (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT UNSIGNED NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            expira BIGINT NOT NULL,
            usado TINYINT NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE) $t",
        "CREATE TABLE IF NOT EXISTS avisos_desactivados (
            usuario_id INT UNSIGNED NOT NULL,
            pedido_id INT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (usuario_id, pedido_id),
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE) $t",
        "CREATE TABLE IF NOT EXISTS ubicaciones (
            direccion VARCHAR(250) NOT NULL PRIMARY KEY,
            lat DOUBLE NULL,
            lon DOUBLE NULL,
            lugar VARCHAR(255) NOT NULL DEFAULT '',
            encontrada TINYINT NOT NULL,
            created_at DATETIME NOT NULL) $t",
        "CREATE TABLE IF NOT EXISTS limites (clave VARCHAR(80) NOT NULL PRIMARY KEY, n INT NOT NULL, desde BIGINT NOT NULL) $t",
        "CREATE TABLE IF NOT EXISTS tareas (nombre VARCHAR(40) NOT NULL PRIMARY KEY, ultima DOUBLE NOT NULL) $t",
    ];
}
