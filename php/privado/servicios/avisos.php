<?php
// Avisos por mail de los cambios de estado de un pedido.
//
// Cada cambio que ve el cliente queda en el historial del pedido (tabla eventos). Se manda UN mail por
// destinatario con todas las novedades juntas: sale 1 minuto después del último cambio (así varios guardados
// seguidos van en un solo mail) y, si se siguen haciendo cambios, a los 5 minutos de la primera novedad como
// máximo. Desde la ficha del pedido también se puede mandar en el momento ("Enviar aviso ahora").
//
// Destinatarios: el taller y el perito asignados, al email de su cuenta. Cada uno puede desactivar los avisos
// de un pedido desde "Mis pedidos" (por defecto están activos).
defined('GENCO') || exit;

const ESPERA_AVISO_SEGUNDOS = 60;
const ESPERA_AVISO_MAXIMA_MINUTOS = 5;
const AZUL = '#253883';
const VERDE = '#138a52';
const GRIS = '#5d6680';

// Fecha de la base (UTC) -> hora de Argentina: "6/10/26, 14:05".
function fecha_local(string $s): string
{
    $d = new DateTime($s, new DateTimeZone('UTC'));
    $d->setTimezone(new DateTimeZone('America/Argentina/Buenos_Aires'));
    return $d->format('j/n/y, H:i');
}

// ---------------------------------------------------------------- Destinatarios

// No se manda a emails provisorios ("@genco.local") ni a dominios reservados para pruebas (example.com,
// .test...): no existen, y Gmail devolvería un rebote por cada uno.
function email_real(string $email): bool
{
    $dominio = explode('@', $email)[1] ?? '';
    return $dominio !== '' && !preg_match('/(^|\.)(example\.(com|net|org)|test|invalid|local|localhost)$/i', $dominio);
}

// ¿Recibe esta cuenta los avisos de este pedido? (Sí, salvo que los haya desactivado.)
function avisos_activos(int $usuarioId, int $pedidoId): bool
{
    return !fila('SELECT 1 FROM avisos_desactivados WHERE usuario_id = ? AND pedido_id = ?', [$usuarioId, $pedidoId]);
}

function cambiar_avisos(int $usuarioId, int $pedidoId, bool $activos): void
{
    if ($activos) {
        ejecutar('DELETE FROM avisos_desactivados WHERE usuario_id = ? AND pedido_id = ?', [$usuarioId, $pedidoId]);
    } elseif (avisos_activos($usuarioId, $pedidoId)) {
        ejecutar('INSERT INTO avisos_desactivados (usuario_id, pedido_id, created_at) VALUES (?, ?, ?)', [$usuarioId, $pedidoId, ahora()]);
    }
}

function destinatarios(array $p): array
{
    $lista = [];
    foreach ([$p['taller_id'], $p['perito_id']] as $id) {
        if (!$id) continue;
        $u = fila('SELECT id, nombre, email, rol, activo, aprobado FROM usuarios WHERE id = ?', [(int) $id]);
        if ($u && $u['activo'] && $u['aprobado'] && email_real($u['email']) && avisos_activos((int) $u['id'], (int) $p['id'])
            && !in_array($u['email'], array_column($lista, 'email'), true)) {
            // 'confirma': es quien recibe el paquete, así que el mail le recuerda confirmar que le llegó.
            $lista[] = ['email' => $u['email'], 'nombre' => $u['nombre'], 'confirma' => puede_confirmar_recepcion($p, $u)];
        }
    }
    return $lista;
}

// ---------------------------------------------------------------- Contenido del mail

function puntos_de_avance(array $s): string
{
    $celdas = '';
    $n = count($s['etapas']);
    foreach ($s['etapas'] as $i => $e) {
        $hecha = $i < $s['etapa_actual'];
        $actual = $i === $s['etapa_actual'];
        $final = $i === $n - 1;
        $color = $final ? VERDE : AZUL;
        $circulo = $hecha ? "background:$color;color:#ffffff;border:2px solid $color"
            : ($actual ? 'background:#ffffff;color:#2f4fb4;border:2px solid #2f4fb4' : 'background:#eef0f4;color:#8a93a8;border:2px solid #eef0f4');
        $tituloColor = $hecha || $actual ? '#121a33' : '#8a93a8';
        $marca = $hecha ? '&#10003;' : (string) ($i + 1);
        $detalle = $e['detalle'] !== '' ? '<div style="font-size:11px;color:' . GRIS . ';margin-top:2px">' . esc($e['detalle']) . '</div>' : '';
        $celdas .= "<td align=\"center\" valign=\"top\" width=\"25%\" style=\"padding:0 4px\">
      <div style=\"width:34px;height:34px;line-height:34px;border-radius:17px;margin:0 auto 8px;font-weight:bold;font-size:15px;$circulo\">$marca</div>
      <div style=\"font-size:12px;font-weight:bold;color:$tituloColor\">" . esc($e['titulo']) . "</div>$detalle</td>";
    }
    return "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0 8px\"><tr>$celdas</tr></table>";
}

