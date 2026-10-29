<?php
// Rutas de la API: las mismas direcciones y respuestas que la versión Node.js (backend/rutas/*.js).
defined('GENCO') || exit;

// Versión que tenía el formulario al abrirse (para detectar si otra persona guardó en el medio).
function version_de_cuerpo(): ?int
{
    $v = dato('version');
    return $v === null || $v === '' ? null : (int) $v;
}

function limites_api(): array
{
    return [
        // En una oficina varias personas salen por la misma IP y pueden compartir la cuenta: el límite es por
        // IP + email y bastante holgado, para que un par de errores de tipeo no los bloquee a todos.
        'login' => limite('login', 15, 15 * 60, 'Demasiados intentos fallidos con esta cuenta. Probá de nuevo en 15 minutos.'),
        'registro' => limite('registro', 10, 60 * 60, 'Se crearon demasiadas cuentas desde esta conexión. Probá de nuevo más tarde.'),
        'recuperacion' => limite('recuperacion', 10, 15 * 60, 'Demasiadas solicitudes. Probá de nuevo en 15 minutos.'),
        // Evita llenarle la casilla a alguien: como mucho 3 mails de recuperación por hora a la misma cuenta.
        'mails_cuenta' => limite('mails_cuenta', 3, 60 * 60),
        'cambio_password' => limite('cambio_password', 10, 15 * 60, 'Demasiados intentos. Probá de nuevo en 15 minutos.'),
        // Consulta sin cuenta: como mucho 20 consultas sin resultado cada 15 minutos desde la misma conexión.
        'consulta' => limite('consulta', 20, 15 * 60, 'Demasiadas consultas sin resultado. Probá de nuevo en 15 minutos.'),
        // Límite general, holgado para tres personas trabajando a la vez desde la misma oficina.
        'api' => limite('api', 900, 5 * 60, 'Demasiadas solicitudes desde esta conexión. Esperá unos minutos.'),
    ];
}

