<?php
// Pedidos de repuestos por siniestro: datos, envíos, etapas de seguimiento e historial.
//
// Un pedido puede salir en varios envíos: con despacho parcial se manda la parte que hay y lo que falta va
// después en otro envío, con su propio remito y número de guía.
defined('GENCO') || exit;

const ORIGENES = ['stock' => 'Stock disponible', 'fabrica' => 'Pedido a fábrica'];
const DESPACHOS = ['parcial' => 'Parcial (falta enviar una parte)', 'total' => 'Completo (se envió todo)'];
const TRANSPORTES = ['angeleri' => 'Angeleri', 'andreani' => 'Andreani', 'oca' => 'OCA', 'sendbox' => 'Sendbox', 'genco' => 'Repartidora de Genco'];
// Página de cada expreso donde el cliente pega el número de guía para ver el estado del envío.
// Angeleri y la repartidora de Genco no tienen: el estado lo carga la oficina.
const PAGINAS_SEGUIMIENTO = [
    'andreani' => 'https://www.andreani.com/',
    'oca' => 'https://www.oca.com.ar/',
    'sendbox' => 'https://www.sendbox.com.ar/seguimiento/',
];
const ENTREGAS = ['en_camino' => 'En camino', 'recibido' => 'Recibido'];
// A dónde se envía el pedido: a la dirección del taller, a la del perito o a otra.
const DESTINOS_ENVIO = ['taller' => 'Al taller', 'perito' => 'Al perito', 'otra' => 'Otra dirección'];

const MAX_ENVIOS = 10;

const CAMPOS_PEDIDO = ['siniestro', 'patente', 'taller_id', 'perito_id', 'compania', 'vehiculo', 'cantidad_piezas', 'origen', 'despacho',
    'plazo_entrega', 'destino', 'destino_direccion'];

// Pedido con los nombres del taller y del perito asignados.
const SELECT_PEDIDOS = "SELECT p.*, COALESCE(NULLIF(t.empresa, ''), t.nombre, NULLIF(p.taller, ''), '') AS taller_nombre,
    COALESCE(pe.nombre, '') AS perito_nombre
  FROM pedidos p
  LEFT JOIN usuarios t ON t.id = p.taller_id
  LEFT JOIN usuarios pe ON pe.id = p.perito_id";

function pedido_obtener(mixed $id): array
{
    $p = fila(SELECT_PEDIDOS . ' WHERE p.id = ?', [(int) $id]);
    if (!$p) throw new HttpError(404, 'Pedido no encontrado. Puede que otra persona lo haya eliminado.');
    return $p;
}

function pedido_envios(int $pedidoId): array
{
    return filas('SELECT * FROM envios WHERE pedido_id = ? ORDER BY id', [$pedidoId]);
}

function pedido_por_siniestro_y_patente(string $siniestro, string $patente): ?array
{
    return fila(SELECT_PEDIDOS . ' WHERE p.siniestro = ? AND p.patente = ?', [$siniestro, $patente]);
}

// Todos los pedidos, para la reseña del panel (los filtros se aplican en la pantalla).
function pedidos_listar(): array
{
    return filas(SELECT_PEDIDOS . ' ORDER BY p.updated_at DESC');
}

function columna_asignacion(array $usuario): string
{
    return $usuario['rol'] === 'perito' ? 'perito_id' : 'taller_id';
}

function pedidos_asignados(array $usuario): array
{
    return filas(SELECT_PEDIDOS . ' WHERE p.' . columna_asignacion($usuario) . ' = ? ORDER BY p.updated_at DESC', [(int) $usuario['id']]);
}

function pedido_asignado_a(array $pedido, array $usuario): bool
{
    return (int) ($pedido[columna_asignacion($usuario)] ?? 0) === (int) $usuario['id'];
}

// ---------------------------------------------------------------- Seguimiento

// Con más de un envío (o si el despacho es parcial) cada uno se nombra "Envío 1", "Envío 2"...
function varios_envios(array $p, array $envios): bool
{
    return count($envios) > 1 || ($p['despacho'] ?? '') === 'parcial';
}