function lista_novedades(array $novedades): string
{
    $filas = '';
    foreach ($novedades as $n) {
        $filas .= '<tr><td style="padding:7px 0;border-top:1px solid #e2e7f1;font-size:12px;color:' . GRIS . ';white-space:nowrap;vertical-align:top">'
            . esc(fecha_local($n['fecha'])) . '</td><td style="padding:7px 0 7px 14px;border-top:1px solid #e2e7f1;font-size:14px">'
            . esc($n['descripcion']) . '</td></tr>';
    }
    return "<h2 style=\"font-size:15px;margin:24px 0 6px\">Novedades</h2><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">$filas</table>";
}

function lista_envios(array $s): string
{
    if (!$s['envios']) return '';
    $numerar = count($s['envios']) > 1 || $s['despacho_parcial'];
    $filas = '';
    foreach ($s['envios'] as $i => $e) {
        $datos = implode(' · ', array_filter([$e['remito'] !== '' ? "Remito {$e['remito']}" : '', $e['transporte'], $e['guia'] !== '' ? "Guía {$e['guia']}" : '']));
        $color = $e['recibido'] ? VERDE : AZUL;
        $fondo = $e['recibido'] ? '#e2f5ec' : '#eaf0ff';
        $titulo = $numerar ? 'Envío ' . ($i + 1) : 'Envío';
        $viaje = $e['estado_viaje'] !== '' && !$e['recibido']
            ? '<br><span style="font-size:13px;color:' . AZUL . ';font-weight:bold">' . esc($e['estado_viaje']) . '</span>' : '';
        $seguir = $e['seguimiento_url'] !== '' && !$e['recibido']
            ? '<br><a href="' . esc($e['seguimiento_url']) . '" style="display:inline-block;margin-top:6px;font-size:13px;color:' . AZUL . ';font-weight:bold">Seguir el envío en '
              . esc($e['transporte']) . ' →</a> <span style="font-size:12px;color:' . GRIS . '">(pegá la guía ' . esc($e['guia']) . ' en su buscador)</span>' : '';
        $filas .= '<tr><td style="padding:12px 14px;background:#f5f7fc;border-radius:10px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:14px"><strong>' . $titulo . '</strong><br><span style="font-size:13px;color:' . GRIS . '">' . esc($datos) . "</span>$viaje$seguir</td>
          <td align=\"right\" style=\"white-space:nowrap\"><span style=\"display:inline-block;padding:4px 10px;border-radius:99px;background:$fondo;color:$color;font-size:12px;font-weight:bold\">" . esc($e['estado']) . '</span></td>
        </tr></table></td></tr><tr><td style="height:8px"></td></tr>';
    }
    $parcial = $s['despacho_parcial']
        ? '<p style="margin:4px 0 0;padding:10px 14px;border-radius:10px;background:#fff4e0;color:#8a4b00;font-size:13px">Se envió una parte del pedido. Lo que falta sale en otro envío, con su propio remito y número de guía.</p>' : '';
    return '<h2 style="font-size:15px;margin:24px 0 8px">' . (count($s['envios']) > 1 ? 'Envíos' : 'Envío') . "</h2>
    <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">$filas</table>$parcial";
}

function datos_pedido_mail(array $p, bool $recibido): string
{
    $plazo = $p['plazo_entrega'] !== '' && !$recibido ? fecha_argentina($p['plazo_entrega']) : '';
    $celdas = '';
    foreach ([['Patente', $p['patente']], ['Vehículo', $p['vehiculo']], ['Taller', $p['taller']], ['Compañía', $p['compania']], ['Entrega estimada', $plazo]] as [$k, $v]) {
        if ($v === '' || $v === null) continue;
        $celdas .= '<td valign="top" style="padding:8px 10px 8px 0"><div style="font-size:11px;color:' . GRIS . ';text-transform:uppercase;letter-spacing:.5px">'
            . $k . '</div><div style="font-size:14px;font-weight:bold">' . esc($v) . '</div></td>';
    }
    return "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin-top:6px\"><tr>$celdas</tr></table>";
}

