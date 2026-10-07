// Punto de entrada: prepara la base, verifica Gmail, arranca la lectura de Sendbox y los avisos por
// mail, y levanta el servidor.
import { config } from './config.js';
import { asegurarAdmin } from './modelos/usuarios.js';
import { verificarMail, enviarMail } from './lib/mailer.js';
import { registrar, configurarAlertas } from './lib/registroSeguridad.js';
import { iniciarLecturaPeriodica } from './servicios/seguimientoSendbox.js';
import { iniciarAvisos } from './servicios/avisosPedido.js';
import { crearApp } from './app.js';

configurarAlertas(enviarMail);

// Errores que se escapan de todo (OWASP A10): quedan registrados y llega una alerta por mail.
process.on('unhandledRejection', (err) => {
  console.error('Error no controlado:', err);
  registrar('error_no_controlado', { mensaje: String(err?.message ?? err).slice(0, 300) }, null, 'alerta');
});
// Después de una excepción no controlada no es seguro seguir: se registra y se cierra, para que el
// administrador de procesos (pm2, servicio de Windows...) la vuelva a levantar limpia.
process.on('uncaughtException', (err) => {
  console.error('Excepción no controlada, el servidor se reinicia:', err);
  registrar('excepcion_no_controlada', { mensaje: String(err?.message ?? err).slice(0, 300) }, null, 'alerta');
  setTimeout(() => process.exit(1), 3000);
});

if (!config.sesion.cookieSegura) {
  console.warn('⚠ La página no usa https (APP_URL): está bien para probar en esta computadora, no para publicarla.');
}

asegurarAdmin();

crearApp().listen(config.puerto, () => {
  console.log(`Genco Siniestros escuchando en http://localhost:${config.puerto}`);
  verificarMail();
  iniciarLecturaPeriodica();
  iniciarAvisos();
});
