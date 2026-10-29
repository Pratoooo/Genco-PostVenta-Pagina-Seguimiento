<?php
// Contraseñas y sesiones (OWASP A04 fallas criptográficas, A07 autenticación).
//
// Cada navegador tiene su propia sesión (una cookie firmada), así que varias personas pueden usar la misma
// cuenta al mismo tiempo desde distintas computadoras. El hash de la contraseña entra en la firma: si alguien
// cambia la contraseña de la cuenta, se cierran todas sus sesiones abiertas.
defined('GENCO') || exit;

const DURACION_SESION = 12 * 60 * 60;
const LARGO_MINIMO_PASSWORD = 8;
const LARGO_MAXIMO_PASSWORD = 128;

// Contraseñas demasiado comunes (las primeras que se prueban en un ataque).
const PASSWORDS_COMUNES = [
    '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344',
    'password', 'password1', 'contraseña', 'contrasena', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'abcd1234',
    'abc12345', 'iloveyou', 'admin123', 'administrador', 'genco-admin', 'genco123', 'genco1234', 'bienvenido',
    'argentina', 'cambiar-esta-clave', 'siniestro', 'siniestros',
];

// ---------------------------------------------------------------- Contraseñas

// Argon2id si el hosting lo tiene; si no, bcrypt. Los hashes viejos se actualizan solos al ingresar.
function algoritmo_password(): string|int|null
{
    return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
}

function hash_password(string $password): string
{
    return password_hash($password, algoritmo_password());
}

function verificar_password(string $password, string $guardado): bool
{
    // Limita el largo para que nadie pueda trabar el servidor con contraseñas enormes.
    if (mb_strlen($password) > LARGO_MAXIMO_PASSWORD) return false;
    return password_verify($password, $guardado);
}

function necesita_rehash(string $guardado): bool
{
    return password_needs_rehash($guardado, algoritmo_password());
}

// Se usa cuando la cuenta no existe, para que la respuesta tarde lo mismo.
function hash_falso(): string
{
    static $h = null;
    return $h ??= hash_password(bin2hex(random_bytes(8)));
}

function validar_password(mixed $password, string $email = ''): void
{
    $pw = is_scalar($password) ? (string) $password : '';
    $largo = mb_strlen($pw);
    if ($largo < LARGO_MINIMO_PASSWORD) throw new HttpError(400, 'La contraseña debe tener al menos ' . LARGO_MINIMO_PASSWORD . ' caracteres.');
    if ($largo > LARGO_MAXIMO_PASSWORD) throw new HttpError(400, 'La contraseña no puede tener más de ' . LARGO_MAXIMO_PASSWORD . ' caracteres.');
    $minuscula = mb_strtolower($pw);
    if (in_array($minuscula, PASSWORDS_COMUNES, true) || preg_match('/^(.)\1+$/u', $pw)) {
        throw new HttpError(400, 'Esa contraseña es demasiado común. Elegí otra más difícil de adivinar.');
    }
    $usuario = mb_strtolower(explode('@', $email)[0]);
    if ($email !== '' && mb_strlen($usuario) >= 4 && str_contains($minuscula, $usuario)) {
        throw new HttpError(400, 'La contraseña no puede contener tu email.');
    }
}

// ---------------------------------------------------------------- Sesiones

// Con HTTPS la cookie lleva el prefijo __Host- (solo por conexión segura, sin dominio, ruta "/").
function nombre_cookie(): string
{
    return sitio_https() ? '__Host-genco_sesion' : 'genco_sesion';
}

function firmar_sesion(int $uid, string $exp, string $passwordHash): string
{
    return hash_hmac('sha256', "$uid.$exp.$passwordHash", (string) config('secreto'));
}

function poner_cookie(string $valor, int $expira): void
{
    setcookie(nombre_cookie(), $valor, [
        'expires' => $expira,
        'path' => '/',
        'secure' => sitio_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function crear_sesion(array $usuario): void
{
    $exp = (string) ((time() + DURACION_SESION) * 1000);
    poner_cookie("{$usuario['id']}.$exp." . firmar_sesion((int) $usuario['id'], $exp, $usuario['password_hash']), time() + DURACION_SESION);
}

function cerrar_sesion(): void
{
    poner_cookie('', time() - 3600);
}

function usuario_de_request(): ?array
{
    $partes = explode('.', (string) ($_COOKIE[nombre_cookie()] ?? ''));
    if (count($partes) !== 3) return null;
    [$uid, $exp, $mac] = $partes;
    if (!ctype_digit($uid) || !ctype_digit($exp) || $mac === '' || (int) $exp <= time() * 1000) return null;
    $u = fila('SELECT * FROM usuarios WHERE id = ? AND activo = 1 AND aprobado = 1', [(int) $uid]);
    if (!$u) return null;
    return hash_equals(firmar_sesion((int) $u['id'], $exp, $u['password_hash']), $mac) ? $u : null;
}

// Exige sesión (aunque la cuenta tenga que cambiar la contraseña). Solo para /me y el cambio de contraseña.
function requerir_sesion(): array
{
    $u = usuario_de_request();
    if (!$u) throw new HttpError(401, 'Iniciá sesión para continuar.');
    return $GLOBALS['usuario_actual'] = $u;
}

// Exige sesión, que la contraseña no esté pendiente de cambio y, si se indican, alguno de los roles.
function requerir_rol(string ...$roles): array
{
    $u = requerir_sesion();
    if ($u['cambiar_password']) throw new HttpError(403, 'Antes de seguir tenés que cambiar la contraseña.', 'cambiar_password');
    if ($roles && !in_array($u['rol'], $roles, true)) {
        registrar('acceso_denegado', ['ruta' => '/api' . ruta_api(), 'rol' => $u['rol']], 'aviso');
        throw new HttpError(403, 'No tenés permiso para acceder.');
    }
    return $u;
}