// Las 4 etapas: Origen -> Despacho (remitos) -> Expreso (guías) -> En camino / Recibido
function pedido_etapas(array $p, array $envios): array
{
    $total = count($envios);
    $recibidos = count(array_filter($envios, fn ($e) => $e['entrega'] === 'recibido'));
    $completo = $p['despacho'] === 'total';
    $recibido = $completo && $total > 0 && $recibidos === $total;
    $despachados = array_values(array_filter($envios, fn ($e) => $e['transporte'] !== '' || $e['guia'] !== ''));
    $remitos = array_values(array_filter(array_map(fn ($e) => $e['remito'], $envios), fn ($r) => $r !== ''));
    $falta = $p['despacho'] === 'parcial' ? 'falta enviar una parte' : '';
    $unir = fn (array $partes, string $sep = ' · ') => implode($sep, array_filter($partes, fn ($x) => $x !== '' && $x !== null && $x !== false));
    $nDesp = count($despachados);

    $lista = [
        [
            'titulo' => ORIGENES[$p['origen']] ?? 'Pedido a fábrica / Stock',
            'alcanzada' => $p['origen'] !== '',
            'detalle' => $p['origen'] !== '' ? '' : 'Estamos verificando la disponibilidad de las piezas.',
        ],
        [
            'titulo' => $p['despacho'] === 'parcial' ? 'Despacho parcial' : ($completo ? ($total > 1 ? 'Despacho completo' : 'Despacho total') : 'Despacho'),
            'alcanzada' => $p['despacho'] !== '' || $total > 0,
            'detalle' => $unir([$remitos ? (count($remitos) > 1 ? 'Remitos ' : 'Remito ') . implode(', ', $remitos) : '', $falta]),
        ],
        [
            'titulo' => 'Expreso',
            'alcanzada' => $nDesp > 0,
            'detalle' => varios_envios($p, $envios)
                ? ($nDesp ? $nDesp . ($nDesp > 1 ? ' envíos despachados' : ' envío despachado') : '')
                : implode('', array_map(fn ($e) => $unir([TRANSPORTES[$e['transporte']] ?? '', $e['guia'] !== '' ? "Guía {$e['guia']}" : '']), $despachados)),
        ],
        [
            'titulo' => $recibido ? 'Recibido' : ($recibidos ? 'Recibido en parte' : 'En camino'),
            'alcanzada' => (bool) array_filter($envios, fn ($e) => $e['entrega'] !== ''),
            'detalle' => $recibidos && !$recibido ? $unir([$recibidos . ' de ' . $total . ($total > 1 ? ' envíos recibidos' : ' envío recibido'), $falta]) : '',
        ],
    ];
    $ultimaAlcanzada = -1;
    foreach ($lista as $i => $e) if ($e['alcanzada']) $ultimaAlcanzada = $i;
    $actual = $recibido ? count($lista) : max(0, $ultimaAlcanzada);
    $estado = $recibido ? 'Recibido' : ($lista[$actual]['alcanzada'] ? $lista[$actual]['titulo'] : 'En revisión');
    // Para la reseña: en preparación (todavía no salió) | en camino (salió, falta que llegue todo) | recibido.
    $grupo = $recibido ? 'recibido' : ($nDesp || $recibidos ? 'en_camino' : 'preparacion');
    return ['etapas' => $lista, 'etapa_actual' => $actual, 'recibido' => $recibido, 'estado' => $estado, 'grupo' => $grupo];
}

function pedido_datos(array $p): array
{
    return [
        'id' => (int) $p['id'],
        'siniestro' => $p['siniestro'],
        'patente' => $p['patente'],
        'vehiculo' => $p['vehiculo'],
        'taller' => $p['taller_nombre'],
        'perito' => $p['perito_nombre'],
        'compania' => $p['compania'],
        'cantidad_piezas' => $p['cantidad_piezas'] === null ? null : (int) $p['cantidad_piezas'],
        'plazo_entrega' => $p['plazo_entrega'],
    ];
}