// Envíos que ya salieron y todavía falta confirmar que llegaron.
function envios_en_viaje(array $s): int
{
    return count(array_filter($s['envios'], fn ($e) => !$e['recibido'] && $e['estado'] !== 'Preparando envío'));
}

// "¿Ya te llegó?": para quien recibe el paquete, un botón que lo lleva al pedido a tocar "Ya me llegó".
function bloque_confirmar(string $enlace, int $cuantos): string
{
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr>
    <td style="padding:18px 20px;border:2px solid ' . VERDE . ';border-radius:12px;background:#e2f5ec">
      <div style="font-size:17px;font-weight:bold;color:' . VERDE . '">¿Ya te llegó?</div>
      <div style="font-size:14px;margin:6px 0 14px">Cuando recibas ' . ($cuantos > 1 ? 'cada paquete' : 'el paquete') . ', confirmalo en el pedido con el botón
        «Ya me llegó». Así Genco sabe que está entregado y no tiene que preguntarte.</div>
      <a href="' . esc($enlace) . '" style="display:inline-block;padding:12px 22px;background:' . VERDE . ';color:#ffffff;border-radius:10px;text-decoration:none;font-weight:bold">Confirmar que me llegó</a>
    </td></tr></table>';
}

// Arma el mail de novedades para un destinatario: ['para', 'asunto', 'texto', 'html'].
function armar_mail_aviso(array $s, array $novedades, array $destinatario): array
{
    $p = $s['pedido'];
    $recibido = $s['recibido'];
    $enlace = app_url() . "/mis-pedidos#/pedido/{$p['id']}";
    $porConfirmar = !empty($destinatario['confirma']) ? envios_en_viaje($s) : 0;
    $saludo = $destinatario['nombre'] ? 'Hola ' . esc($destinatario['nombre']) . ':' : 'Hola:';
    $estado = '<span style="display:inline-block;padding:6px 14px;border-radius:99px;background:' . ($recibido ? '#e2f5ec' : '#eaf0ff') . ';color:'
        . ($recibido ? VERDE : AZUL) . ';font-weight:bold;font-size:14px">' . esc($s['estado']) . '</span>';

    $texto = [strip_tags($saludo), '', "Hay novedades en el pedido del siniestro {$p['siniestro']}" . ($p['patente'] ? " (patente {$p['patente']})" : '') . '.',
        "Estado actual: {$s['estado']}"];
    if ($p['plazo_entrega'] !== '' && !$recibido) $texto[] = 'Entrega estimada: ' . fecha_argentina($p['plazo_entrega']);
    if ($porConfirmar) array_push($texto, '', '¿Ya te llegó? Cuando recibas el paquete, confirmalo en el pedido con el botón "Ya me llegó":', $enlace);
    $texto[] = '';
    $texto[] = 'Novedades:';
    foreach ($novedades as $n) $texto[] = '  ' . fecha_local($n['fecha']) . '  ' . $n['descripcion'];
    if ($s['envios']) {
        $texto[] = '';
        $texto[] = 'Envíos:';
        foreach ($s['envios'] as $i => $e) {
            $texto[] = '  Envío ' . ($i + 1) . ': ' . implode(' · ', array_filter([$e['remito'] !== '' ? "remito {$e['remito']}" : '', $e['transporte'], $e['guia'] !== '' ? "guía {$e['guia']}" : '', $e['estado']]));
            if ($e['seguimiento_url'] !== '' && !$e['recibido']) $texto[] = "    Seguilo en {$e['seguimiento_url']} (pegá la guía en su buscador)";
        }
    }
    array_push($texto, '', "Ver el pedido: $enlace", '', nota_spam(), '', 'Grupo Genco · Siniestros. Este es un aviso automático, no hace falta responderlo.');

    return [
        'para' => $destinatario['email'],
        'asunto' => "Siniestro {$p['siniestro']}: {$s['estado']} — Grupo Genco",
        'texto' => implode("\n", $texto),
        'html' => plantilla_mail(
            'Novedades de tu pedido · Siniestro ' . esc($p['siniestro']),
            [$saludo, "Hay novedades en el pedido de repuestos. Estado actual: $estado"],
            ($porConfirmar ? bloque_confirmar($enlace, $porConfirmar) : '')
            . datos_pedido_mail($p, $recibido) . puntos_de_avance($s) . lista_novedades($novedades) . lista_envios($s),
            ['url' => $enlace, 'texto' => 'Ver el pedido'],
            'Te llega porque este pedido está asignado a tu cuenta. Si no querés recibir más avisos de este pedido, '
            . 'desmarcá la opción en el pedido, en "Mis pedidos". Este es un aviso automático, no hace falta responderlo.'
        ),
    ];
}

