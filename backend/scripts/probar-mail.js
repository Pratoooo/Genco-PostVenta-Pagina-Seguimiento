// Manda un mail de prueba para confirmar que Gmail está bien configurado.
// Uso:  npm run probar-mail -- destino@ejemplo.com   (sin destino, se lo manda a la misma cuenta de Gmail)
import { config } from '../config.js';
import { mailConfigurado, verificarMail, enviarMail, plantillaMail } from '../lib/mailer.js';

const destino = process.argv[2] || config.gmail.usuario;

if (!mailConfigurado) {
  console.error('✗ Falta completar GMAIL_USUARIO y GMAIL_CLAVE_APP en el archivo .env (ver README).');
  process.exit(1);
}
if (!(await verificarMail())) process.exit(1);

try {
  await enviarMail({
    para: destino,
    asunto: 'Prueba de envío — Grupo Genco Siniestros',
    texto: 'Si recibiste este mail, los mails de recuperación de contraseña funcionan correctamente.',
    html: plantillaMail({
      titulo: 'Prueba de envío',
      parrafos: ['Si recibiste este mail, los mails de recuperación de contraseña funcionan correctamente.'],
      boton: { url: `${config.appUrl}/login`, texto: 'Ir a la página' },
    }),
  });
  console.log(`✓ Mail de prueba enviado a ${destino}. Revisá la bandeja de entrada (y la carpeta de spam).`);
} catch (err) {
  console.error(`✗ No se pudo enviar: ${err.message}`);
  process.exit(1);
}
