// Punto de entrada: prepara la base, verifica Gmail y levanta el servidor.
import { config } from './config.js';
import { asegurarAdmin } from './modelos/usuarios.js';
import { verificarMail } from './lib/mailer.js';
import { crearApp } from './app.js';

asegurarAdmin();

crearApp().listen(config.puerto, () => {
  console.log(`Genco Siniestros escuchando en http://localhost:${config.puerto}`);
  verificarMail();
});