// Lo que se muestra de cada envío.
function envio_publico(array $e): array
{
    return [
        'id' => (int) $e['id'],
        'remito' => $e['remito'],
        'transporte' => TRANSPORTES[$e['transporte']] ?? '',
        'guia' => $e['guia'],
        // Para que el cliente siga el envío en la página del expreso (solo si tiene guía).
        'seguimiento_url' => $e['guia'] !== '' ? (PAGINAS_SEGUIMIENTO[$e['transporte']] ?? '') : '',
        'estado_viaje' => $e['estado_viaje'],
        'recibido' => $e['entrega'] === 'recibido',
        'estado' => $e['entrega'] !== '' ? ENTREGAS[$e['entrega']] : ($e['transporte'] !== '' || $e['guia'] !== '' ? 'Despachado' : 'Preparando envío'),
    ];
}

// Todo lo que muestra la pantalla de seguimiento.
function pedido_seguimiento(array $p): array
{
    $envios = pedido_envios((int) $p['id']);
    $et = pedido_etapas($p, $envios);
    return [
        'pedido' => pedido_datos($p),
        'etapas' => $et['etapas'],
        'etapa_actual' => $et['etapa_actual'],
        'recibido' => $et['recibido'],
        'estado' => $et['estado'],
        'grupo' => $et['grupo'],
        'despacho_parcial' => $p['despacho'] === 'parcial',
        'envios' => array_map('envio_publico', $envios),
        'actualizado' => $p['updated_at'],
        'eventos' => filas('SELECT descripcion, fecha FROM eventos WHERE pedido_id = ? ORDER BY id DESC', [(int) $p['id']]),
    ];
}

// Fila de los listados, con lo necesario para filtrarlos (expreso, remitos, guías, fechas).
function pedido_resumen(array $p): array
{
    $envios = pedido_envios((int) $p['id']);
    $et = pedido_etapas($p, $envios);
    $expresos = [];
    foreach ($envios as $e) if (isset(TRANSPORTES[$e['transporte']])) $expresos[TRANSPORTES[$e['transporte']]] = true;
    return pedido_datos($p) + [
        'etapa_actual' => $et['etapa_actual'],
        'recibido' => $et['recibido'],
        'estado' => $et['estado'],
        'grupo' => $et['grupo'],
        'expresos' => array_keys($expresos),
        'remitos' => array_values(array_filter(array_column($envios, 'remito'), fn ($x) => $x !== '')),
        'guias' => array_values(array_filter(array_column($envios, 'guia'), fn ($x) => $x !== '')),
        // Envíos que ya salieron y todavía no figuran como recibidos.
        'en_viaje' => count(array_filter($envios, fn ($e) => $e['entrega'] !== 'recibido'
            && ($e['transporte'] !== '' || $e['guia'] !== '' || $e['entrega'] !== ''))),
        'created_at' => $p['created_at'],
        'updated_at' => $p['updated_at'],
    ];
}

// ---------------------------------------------------------------- Alta y modificación

function opcion(mixed $valor, array $permitidas, string $nombre): string
{
    $v = texto($valor);
    if ($v !== '' && !isset($permitidas[$v])) throw new HttpError(400, "$nombre inválido");
    return $v;
}

function id_usuario(mixed $valor, string $rol): ?int
{
    if ($valor === '' || $valor === null) return null;
    $u = fila('SELECT id FROM usuarios WHERE id = ? AND rol = ?', [(int) $valor, $rol]);
    if (!$u) throw new HttpError(400, ROLES[$rol] . ' inválido');
    return (int) $u['id'];
}

