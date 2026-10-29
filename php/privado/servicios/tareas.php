<?php
// Tareas automáticas: mandar los avisos por mail pendientes, ubicar destinos en el mapa y limpiar datos viejos.
//
// En un hosting compartido no hay un programa corriendo todo el tiempo: las tareas se hacen después de
// contestar cada pedido a la API (como mucho cada 20 segundos), así que funcionan mientras alguien usa la
// página. Si el hosting tiene tareas programadas (cron), se puede llamar a tareas.php cada minuto para que
// los avisos salgan aunque nadie tenga la página abierta.
defined('GENCO') || exit;

const CADA_CUANTO_TAREAS = 20;

function marcar_tarea(string $nombre): void
{
    transaccion(function () use ($nombre) {
        ejecutar('DELETE FROM tareas WHERE nombre = ?', [$nombre]);
        ejecutar('INSERT INTO tareas (nombre, ultima) VALUES (?, ?)', [$nombre, microtime(true)]);
    });
}

// "Toma" una tarea si no se hizo en los últimos $segundos (para que dos pedidos a la vez no la repitan).
function tarea_tomar(string $nombre, int $segundos): bool
{
    return (bool) transaccion(function () use ($nombre, $segundos) {
        $ultima = (float) (valor('SELECT ultima FROM tareas WHERE nombre = ?', [$nombre]) ?? 0);
        if (microtime(true) - $ultima < $segundos) return false;
        ejecutar('DELETE FROM tareas WHERE nombre = ?', [$nombre]);
        ejecutar('INSERT INTO tareas (nombre, ultima) VALUES (?, ?)', [$nombre, microtime(true)]);
        return true;
    });
}

function tareas_ejecutar(bool $forzar = false): void
{
    if (!$forzar && !tarea_tomar('ciclo', CADA_CUANTO_TAREAS)) return;
    $pasos = [
        'exigir_https' => fn () => exigir_https(),
        'enviar_avisos_pendientes' => fn () => enviar_avisos_pendientes(),
        'recalcular_destinos' => fn () => recalcular_destinos(),
        'limpieza' => function () {
            if (!tarea_tomar('limpieza', 24 * 60 * 60)) return;
            ejecutar('DELETE FROM limites WHERE desde < ?', [time() - 24 * 60 * 60]);
            ejecutar('DELETE FROM recuperaciones WHERE expira < ?', [time()]);
            ejecutar("DELETE FROM tareas WHERE ultima < ? AND (nombre LIKE 'aviso%' OR nombre LIKE 'destino%')", [microtime(true) - 24 * 60 * 60]);
        },
    ];
    foreach ($pasos as $nombre => $paso) {
        try {
            $paso();
        } catch (Throwable $e) {
            error_log("Tarea $nombre: " . $e->getMessage());
        }
    }
}