// ---------------------------------------------------------------- Envío

// Manda el aviso de las novedades del pedido hasta el evento $hasta. Devuelve a quiénes se mandó.
function avisar_pedido(int $pedidoId, int $hasta): array
{
    $p = pedido_obtener($pedidoId);
    $lista = destinatarios($p);
    $novedades = filas('SELECT descripcion, fecha FROM eventos WHERE pedido_id = ? AND id > ? AND id <= ? ORDER BY id',
        [$pedidoId, (int) $p['ultimo_evento_avisado'], $hasta]);
    if (!$lista || !$novedades) {
        ejecutar('UPDATE pedidos SET ultimo_evento_avisado = ? WHERE id = ?', [$hasta, $pedidoId]);
        return [];
    }
    $s = pedido_seguimiento($p);
    $enviados = [];
    foreach ($lista as $dest) {
        try {
            $m = armar_mail_aviso($s, $novedades, $dest);
            enviar_mail($m['para'], $m['asunto'], $m['texto'], $m['html']);
            $enviados[] = $dest['email'];
        } catch (Throwable $e) {
            error_log("No se pudo enviar el aviso del siniestro {$p['siniestro']} a {$dest['email']}: " . $e->getMessage());
        }
    }
    // Si no salió ninguno (por ejemplo, Gmail caído), se reintenta en la próxima revisión.
    if ($enviados) {
        ejecutar('UPDATE pedidos SET ultimo_evento_avisado = ?, ultimo_aviso_at = ?, ultimo_aviso_para = ? WHERE id = ?',
            [$hasta, ahora(), implode(', ', $enviados), $pedidoId]);
    }
    return $enviados;
}

function enviar_avisos_pendientes(): void
{
    $pendientes = filas('SELECT p.id, MAX(e.id) AS hasta FROM pedidos p
        JOIN eventos e ON e.pedido_id = p.id AND e.id > p.ultimo_evento_avisado
        GROUP BY p.id
        HAVING MAX(e.fecha) <= ? OR MIN(e.fecha) <= ?', [ahora(-ESPERA_AVISO_SEGUNDOS), ahora(-ESPERA_AVISO_MAXIMA_MINUTOS * 60)]);
    foreach ($pendientes as $f) {
        // Se marca como "en curso" para que dos revisiones a la vez no manden el mismo aviso.
        if (!tarea_tomar('aviso_' . $f['id'], 120)) continue;
        try {
            avisar_pedido((int) $f['id'], (int) $f['hasta']);
        } catch (Throwable $e) {
            error_log("Aviso del pedido {$f['id']}: " . $e->getMessage());
        }
    }
}

// ---------------------------------------------------------------- Para la ficha del pedido (panel admin)

// A quién se avisa, si hay novedades esperando y cuándo salió el último aviso.
function estado_avisos(array $p): array
{
    return [
        'destinatarios' => array_column(destinatarios($p), 'email'),
        'pendientes' => (int) valor('SELECT COUNT(*) FROM eventos WHERE pedido_id = ? AND id > ?', [(int) $p['id'], (int) $p['ultimo_evento_avisado']]),
        'espera_segundos' => ESPERA_AVISO_SEGUNDOS,
        'ultimo_aviso_at' => $p['ultimo_aviso_at'],
        'ultimo_aviso_para' => $p['ultimo_aviso_para'],
    ];
}

// "Enviar aviso ahora": manda las novedades pendientes sin esperar.
function avisar_ahora(mixed $pedidoId): array
{
    $p = pedido_obtener($pedidoId);
    $hasta = (int) (valor('SELECT MAX(id) FROM eventos WHERE pedido_id = ?', [(int) $p['id']]) ?? 0);
    if ($hasta <= (int) $p['ultimo_evento_avisado']) throw new HttpError(400, 'No hay novedades sin avisar en este pedido.');
    if (!destinatarios($p)) {
        throw new HttpError(400, 'No hay a quién avisar: el taller y el perito no tienen un email real o desactivaron los avisos de este pedido.');
    }
    $enviados = avisar_pedido((int) $p['id'], $hasta);
    if (!$enviados) throw new HttpError(502, 'No se pudo mandar el aviso. Revisá la conexión con el correo e intentá de nuevo.');
    return ['enviados' => $enviados] + estado_avisos(pedido_obtener((int) $p['id']));
}