function leer_envios(mixed $lista): array
{
    if ($lista === null) return [];
    if (!is_array($lista) || !array_is_list($lista) || count($lista) > MAX_ENVIOS) throw new HttpError(400, 'Envíos inválidos');
    $envios = [];
    foreach ($lista as $i => $e) {
        if (!is_array($e)) throw new HttpError(400, 'Envíos inválidos');
        $envio = [
            'id' => !empty($e['id']) ? (int) $e['id'] : null,
            'remito' => texto($e['remito'] ?? '', 40),
            'transporte' => opcion($e['transporte'] ?? '', TRANSPORTES, 'Expreso'),
            'guia' => texto($e['guia'] ?? '', 40),
            'estado_viaje' => texto($e['estado_viaje'] ?? '', 120),
            'entrega' => opcion($e['entrega'] ?? '', ENTREGAS, 'Entrega'),
        ];
        if ($envio['remito'] === '') throw new HttpError(400, 'Falta el N° de remito del envío ' . ($i + 1) . '.');
        $envios[] = $envio;
    }
    return $envios;
}

// Fecha del plazo de entrega tal como la manda el campo de fecha ("2026-10-15"). Vacío = sin plazo.
function fecha_plazo(mixed $valor): string
{
    $v = texto($valor, 10);
    if ($v === '') return '';
    $d = DateTime::createFromFormat('!Y-m-d', $v, new DateTimeZone('UTC'));
    if (!$d || $d->format('Y-m-d') !== $v || $v < '2020-01-01' || $v > '2100-12-31') {
        throw new HttpError(400, 'El plazo de entrega no es una fecha válida.');
    }
    return $v;
}

// "2026-10-15" -> "15/10/2026"
function fecha_argentina(string $v): string
{
    return implode('/', array_reverse(explode('-', $v)));
}

// Dirección de entrega: la que se escribió o, si se eligió "al taller" / "al perito" y quedó vacía, la de su cuenta.
function direccion_destino(array $d, string $escrita): string
{
    if ($escrita !== '' || !in_array($d['destino'], ['taller', 'perito'], true)) return $escrita;
    $id = $d[$d['destino'] . '_id'];
    return $id ? (string) (valor('SELECT direccion FROM usuarios WHERE id = ?', [$id]) ?? '') : '';
}

// Valida los datos del formulario de pedido (incluidos sus envíos).
function pedido_leer(array $b): array
{
    $cantidad = $b['cantidad_piezas'] ?? null;
    $d = [
        'siniestro' => texto($b['siniestro'] ?? '', 40),
        'patente' => patente($b['patente'] ?? ''),
        'taller_id' => id_usuario($b['taller_id'] ?? null, 'taller'),
        'perito_id' => id_usuario($b['perito_id'] ?? null, 'perito'),
        'compania' => texto($b['compania'] ?? '', 100),
        'vehiculo' => texto($b['vehiculo'] ?? '', 100),
        'cantidad_piezas' => $cantidad === '' || $cantidad === null ? null : (is_numeric($cantidad) ? (int) $cantidad : -1),
        'origen' => opcion($b['origen'] ?? '', ORIGENES, 'Origen'),
        'despacho' => opcion($b['despacho'] ?? '', DESPACHOS, 'Despacho'),
        'plazo_entrega' => fecha_plazo($b['plazo_entrega'] ?? ''),
        'destino' => opcion($b['destino'] ?? '', DESTINOS_ENVIO, 'Destino'),
        'envios' => leer_envios($b['envios'] ?? null),
    ];
    $d['destino_direccion'] = direccion_destino($d, texto($b['destino_direccion'] ?? '', 200));
    if ($d['siniestro'] === '') throw new HttpError(400, 'Falta el número de siniestro');
    if (!preg_match('/^[A-Z0-9]{5,8}$/', $d['patente'])) throw new HttpError(400, 'La patente no parece válida (ej: AB123CD o ABC123)');
    if ($d['cantidad_piezas'] !== null && $d['cantidad_piezas'] < 0) throw new HttpError(400, 'Cantidad de piezas inválida');
    if ($d['envios'] && $d['despacho'] === '') throw new HttpError(400, 'Elegí si el despacho es parcial o completo.');
    return $d;
}

function validar_siniestro_libre(string $siniestro, ?int $idActual = null): void
{
    $otro = fila('SELECT id FROM pedidos WHERE siniestro = ?', [$siniestro]);
    if ($otro && (int) $otro['id'] !== $idActual) throw new HttpError(409, 'Ya existe un pedido con ese número de siniestro.');
}

