<?php
// Cuentas de administradores, talleres y peritos. Se ingresa con el email.
defined('GENCO') || exit;

const ROLES = ['admin' => 'Administrador', 'perito' => 'Perito', 'taller' => 'Taller'];
const PAGINA_DE_ROL = ['admin' => '/admin', 'perito' => '/mis-pedidos', 'taller' => '/mis-pedidos'];

const SELECT_USUARIOS = 'SELECT u.id, u.email, u.nombre, u.empresa, u.direccion, u.rol, u.activo, u.aprobado, u.version, u.created_at,
    (SELECT COUNT(*) FROM pedidos p WHERE p.taller_id = u.id OR p.perito_id = u.id) AS pedidos
  FROM usuarios u';

function usuario_obtener(mixed $id): array
{
    $u = fila(SELECT_USUARIOS . ' WHERE u.id = ?', [(int) $id]);
    if (!$u) throw new HttpError(404, 'Usuario no encontrado. Puede que otra persona lo haya eliminado.');
    return $u;
}

function usuarios_listar(): array
{
    return filas(SELECT_USUARIOS . ' ORDER BY u.activo DESC, u.rol, LOWER(u.nombre)');
}

// Incluye el hash de la contraseña: solo para uso interno (login, recuperación).
function usuario_por_email(string $email): ?array
{
    return fila('SELECT * FROM usuarios WHERE email = ?', [email($email)]);
}

function usuarios_pendientes(): int
{
    return (int) valor('SELECT COUNT(*) FROM usuarios WHERE aprobado = 0');
}

// Talleres y peritos aprobados, para asignarlos a los pedidos.
function usuarios_asignables(string $rol): array
{
    $orden = $rol === 'taller' ? "LOWER(COALESCE(NULLIF(empresa, ''), nombre))" : 'LOWER(nombre)';
    return filas("SELECT id, email, nombre, empresa, direccion, activo FROM usuarios WHERE rol = ? AND aprobado = 1 ORDER BY $orden", [$rol]);
}

// Lo que ve el propio usuario de su cuenta.
function usuario_publico(array $u): array
{
    return [
        'id' => (int) $u['id'], 'email' => $u['email'], 'nombre' => $u['nombre'], 'empresa' => $u['empresa'], 'rol' => $u['rol'],
        'rol_nombre' => ROLES[$u['rol']] ?? '', 'destino' => PAGINA_DE_ROL[$u['rol']] ?? '/', 'cambiar_password' => (bool) ($u['cambiar_password'] ?? false),
    ];
}

// Valida los datos de un formulario de usuario. Solo los talleres llevan "empresa" (el nombre del taller).
//   nuevo: la contraseña es obligatoria. registro: se registra desde la página (el nombre del taller es obligatorio).
function usuario_leer(array $b, bool $nuevo = false, bool $registro = false): array
{
    $activo = $b['activo'] ?? true;
    $d = [
        'email' => email($b['email'] ?? ''),
        'nombre' => texto($b['nombre'] ?? '', 100),
        'rol' => texto($b['rol'] ?? '', 20),
        'empresa' => texto($b['empresa'] ?? '', 120),
        // Talleres y peritos: dirección donde se les entregan los pedidos (para el mapa y la distancia).
        'direccion' => texto($b['direccion'] ?? '', 200),
        'activo' => $activo ? 1 : 0,
    ];
    if (!isset(ROLES[$d['rol']])) throw new HttpError(400, 'Rol inválido');
    if ($d['rol'] !== 'taller') $d['empresa'] = '';
    if ($d['rol'] === 'admin') $d['direccion'] = '';
    if ($d['nombre'] === '') throw new HttpError(400, 'Ingresá el nombre y apellido.');
    if ($registro && $d['rol'] === 'taller' && $d['empresa'] === '') throw new HttpError(400, 'Ingresá el nombre del taller.');
    if ($d['email'] === '') throw new HttpError(400, 'Ingresá el email.');
    if (!es_email($d['email'])) throw new HttpError(400, 'El email no parece válido.');
    $password = is_scalar($b['password'] ?? null) ? (string) $b['password'] : '';
    if ($nuevo || $password !== '') validar_password($password, $d['email']);
    return [$d, $password];
}

function validar_email_libre(string $email, ?int $idActual = null): void
{
    $otro = fila('SELECT id FROM usuarios WHERE email = ?', [$email]);
    if ($otro && (int) $otro['id'] !== $idActual) throw new HttpError(409, 'Ya existe una cuenta con ese email.', 'email');
}

function admins_activos(): int
{
    return (int) valor("SELECT COUNT(*) FROM usuarios WHERE rol = 'admin' AND activo = 1");
}