function rutear(string $metodo, string $ruta): void
{
    $L = limites_api();
    $m = [];
    $es = function (string $met, string $patron) use ($metodo, $ruta, &$m): bool {
        return $metodo === $met && preg_match('#^' . $patron . '$#', $ruta, $m) === 1;
    };

    // ---------------------------------------------------------------- Consulta sin cuenta
    if ($es('POST', '/seguimiento')) {
        limite_controlar($L['consulta'], ip_cliente());
        $siniestro = texto(dato('siniestro'), 40);
        $patente = patente(dato('patente'));
        if ($siniestro === '' || $patente === '') throw new HttpError(400, 'Ingresá el número de siniestro y la patente.');
        $p = pedido_por_siniestro_y_patente($siniestro, $patente);
        if (!$p) {
            limite_sumar($L['consulta'], ip_cliente());
            if (limite_excedido($L['consulta'], ip_cliente())) registrar('consulta_publica_bloqueada', [], 'aviso');
            throw new HttpError(404, 'No encontramos un pedido con ese siniestro y patente. Revisá los datos o consultá con tu taller.');
        }
        responder(pedido_seguimiento($p));
        return;
    }

    // ---------------------------------------------------------------- Ingreso, registro y contraseñas
    if ($es('POST', '/auth/login')) {
        $email = email(dato('email'));
        $password = is_scalar(dato('password')) ? (string) dato('password') : '';
        if ($email === '' || $password === '') throw new HttpError(400, 'Ingresá tu email y contraseña.');
        $clave = ip_cliente() . "|$email";
        if (limite_excedido($L['login'], $clave)) registrar('login_bloqueado', ['email' => $email], 'aviso');
        limite_controlar($L['login'], $clave);
        $u = usuario_por_email($email);
        if (!verificar_password($password, $u['password_hash'] ?? hash_falso()) || !$u) {
            limite_sumar($L['login'], $clave);
            $bloqueado = limite_excedido($L['login'], $clave);
            registrar($bloqueado ? 'cuenta_bloqueada_por_intentos' : 'login_fallido', ['email' => $email, 'existe' => (bool) $u], $bloqueado ? 'alerta' : 'info');
            throw new HttpError(401, 'Email o contraseña incorrectos.');
        }
        if (!$u['aprobado']) throw new HttpError(403, 'Tu cuenta todavía está pendiente de aprobación. Genco la va a habilitar a la brevedad.');
        if (!$u['activo']) {
            registrar('login_cuenta_desactivada', ['email' => $email], 'aviso');
            throw new HttpError(403, 'Tu cuenta está desactivada. Consultá con Genco.');
        }
        limite_limpiar($L['login'], $clave);
        // Contraseñas guardadas con parámetros viejos se actualizan ahora que tenemos la contraseña correcta.
        if (necesita_rehash($u['password_hash'])) $u['password_hash'] = usuario_actualizar_hash((int) $u['id'], $password);
        crear_sesion($u);
        registrar('login', ['email' => $email]);
        responder(usuario_publico($u));
        return;
    }

    // Registro de talleres y peritos: la cuenta queda pendiente hasta que un admin la aprueba.
    if ($es('POST', '/auth/registro')) {
        limite_controlar($L['registro'], ip_cliente());
        $rol = texto(dato('rol'), 20);
        if (!in_array($rol, ['taller', 'perito'], true)) throw new HttpError(400, 'Elegí si sos taller o perito.');
        [$d, $password] = usuario_leer(['rol' => $rol, 'activo' => true] + cuerpo(), true, true);
        $d['rol'] = $rol;
        $u = usuario_crear($d, $password, false);
        limite_sumar($L['registro'], ip_cliente());
        registrar('registro', ['email' => $u['email'], 'rol' => $u['rol']]);
        responder(['nombre' => $u['nombre'], 'email' => $u['email'], 'rol_nombre' => ROLES[$u['rol']]], 201);
        return;
    }

    // Siempre responde lo mismo, exista o no la cuenta, para no revelar quién está registrado.
    if ($es('POST', '/auth/recuperar')) {
        $email = email(dato('email'));
        if (!es_email($email)) throw new HttpError(400, 'Ingresá el email de tu cuenta.');
        limite_controlar($L['recuperacion'], ip_cliente());
        limite_sumar($L['recuperacion'], ip_cliente());
        $u = usuario_por_email($email);
        registrar('recuperacion_pedida', ['email' => $email, 'existe' => (bool) $u]);
        if ($u && $u['activo'] && !limite_excedido($L['mails_cuenta'], (string) $u['id'])) {
            limite_sumar($L['mails_cuenta'], (string) $u['id']);
            // El token va después del "#": el navegador no lo manda al servidor ni queda en los registros.
            $enlace = app_url() . '/login#restablecer=' . recuperacion_crear((int) $u['id']);
            try {
                enviar_mail_recuperacion($u, $enlace);
            } catch (Throwable $e) {
                error_log("No se pudo enviar el mail de recuperación a {$u['email']}: " . $e->getMessage());
                throw new HttpError(502, 'No pudimos enviar el mail en este momento. Probá de nuevo en unos minutos o avisale a Genco.');
            }
        }
        responder(['ok' => true]);
        return;
    }

    if ($es('POST', '/auth/restablecer')) {
        limite_controlar($L['recuperacion'], ip_cliente());
        try {
            $email = recuperacion_usar(dato('token'), is_scalar(dato('password')) ? (string) dato('password') : '');
        } catch (HttpError $e) {
            if (str_contains($e->getMessage(), 'enlace no es válido')) {
                limite_sumar($L['recuperacion'], ip_cliente());
                registrar('enlace_recuperacion_invalido', [], 'aviso');
            }
            throw $e;
        }
        // Por si la cuenta había quedado bloqueada por intentos fallidos desde esta conexión.
        limite_limpiar($L['login'], ip_cliente() . "|$email");
        registrar('password_restablecida', ['email' => $email]);
        responder(['email' => $email]);
        return;
    }

    if ($es('POST', '/auth/logout')) {
        cerrar_sesion();
        responder(['ok' => true]);
        return;
    }

    // /me y el cambio de contraseña funcionan aunque la cuenta tenga que cambiar la contraseña.
    if ($es('GET', '/auth/me')) {
        responder(usuario_publico(requerir_sesion()));
        return;
    }

    // Si la cuenta es compartida, cambiar la contraseña cierra la sesión en las otras computadoras.
    if ($es('POST', '/auth/password')) {
        $u = requerir_sesion();
        $clave = ip_cliente() . '|' . $u['id'];
        limite_controlar($L['cambio_password'], $clave);
        $actual = is_scalar(dato('actual')) ? (string) dato('actual') : '';
        $nueva = is_scalar(dato('nueva')) ? (string) dato('nueva') : '';
        if (!verificar_password($actual, $u['password_hash'])) {
            limite_sumar($L['cambio_password'], $clave);
            registrar('cambio_password_fallido', [], 'aviso');
            throw new HttpError(400, 'La contraseña actual no es correcta.');
        }
        if ($actual === $nueva) throw new HttpError(400, 'La contraseña nueva tiene que ser distinta de la actual.');
        $u['password_hash'] = usuario_cambiar_password((int) $u['id'], $nueva);
        crear_sesion($u);
        registrar('password_cambiada');
        responder(['ok' => true]);
        return;
    }

    // ---------------------------------------------------------------- Mis pedidos (talleres y peritos)
    if (str_starts_with($ruta, '/mis-pedidos')) {
        $yo = requerir_rol('perito', 'taller');
        $propio = function (string $id) use ($yo): array {
            $p = pedido_obtener($id);
            if (!pedido_asignado_a($p, $yo)) throw new HttpError(404, 'Pedido no encontrado');
            return $p;
        };
        // El pedido como lo ve el taller o el perito, con lo que puede hacer en él.
        $detalle = fn (array $p): array => pedido_seguimiento($p) + [
            'avisos_por_mail' => avisos_activos((int) $yo['id'], (int) $p['id']),
            'puede_confirmar' => puede_confirmar_recepcion($p, $yo),
        ];
        // `por_confirmar`: hay un envío en viaje que esta cuenta puede confirmar que le llegó.
        if ($es('GET', '/mis-pedidos')) {
            responder(array_map(function (array $p) use ($yo): array {
                $r = pedido_resumen($p);
                return $r + ['por_confirmar' => $r['en_viaje'] > 0 && puede_confirmar_recepcion($p, $yo)];
            }, pedidos_asignados($yo)));
            return;
        }
        if ($es('GET', '/mis-pedidos/(\d+)')) {
            responder($detalle($propio($m[1])));
            return;
        }
        // "Ya me llegó": el taller o el perito confirma que recibió un envío.
        if ($es('POST', '/mis-pedidos/(\d+)/envios/(\d+)/recibido')) {
            $p = $propio($m[1]);
            pedido_confirmar_recepcion($p, $m[2], $yo);
            responder($detalle(pedido_obtener((int) $p['id'])));
            return;
        }
        // Recibir (o no) por mail las novedades de este pedido. Por defecto, sí.
        if ($es('PUT', '/mis-pedidos/(\d+)/avisos')) {
            $p = $propio($m[1]);
            cambiar_avisos((int) $yo['id'], (int) $p['id'], (bool) dato('activos'));
            responder(['avisos_por_mail' => avisos_activos((int) $yo['id'], (int) $p['id'])]);
            return;
        }
    }

    // ---------------------------------------------------------------- Panel de administración
    if (str_starts_with($ruta, '/admin')) {
        $yo = requerir_rol('admin');

        // Listas para los formularios y cantidad de cuentas por aprobar.
        if ($es('GET', '/admin/opciones')) {
            responder([
                'origenes' => ORIGENES, 'despachos' => DESPACHOS, 'transportes' => TRANSPORTES, 'paginasSeguimiento' => PAGINAS_SEGUIMIENTO,
                'destinos' => DESTINOS_ENVIO, 'entregas' => ENTREGAS, 'roles' => ROLES,
                'talleres' => usuarios_asignables('taller'), 'peritos' => usuarios_asignables('perito'), 'pendientes' => usuarios_pendientes(),
            ]);
            return;
        }

        // Todos los pedidos para la reseña (los filtros se aplican en la pantalla).
        if ($es('GET', '/admin/pedidos')) {
            responder(array_map(fn ($p) => pedido_resumen($p) + ['ubicacion' => info_destino($p)], pedidos_listar()));
            return;
        }
        if ($es('GET', '/admin/pedidos/(\d+)')) {
            $p = pedido_obtener($m[1]);
            $ubicacion = info_destino($p);
            if (destino_pendiente($p)) despues(fn () => calcular_destino((int) $p['id']));
            responder($p + ['envios' => pedido_envios((int) $p['id']), 'seguimiento' => pedido_seguimiento($p), 'avisos' => estado_avisos($p), 'ubicacion' => $ubicacion]);
            return;
        }
        // "Enviar aviso ahora" por mail, sin esperar.
        if ($es('POST', '/admin/pedidos/(\d+)/avisar')) {
            responder(avisar_ahora($m[1]));
            return;
        }
        if ($es('POST', '/admin/pedidos')) {
            $p = pedido_crear(pedido_leer(cuerpo()));
            despues(fn () => calcular_destino((int) $p['id']));
            responder($p, 201);
            return;
        }
        if ($es('PUT', '/admin/pedidos/(\d+)')) {
            $p = pedido_actualizar($m[1], pedido_leer(cuerpo()), version_de_cuerpo());
            despues(fn () => calcular_destino((int) $p['id']));
            responder($p);
            return;
        }
        if ($es('DELETE', '/admin/pedidos/(\d+)')) {
            $siniestro = pedido_obtener($m[1])['siniestro'];
            pedido_eliminar($m[1]);
            registrar('pedido_eliminado', ['siniestro' => $siniestro], 'aviso');
            responder(['ok' => true]);
            return;
        }

        if ($es('GET', '/admin/usuarios')) {
            responder(usuarios_listar());
            return;
        }
        if ($es('GET', '/admin/usuarios/(\d+)')) {
            responder(usuario_obtener($m[1]));
            return;
        }
        if ($es('POST', '/admin/usuarios')) {
            [$d, $password] = usuario_leer(cuerpo(), true);
            // La contraseña la eligió el admin: la persona la tiene que cambiar al ingresar por primera vez.
            $u = usuario_crear($d, $password, true, true);
            registrar('usuario_creado', ['cuenta' => $u['email'], 'rol' => $u['rol']]);
            responder($u, 201);
            return;
        }
        if ($es('PUT', '/admin/usuarios/(\d+)')) {
            [$d, $password] = usuario_leer(cuerpo());
            [$u, $nuevoHash] = usuario_actualizar($m[1], $d, $password, version_de_cuerpo(), $yo);
            // Si cambió la contraseña de su propia cuenta, la sesión de quien edita sigue abierta.
            if ($nuevoHash && (int) $u['id'] === (int) $yo['id']) crear_sesion(['id' => $u['id'], 'password_hash' => $nuevoHash]);
            registrar('usuario_modificado', ['cuenta' => $u['email'], 'rol' => $u['rol'], 'activo' => $u['activo'], 'password_cambiada' => (bool) $nuevoHash],
                $nuevoHash ? 'aviso' : 'info');
            // Si cambió su dirección, sus pedidos se vuelven a ubicar en el mapa.
            despues(fn () => recalcular_destinos());
            responder($u);
            return;
        }
        if ($es('POST', '/admin/usuarios/(\d+)/aprobar')) {
            $u = usuario_aprobar($m[1]);
            registrar('usuario_aprobado', ['cuenta' => $u['email'], 'rol' => $u['rol']]);
            responder($u);
            return;
        }
        if ($es('DELETE', '/admin/usuarios/(\d+)')) {
            $email = usuario_obtener($m[1])['email'];
            usuario_eliminar($m[1], $yo);
            registrar('usuario_eliminado', ['cuenta' => $email], 'aviso');
            responder(['ok' => true]);
            return;
        }
    }

    throw new HttpError(404, 'No encontrado');
}

