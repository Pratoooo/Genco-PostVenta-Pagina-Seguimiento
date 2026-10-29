<?php
// Destino de cada pedido en el mapa: busca la dirección (Georef, el servicio de direcciones del Estado argentino,
// y si no la encuentra OpenStreetMap) y calcula la distancia y el tiempo en auto desde Genco (OSRM). Son
// servicios gratuitos y sin clave: los resultados se guardan para no repetir consultas, y si no responden la
// página sigue funcionando (queda el enlace a Google Maps).
defined('GENCO') || exit;

// Una dirección que no se encontró se vuelve a buscar recién al día siguiente.
const REINTENTO_NO_ENCONTRADA = 24 * 60 * 60;
const ABREVIATURAS = ['/^avenida\s/iu' => 'Av. ', '/^(bulevar|boulevard|boulevar)\s/iu' => 'Bv. ', '/^pasaje\s/iu' => 'Pje. ', '/^calle\s/iu' => ''];

function clave_direccion(?string $d): string
{
    return (string) preg_replace('/\s+/u', ' ', mb_strtolower(trim((string) $d)));
}

// Genco: el punto exacto (coordenadas) si está, si no la dirección.
function origen_clave(): string
{
    $g = config('genco') ?? [];
    return isset($g['lat'], $g['lon']) && $g['lat'] !== null ? "{$g['lat']},{$g['lon']}" : (string) ($g['direccion'] ?? '');
}

function huella_destino(string $destino): string
{
    return clave_direccion($destino) . '|' . clave_direccion(origen_clave());
}

function pedir_json(string $url, int $timeout = 8): array
{
    $agente = 'GencoSiniestros/1.0 (' . ((config('gmail')['usuario'] ?? '') ?: 'seguimiento de pedidos de siniestros') . ')';
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
            CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_USERAGENT => $agente, CURLOPT_HTTPHEADER => ['Accept-Language: es'],
        ]);
        $r = curl_exec($ch);
        $codigo = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($r === false || $codigo >= 400) throw new RuntimeException($r === false ? "sin respuesta ($error)" : "el servicio de mapas respondió $codigo");
    } else {
        $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'header' => "User-Agent: $agente\r\nAccept-Language: es\r\n"]]);
        $r = @file_get_contents($url, false, $ctx);
        if ($r === false) throw new RuntimeException('sin respuesta del servicio de mapas');
    }
    $j = json_decode((string) $r, true);
    if (!is_array($j)) throw new RuntimeException('respuesta inválida del servicio de mapas');
    return $j;
}

// "Avenida San Martín 1200, Malargüe, Mendoza": cómo quedó ubicada la dirección en OpenStreetMap.
function lugar_osm(array $r): string
{
    $a = $r['address'] ?? [];
    $calle = trim(($a['road'] ?? '') . ' ' . ($a['house_number'] ?? ''));
    $ciudad = $a['city'] ?? $a['town'] ?? $a['village'] ?? $a['municipality'] ?? $a['county'] ?? '';
    $lugar = implode(', ', array_filter([$calle, $ciudad, $a['state'] ?? '']));
    return $lugar !== '' ? $lugar : trim(implode(',', array_slice(explode(',', (string) ($r['display_name'] ?? '')), 0, 4)));
}

// Georef ubica calle y altura dentro de la localidad: "calle y número, ciudad, provincia". Reconoce mejor las
// abreviaturas ("Av.", "Bv."), así que si no encuentra la dirección tal cual, prueba abreviando.
function ubicar_con_georef(string $direccion): ?array
{
    $partes = array_values(array_filter(array_map('trim', explode(',', $direccion)), fn ($s) => $s !== '' && !preg_match('/^argentina$/i', $s)));
    $calle = $partes[0] ?? '';
    if ($calle === '' || !preg_match('/\d/', $calle)) return null; // Georef necesita la altura de la calle
    $abreviada = (string) preg_replace(array_keys(ABREVIATURAS), array_values(ABREVIATURAS), $calle);
    foreach (array_unique([$calle, $abreviada]) as $c) {
        $params = ['direccion' => $c, 'max' => '1'];
        if (isset($partes[1])) $params['localidad'] = $partes[1];
        if (isset($partes[2])) $params['provincia'] = $partes[2];
        $r = pedir_json('https://apis.datos.gob.ar/georef/api/direcciones?' . http_build_query($params), 10)['direcciones'][0] ?? null;
        if (isset($r['ubicacion']['lat'])) return ['lat' => (float) $r['ubicacion']['lat'], 'lon' => (float) $r['ubicacion']['lon'], 'lugar' => (string) ($r['nomenclatura'] ?? '')];
    }
    return null;
}

// OpenStreetMap: para lo que Georef no encuentra. Pide como mucho una consulta por segundo.
function ubicar_con_openstreetmap(string $direccion): ?array
{
    $texto = preg_match('/argentina/i', $direccion) ? $direccion : "$direccion, Argentina";
    $espera = (float) (valor('SELECT ultima FROM tareas WHERE nombre = ?', ['nominatim']) ?? 0) + 1.1 - microtime(true);
    if ($espera > 0) usleep((int) ($espera * 1e6));
    marcar_tarea('nominatim');
    $r = pedir_json('https://nominatim.openstreetmap.org/search?' . http_build_query(['format' => 'json', 'addressdetails' => 1, 'limit' => 1, 'countrycodes' => 'ar', 'q' => $texto]))[0] ?? null;
    return $r ? ['lat' => (float) $r['lat'], 'lon' => (float) $r['lon'], 'lugar' => lugar_osm($r)] : null;
}