function registrar_evento(int $pedidoId, string $descripcion): void
{
    ejecutar('INSERT INTO eventos (pedido_id, descripcion, fecha) VALUES (?, ?, ?)', [$pedidoId, mb_substr($descripcion, 0, 300), ahora()]);
}

function cambio(array $antes, array $despues, string ...$campos): bool
{
    foreach ($campos as $c) if ((string) ($antes[$c] ?? '') !== (string) ($despues[$c] ?? '')) return true;
    return false;
}

// Anota en el historial los cambios que ven el cliente, el taller y el perito.
function registrar_cambios(int $id, array $antes, array $d): void
{
    if (cambio($antes, $d, 'plazo_entrega') && $d['plazo_entrega'] !== '') registrar_evento($id, 'Entrega estimada para el ' . fecha_argentina($d['plazo_entrega']));
    if (cambio($antes, $d, 'origen') && $d['origen'] !== '') registrar_evento($id, ORIGENES[$d['origen']]);
    if (cambio($antes, $d, 'despacho') && $d['despacho'] !== '') {
        registrar_evento($id, $d['despacho'] === 'parcial' ? 'Despacho parcial: se envía una parte y lo que falta sale después'
            : (count($d['envios']) > 1 ? 'Despacho completo: se envió todo el pedido' : 'Despacho total'));
    }
}

function registrar_cambios_envio(int $pedidoId, array $antes, array $e, string $nombre): void
{
    $anotar = fn (string $t) => registrar_evento($pedidoId, $nombre !== '' ? "$nombre · $t" : $t);
    if (cambio($antes, $e, 'remito') && $e['remito'] !== '') $anotar("Remito {$e['remito']}");
    if (cambio($antes, $e, 'transporte', 'guia') && ($e['transporte'] !== '' || $e['guia'] !== '')) {
        $anotar(implode(', ', array_filter(['Enviado por ' . (TRANSPORTES[$e['transporte']] ?? 'expreso'), $e['guia'] !== '' ? "guía {$e['guia']}" : ''])));
    }
    if (cambio($antes, $e, 'estado_viaje') && $e['estado_viaje'] !== '') $anotar($e['estado_viaje']);
    if (cambio($antes, $e, 'entrega') && $e['entrega'] !== '') $anotar(ENTREGAS[$e['entrega']]);
}