function enviar_mail_recuperacion(array $u, string $enlace): void
{
    $minutos = VIGENCIA_RECUPERACION_MINUTOS;
    enviar_mail($u['email'], 'Recuperar tu contraseña — Grupo Genco Siniestros',
        "Hola {$u['nombre']}:\n\nPediste crear una nueva contraseña para tu cuenta {$u['email']}.\n"
        . "Entrá a este enlace (vence en $minutos minutos):\n\n$enlace\n\nSi no fuiste vos, ignorá este mensaje: tu contraseña no cambia.\n\n" . nota_spam() . "\n\nGrupo Genco · Siniestros",
        plantilla_mail('Recuperar tu contraseña',
            ['Hola ' . esc($u['nombre']) . ':', 'Pediste crear una nueva contraseña para tu cuenta <strong>' . esc($u['email']) . '</strong>.'],
            '', ['url' => $enlace, 'texto' => 'Crear nueva contraseña'],
            "El enlace vence en $minutos minutos y sirve una sola vez. Si no fuiste vos, ignorá este mensaje: tu contraseña no cambia."));
}

// Atiende un pedido a la API: seguridad, ruta, errores y, después de contestar, las tareas pendientes.
function atender_api(): void
{
    ob_start();
    try {
        cabeceras_seguridad();
        if (!instalado()) throw new HttpError(503, 'La página todavía no está instalada.');
        $L = limites_api();
        limite_controlar($L['api'], ip_cliente());
        limite_sumar($L['api'], ip_cliente());
        if (limite_excedido($L['api'], ip_cliente())) registrar('limite_general_alcanzado', ['ruta' => '/api' . ruta_api()], 'aviso');
        solo_mismo_sitio();
        rutear(metodo(), ruta_api());
    } catch (HttpError $e) {
        responder(array_filter(['error' => $e->getMessage(), 'codigo' => $e->codigo], fn ($v) => $v !== null), $e->status);
    } catch (Throwable $e) {
        if (es_duplicado($e)) {
            responder(['error' => 'Ya existe un registro con esos datos. Recargá la página para verlo.'], 409);
        } else {
            // Al usuario nunca le llegan detalles internos (OWASP A10): quedan en el registro del servidor.
            error_log('Error en la API: ' . $e->getMessage() . ' en ' . $e->getFile() . ':' . $e->getLine());
            try {
                registrar('error_interno', ['ruta' => '/api' . ruta_api(), 'metodo' => metodo(), 'mensaje' => mb_substr($e->getMessage(), 0, 300)], 'aviso');
            } catch (Throwable) {
            }
            responder(['error' => 'Error interno del servidor'], 500);
        }
    }
    enviar_respuesta();
    if (!instalado()) return;
    ignore_user_abort(true);
    @set_time_limit(60);
    foreach ($GLOBALS['despues'] as $fn) {
        try {
            $fn();
        } catch (Throwable $e) {
            error_log('Tarea posterior: ' . $e->getMessage());
        }
    }
    try {
        tareas_ejecutar();
    } catch (Throwable $e) {
        error_log('Tareas: ' . $e->getMessage());
    }
}
