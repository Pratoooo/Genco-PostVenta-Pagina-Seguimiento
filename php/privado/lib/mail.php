<?php
// Envío de mails. Por Gmail (SMTP seguro, puerto 465, con la "contraseña de aplicación" de la cuenta; en la
// configuración, "servidor" y "puerto" permiten usar otro servidor SMTP seguro), o con
// el correo del propio hosting si así se configuró. Sin configurar, el mail se guarda en privado/datos/mails.log.
// Los mails con diseño llevan los logos adjuntos dentro del mail (se ven aunque el lector bloquee imágenes).
defined('GENCO') || exit;

function mail_configurado(): bool
{
    $m = config('mail') ?? [];
    $g = config('gmail') ?? [];
    return ($m['modo'] ?? 'gmail') === 'hosting' ? !empty($m['remitente']) : !empty($g['usuario']) && !empty($g['clave_app']);
}

function remitente_mail(): string
{
    $m = config('mail') ?? [];
    return ($m['modo'] ?? 'gmail') === 'hosting' ? (string) $m['remitente'] : (string) (config('gmail')['usuario'] ?? '');
}

function enviar_mail(string $para, string $asunto, string $texto, ?string $html = null): void
{
    $asunto = texto($asunto, 200);
    if (!mail_configurado()) {
        file_put_contents(dir_datos() . '/mails.log', "\n=== " . gmdate('c') . "\nPara: $para\nAsunto: $asunto\n\n$texto\n", FILE_APPEND | LOCK_EX);
        return;
    }
    $mensaje = armar_mensaje($para, $asunto, $texto, $html);
    if ((config('mail')['modo'] ?? 'gmail') === 'hosting') {
        [$cabeceras, $cuerpo] = explode("\r\n\r\n", $mensaje, 2);
        $cabeceras = (string) preg_replace('/^(To|Subject):.*\r\n/mi', '', $cabeceras . "\r\n");
        if (!mail($para, encabezado_mime($asunto), $cuerpo, rtrim($cabeceras), '-f' . remitente_mail())) {
            throw new RuntimeException('el servidor de correo del hosting no aceptó el mail');
        }
        return;
    }
    $g = config('gmail');
    smtp_enviar($g['servidor'] ?? 'smtp.gmail.com', (int) ($g['puerto'] ?? 465), $g['usuario'], $g['clave_app'], $g['usuario'], $para, $mensaje);
}

// ---------------------------------------------------------------- Mensaje (MIME)