// Deja los envíos del pedido como vienen del formulario: actualiza, agrega y quita.
function guardar_envios(int $pedidoId, array $d): void
{
    $actuales = [];
    foreach (pedido_envios($pedidoId) as $e) $actuales[(int) $e['id']] = $e;
    $quedan = array_filter(array_column($d['envios'], 'id'));
    foreach (array_keys($actuales) as $id) {
        if (!in_array($id, $quedan, true)) ejecutar('DELETE FROM envios WHERE id = ?', [$id]);
    }
    $conNumero = varios_envios($d, $d['envios']);
    foreach ($d['envios'] as $i => $e) {
        $antes = $e['id'] ? ($actuales[$e['id']] ?? null) : null;
        if ($e['id'] && !$antes) throw conflicto('los envíos de este pedido');
        if ($antes) {
            ejecutar('UPDATE envios SET remito = ?, transporte = ?, guia = ?, estado_viaje = ?, entrega = ? WHERE id = ?',
                [$e['remito'], $e['transporte'], $e['guia'], $e['estado_viaje'], $e['entrega'], $e['id']]);
        } else {
            ejecutar('INSERT INTO envios (pedido_id, remito, transporte, guia, estado_viaje, entrega, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$pedidoId, $e['remito'], $e['transporte'], $e['guia'], $e['estado_viaje'], $e['entrega'], ahora()]);
        }
        registrar_cambios_envio($pedidoId, $antes ?? [], $e, $conNumero ? 'Envío ' . ($i + 1) : '');
    }
}

function valores_pedido(array $d): array
{
    return array_map(fn ($c) => $d[$c], CAMPOS_PEDIDO);
}

function pedido_crear(array $d): array
{
    validar_siniestro_libre($d['siniestro']);
    $id = transaccion(function () use ($d) {
        $cols = implode(', ', CAMPOS_PEDIDO);
        $marcas = implode(', ', array_fill(0, count(CAMPOS_PEDIDO), '?'));
        ejecutar("INSERT INTO pedidos ($cols, created_at, updated_at) VALUES ($marcas, ?, ?)", [...valores_pedido($d), ahora(), ahora()]);
        $id = ultimo_id();
        registrar_evento($id, 'Pedido registrado');
        registrar_cambios($id, [], $d);
        guardar_envios($id, $d);
        return $id;
    });
    return pedido_obtener($id);
}

// $version es la que tenía el formulario al abrirse: si cambió, otra persona guardó en el medio.
function pedido_actualizar(mixed $id, array $d, ?int $version): array
{
    $antes = pedido_obtener($id);
    $antesId = (int) $antes['id'];
    validar_siniestro_libre($d['siniestro'], $antesId);
    transaccion(function () use ($antes, $antesId, $d, $version) {
        $sets = implode(', ', array_map(fn ($c) => "$c = ?", CAMPOS_PEDIDO));
        $cambios = ejecutar("UPDATE pedidos SET $sets, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
            [...valores_pedido($d), ahora(), $antesId, $version ?? (int) $antes['version']]);
        if (!$cambios) throw conflicto('este pedido');
        registrar_cambios($antesId, $antes, $d);
        guardar_envios($antesId, $d);
    });
    return pedido_obtener($antesId);
}

function pedido_eliminar(mixed $id): void
{
    ejecutar('DELETE FROM pedidos WHERE id = ?', [(int) pedido_obtener($id)['id']]);
}

// ---------------------------------------------------------------- Recepción (la confirma quien la recibe)

// Si el pedido va al taller lo confirma el taller; si va al perito, el perito. Si va a otra dirección (o no se
// indicó), cualquiera de los dos asignados.
function puede_confirmar_recepcion(array $p, array $usuario): bool
{
    $destino = (string) ($p['destino'] ?? '');
    return !in_array($destino, ['taller', 'perito'], true) || $destino === $usuario['rol'];
}

// "Ya me llegó": el envío queda recibido y, si era lo último que faltaba, el pedido pasa a "Recibido".
// Sube la versión del pedido, así un formulario del panel abierto desde antes no lo vuelve atrás al guardar.
function pedido_confirmar_recepcion(array $p, mixed $envioId, array $usuario): void
{
    if (!puede_confirmar_recepcion($p, $usuario)) {
        throw new HttpError(403, 'Este pedido se envía ' . mb_strtolower(DESTINOS_ENVIO[$p['destino']]) . ': la llegada la confirma quien lo recibe.');
    }
    $envios = pedido_envios((int) $p['id']);
    $i = null;
    foreach ($envios as $n => $e) if ((int) $e['id'] === (int) $envioId) $i = $n;
    if ($i === null) throw new HttpError(404, 'No se encontró ese envío. Puede que Genco lo haya cambiado: actualizá la página.');
    if ($envios[$i]['entrega'] === 'recibido') return;
    $quien = $usuario['rol'] === 'taller' && ($usuario['empresa'] ?? '') !== '' ? $usuario['empresa'] : $usuario['nombre'];
    $nombre = varios_envios($p, $envios) ? 'Envío ' . ($i + 1) . ' · ' : '';
    transaccion(function () use ($p, $envios, $i, $quien, $nombre) {
        ejecutar("UPDATE envios SET entrega = 'recibido' WHERE id = ?", [(int) $envios[$i]['id']]);
        ejecutar('UPDATE pedidos SET version = version + 1, updated_at = ? WHERE id = ?', [ahora(), (int) $p['id']]);
        registrar_evento((int) $p['id'], "{$nombre}Recibido (lo confirmó $quien)");
    });
}