// Coordenadas de una dirección (['lat', 'lon', 'lugar']), o null si no aparece en el mapa.
function ubicar(string $direccion): ?array
{
    $k = mb_substr(clave_direccion($direccion), 0, 250);
    if ($k === '') return null;
    $g = fila('SELECT lat, lon, lugar, encontrada, created_at FROM ubicaciones WHERE direccion = ?', [$k]);
    if ($g && $g['encontrada']) return ['lat' => (float) $g['lat'], 'lon' => (float) $g['lon'], 'lugar' => $g['lugar']];
    if ($g && time() - strtotime($g['created_at'] . ' UTC') < REINTENTO_NO_ENCONTRADA) return null;
    $punto = null;
    try {
        $punto = ubicar_con_georef($direccion);
    } catch (Throwable $e) {
        error_log('Georef no respondió (' . $e->getMessage() . '): se busca en OpenStreetMap.');
    }
    $punto ??= ubicar_con_openstreetmap($direccion);
    transaccion(function () use ($k, $punto) {
        ejecutar('DELETE FROM ubicaciones WHERE direccion = ?', [$k]);
        ejecutar('INSERT INTO ubicaciones (direccion, lat, lon, lugar, encontrada, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [$k, $punto['lat'] ?? null, $punto['lon'] ?? null, mb_substr($punto['lugar'] ?? '', 0, 255), $punto ? 1 : 0, ahora()]);
    });
    return $punto;
}

// Distancia (km) y tiempo (minutos) en auto entre dos puntos, o null si no hay ruta.
function ruta_en_auto(array $a, array $b): ?array
{
    $r = pedir_json("https://router.project-osrm.org/route/v1/driving/{$a['lon']},{$a['lat']};{$b['lon']},{$b['lat']}?overview=false", 10);
    $mejor = ($r['code'] ?? '') === 'Ok' ? ($r['routes'][0] ?? null) : null;
    return $mejor ? ['km' => round($mejor['distance'] / 100) / 10, 'minutos' => (int) round($mejor['duration'] / 60)] : null;
}

// Lo que se muestra del destino de un pedido en el panel. "calculando" mientras la dirección guardada todavía
// no se buscó en el mapa (o cambió la dirección de Genco).
function info_destino(array $p): array
{
    $g = config('genco') ?? [];
    $origen = ($g['direccion'] ?? '') ?: origen_clave();
    if ($p['destino_direccion'] === '') return ['estado' => 'sin_direccion', 'origen' => $origen, 'origen_punto' => origen_clave()];
    $vigente = $p['destino_calculado'] === huella_destino($p['destino_direccion']);
    return [
        'direccion' => $p['destino_direccion'],
        'origen' => $origen,
        'origen_punto' => origen_clave(),
        'estado' => $vigente ? $p['destino_estado'] : 'calculando',
        'lat' => $vigente ? $p['destino_lat'] : null,
        'lon' => $vigente ? $p['destino_lon'] : null,
        'lugar' => $vigente ? $p['destino_lugar'] : '',
        'km' => $vigente ? $p['destino_km'] : null,
        'minutos' => $vigente ? $p['destino_minutos'] : null,
    ];
}

function destino_pendiente(array $p): bool
{
    $e = info_destino($p)['estado'];
    return $e === 'calculando' || $e === 'error';
}

// Busca el destino del pedido en el mapa y calcula distancia y tiempo desde Genco. Nunca falla.
function calcular_destino(int $pedidoId): void
{
    $p = fila('SELECT * FROM pedidos WHERE id = ?', [$pedidoId]);
    if (!$p || !destino_pendiente($p) || !tarea_tomar("destino_$pedidoId", 20)) return;
    $g = config('genco') ?? [];
    try {
        $destino = ubicar($p['destino_direccion']);
        if (!$destino) {
            $datos = ['estado' => 'no_encontrada'];
        } elseif (origen_clave() === '') {
            $datos = ['estado' => 'sin_origen'] + $destino;
        } else {
            $desde = isset($g['lat'], $g['lon']) && $g['lat'] !== null ? ['lat' => (float) $g['lat'], 'lon' => (float) $g['lon']] : ubicar((string) ($g['direccion'] ?? ''));
            $r = $desde ? ruta_en_auto($desde, $destino) : null;
            $datos = $r ? ['estado' => 'ok'] + $destino + $r : ['estado' => $desde ? 'sin_ruta' : 'origen_no_encontrado'] + $destino;
        }
    } catch (Throwable $e) {
        error_log("No se pudo ubicar el destino del pedido $pedidoId: " . $e->getMessage());
        $datos = ['estado' => 'error'];
    }
    // Solo datos calculados: no cambia la versión ni la fecha de actualización del pedido.
    ejecutar('UPDATE pedidos SET destino_lat = ?, destino_lon = ?, destino_lugar = ?, destino_km = ?, destino_minutos = ?,
              destino_estado = ?, destino_calculado = ? WHERE id = ? AND destino_direccion = ?',
        [$datos['lat'] ?? null, $datos['lon'] ?? null, mb_substr($datos['lugar'] ?? '', 0, 255), $datos['km'] ?? null, $datos['minutos'] ?? null,
            $datos['estado'], huella_destino($p['destino_direccion']), $pedidoId, $p['destino_direccion']]);
}

// Pedidos con el destino sin calcular (por ejemplo, recién cambiada la dirección de un taller): de a pocos.
function recalcular_destinos(int $maximo = 3): void
{
    $hechos = 0;
    foreach (filas("SELECT * FROM pedidos WHERE destino_direccion <> ''") as $p) {
        if ($hechos >= $maximo) break;
        if (destino_pendiente($p)) {
            calcular_destino((int) $p['id']);
            $hechos++;
        }
    }
}