function encabezado_mime(string $s): string
{
    return preg_match('/[^\x20-\x7e]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
}

function parte_base64(string $tipo, string $contenido, array $extra = []): string
{
    return "Content-Type: $tipo\r\nContent-Transfer-Encoding: base64\r\n" . implode('', array_map(fn ($h) => "$h\r\n", $extra))
        . "\r\n" . rtrim(chunk_split(base64_encode($contenido), 76, "\r\n")) . "\r\n";
}

function logos_mail(): array
{
    return [
        ['cid' => 'logo-genco', 'archivo' => DIR_PUBLICO . '/img/genco.png', 'nombre' => 'genco.png'],
        ['cid' => 'logo-stellantis', 'archivo' => DIR_PUBLICO . '/img/stellantis.png', 'nombre' => 'stellantis.png'],
    ];
}

function armar_mensaje(string $para, string $asunto, string $texto, ?string $html): string
{
    $remitente = remitente_mail();
    $dominio = substr((string) strrchr($remitente, '@'), 1) ?: 'localhost';
    $cabeceras = [
        'From: ' . encabezado_mime('Grupo Genco Siniestros') . " <$remitente>",
        "To: <$para>",
        'Subject: ' . encabezado_mime($asunto),
        'Date: ' . date(DATE_RFC2822),
        'Message-ID: <' . bin2hex(random_bytes(16)) . "@$dominio>",
        'MIME-Version: 1.0',
    ];
    $textoPlano = parte_base64('text/plain; charset=UTF-8', $texto);
    if ($html === null) return implode("\r\n", $cabeceras) . "\r\n" . $textoPlano;

    $alt = 'alt-' . bin2hex(random_bytes(8));
    $rel = 'rel-' . bin2hex(random_bytes(8));
    $relacionado = "--$rel\r\n" . parte_base64('text/html; charset=UTF-8', $html);
    foreach (logos_mail() as $l) {
        if (!is_file($l['archivo'])) continue;
        $relacionado .= "--$rel\r\n" . parte_base64("image/png; name=\"{$l['nombre']}\"", (string) file_get_contents($l['archivo']),
            ["Content-ID: <{$l['cid']}>", "Content-Disposition: inline; filename=\"{$l['nombre']}\""]);
    }
    $relacionado .= "--$rel--\r\n";
    $cabeceras[] = "Content-Type: multipart/alternative; boundary=\"$alt\"";
    return implode("\r\n", $cabeceras) . "\r\n\r\n"
        . "--$alt\r\n$textoPlano"
        . "--$alt\r\nContent-Type: multipart/related; boundary=\"$rel\"\r\n\r\n$relacionado"
        . "--$alt--\r\n";
}

// ---------------------------------------------------------------- SMTP

function smtp_leer($s): array
{
    $texto = '';
    while (($linea = fgets($s, 1024)) !== false) {
        $texto .= $linea;
        if (strlen($linea) < 4 || $linea[3] !== '-') break;
    }
    return [(int) substr($texto, 0, 3), trim($texto)];
}

function smtp_comando($s, ?string $comando, array $esperados, string $paso): string
{
    if ($comando !== null) fwrite($s, $comando . "\r\n");
    [$codigo, $respuesta] = smtp_leer($s);
    if (!in_array($codigo, $esperados, true)) {
        if ($codigo === 535 || $codigo === 534) {
            throw new RuntimeException('Gmail rechazó el usuario o la contraseña de aplicación. Revisá la configuración del mail '
                . '(tiene que ser una contraseña de aplicación, no la contraseña normal de la cuenta)');
        }
        throw new RuntimeException("el servidor de mail respondió \"$respuesta\" ($paso)");
    }
    return $respuesta;
}

// Abre la conexión segura e inicia sesión. Si se pasa $mensaje, lo manda.
function smtp_enviar(string $host, int $puerto, string $usuario, string $clave, string $de, ?string $para, ?string $mensaje): void
{
    $verificar = (config('mail')['verificar_certificado'] ?? true) !== false;
    $contexto = stream_context_create(['ssl' => ['verify_peer' => $verificar, 'verify_peer_name' => $verificar, 'SNI_enabled' => true]]);
    $s = @stream_socket_client("ssl://$host:$puerto", $errno, $error, 15, STREAM_CLIENT_CONNECT, $contexto);
    if (!$s) throw new RuntimeException("no hay conexión con $host ($error)");
    stream_set_timeout($s, 30);
    try {
        smtp_comando($s, null, [220], 'saludo');
        smtp_comando($s, 'EHLO ' . (gethostname() ?: 'genco'), [250], 'EHLO');
        smtp_comando($s, 'AUTH LOGIN', [334], 'AUTH');
        smtp_comando($s, base64_encode($usuario), [334], 'usuario');
        smtp_comando($s, base64_encode(str_replace(' ', '', $clave)), [235], 'contraseña');
        if ($para !== null && $mensaje !== null) {
            smtp_comando($s, "MAIL FROM:<$de>", [250], 'remitente');
            smtp_comando($s, "RCPT TO:<$para>", [250, 251], 'destinatario');
            smtp_comando($s, 'DATA', [354], 'DATA');
            $cuerpo = (string) preg_replace('/\r?\n/', "\r\n", $mensaje);
            $cuerpo = (string) preg_replace('/^\./m', '..', $cuerpo);
            fwrite($s, rtrim($cuerpo, "\r\n") . "\r\n.\r\n");
            smtp_comando($s, null, [250], 'envío');
        }
        fwrite($s, "QUIT\r\n");
    } finally {
        fclose($s);
    }
}

// Prueba la conexión con Gmail (para el instalador): inicia sesión sin mandar nada.
function verificar_mail(): void
{
    $g = config('gmail');
    smtp_enviar($g['servidor'] ?? 'smtp.gmail.com', (int) ($g['puerto'] ?? 465), $g['usuario'], $g['clave_app'], $g['usuario'], null, null);
}

// ---------------------------------------------------------------- Diseño

// Para quien encuentra el mail en Spam: cómo hacer que los próximos lleguen a la bandeja de entrada.
function nota_spam(): string
{
    $r = remitente_mail();
    return '¿Te llegó a Spam o Correo no deseado? Marcalo como «No es spam» y agregá ' . ($r !== '' ? $r : 'esta dirección')
        . ' a tus contactos: así los próximos te llegan a la bandeja de entrada.';
}

// Diseño de los mails, con los logos y los colores de la página. Los textos ya vienen escapados.
function plantilla_mail(string $titulo, array $parrafos = [], string $bloques = '', ?array $boton = null, ?string $pie = null): string
{
    $p = implode('', array_map(fn ($x) => "<p style=\"margin:0 0 12px\">$x</p>", $parrafos));
    $b = $boton ? "<p style=\"margin:26px 0 22px;text-align:center\"><a href=\"" . esc($boton['url']) . "\" style=\"display:inline-block;padding:13px 26px;background:#253883;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:bold\">{$boton['texto']}</a></p>" : '';
    $pi = $pie ? "<p style=\"margin:0;font-size:13px;color:#5d6680\">$pie</p>" : '';
    $spam = '<p style="margin:16px 0 0;padding:10px 12px;border-radius:10px;background:#fff4e0;color:#8a4b00;font-size:12px">' . esc(nota_spam()) . '</p>';
    return <<<HTML
<div style="background:#f3f5fa;padding:32px 12px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e7f1">
    <div style="padding:22px 28px;border-bottom:4px solid #253883">
      <img src="cid:logo-genco" alt="Grupo Genco" height="44" style="display:block">
    </div>
    <div style="padding:28px;color:#121a33;font-size:15px;line-height:1.55">
      <h1 style="font-size:20px;margin:0 0 14px;color:#121a33">$titulo</h1>
      $p
      $bloques
      $b
      $pi
      $spam
    </div>
  </div>
  <div style="text-align:center;margin:18px 0 0">
    <img src="cid:logo-stellantis" alt="Stellantis" height="14" style="opacity:.6">
    <p style="color:#8a93a8;font-size:12px;margin:8px 0 0">Grupo Genco · Siniestros</p>
  </div>
</div>
HTML;
}