// cambiarPassword: la cuenta la crea un admin, que conoce la contraseña; la persona la cambia al ingresar.
function usuario_crear(array $d, string $password, bool $aprobado = true, bool $cambiarPassword = false): array
{
    validar_email_libre($d['email']);
    ejecutar('INSERT INTO usuarios (email, nombre, empresa, direccion, rol, activo, aprobado, password_hash, cambiar_password, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$d['email'], $d['nombre'], $d['empresa'], $d['direccion'] ?? '', $d['rol'], $d['activo'], $aprobado ? 1 : 0,
            hash_password($password), $cambiarPassword ? 1 : 0, ahora()]);
    return usuario_obtener(ultimo_id());
}

// $version es la que tenía el formulario al abrirse: si cambió, otra persona guardó en el medio.
// Devuelve [usuario, nuevoHash] (el hash si se cambió la contraseña, para renovar la sesión de quien edita).
function usuario_actualizar(mixed $id, array $d, string $password, ?int $version, array $editor): array
{
    $antes = usuario_obtener($id);
    $antesId = (int) $antes['id'];
    validar_email_libre($d['email'], $antesId);
    $mismo = (int) $editor['id'] === $antesId;
    if ($mismo && ($d['rol'] !== 'admin' || !$d['activo'])) throw new HttpError(400, 'No podés quitarte el rol de administrador ni desactivarte.');
    if ($antes['rol'] !== $d['rol'] && (int) $antes['pedidos'] > 0) {
        throw new HttpError(400, "No se puede cambiar el rol: tiene {$antes['pedidos']} pedido(s) asignado(s).");
    }
    if ($antes['rol'] === 'admin' && $antes['activo'] && ($d['rol'] !== 'admin' || !$d['activo']) && admins_activos() <= 1) {
        throw new HttpError(400, 'Tiene que quedar al menos un administrador activo.');
    }
    $nuevoHash = null;
    transaccion(function () use ($d, $password, $version, $antes, $antesId, $mismo, &$nuevoHash) {
        $cambios = ejecutar('UPDATE usuarios SET email = ?, nombre = ?, empresa = ?, direccion = ?, rol = ?, activo = ?, version = version + 1
                             WHERE id = ? AND version = ?',
            [$d['email'], $d['nombre'], $d['empresa'], $d['direccion'] ?? '', $d['rol'], $d['activo'], $antesId, $version ?? (int) $antes['version']]);
        if (!$cambios) throw conflicto('este usuario');
        // Los pedidos que van a esta cuenta y usaban su dirección anterior (o no tenían) pasan a la nueva.
        if (in_array($d['rol'], ['taller', 'perito'], true) && $d['rol'] === $antes['rol'] && $d['direccion'] !== $antes['direccion']) {
            $col = $d['rol'] === 'taller' ? 'taller_id' : 'perito_id';
            ejecutar("UPDATE pedidos SET destino_direccion = ? WHERE destino = ? AND $col = ? AND (destino_direccion = ? OR destino_direccion = '')",
                [$d['direccion'], $d['rol'], $antesId, $antes['direccion']]);
        }
        if ($password !== '') {
            // Si un admin le pone la contraseña a otra persona, esa persona la tiene que cambiar al ingresar.
            $nuevoHash = hash_password($password);
            ejecutar('UPDATE usuarios SET password_hash = ?, cambiar_password = ? WHERE id = ?', [$nuevoHash, $mismo ? 0 : 1, $antesId]);
        }
    });
    return [usuario_obtener($antesId), $nuevoHash];
}

// La persona cambia su propia contraseña (desde su menú o con el enlace de recuperación).
function usuario_cambiar_password(int $id, string $password): string
{
    $email = (string) (valor('SELECT email FROM usuarios WHERE id = ?', [$id]) ?? '');
    validar_password($password, $email);
    $hash = hash_password($password);
    ejecutar('UPDATE usuarios SET password_hash = ?, cambiar_password = 0, version = version + 1 WHERE id = ?', [$hash, $id]);
    return $hash;
}

// Actualiza el hash de una contraseña a los parámetros actuales (al ingresar, con la contraseña correcta).
function usuario_actualizar_hash(int $id, string $password): string
{
    $hash = hash_password($password);
    ejecutar('UPDATE usuarios SET password_hash = ? WHERE id = ?', [$hash, $id]);
    return $hash;
}

function usuario_aprobar(mixed $id): array
{
    $u = usuario_obtener($id);
    ejecutar('UPDATE usuarios SET aprobado = 1, version = version + 1 WHERE id = ?', [(int) $u['id']]);
    return usuario_obtener((int) $u['id']);
}

function usuario_eliminar(mixed $id, array $editor): void
{
    $u = usuario_obtener($id);
    if ((int) $u['id'] === (int) $editor['id']) throw new HttpError(400, 'No podés eliminar tu propia cuenta.');
    if ($u['rol'] === 'admin' && $u['activo'] && admins_activos() <= 1) throw new HttpError(400, 'Tiene que quedar al menos un administrador activo.');
    ejecutar('DELETE FROM usuarios WHERE id = ?', [(int) $u['id']]);
}
