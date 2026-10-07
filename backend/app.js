// Arma la aplicación: API en /api y el frontend como archivos estáticos.
import express from 'express';
import { config } from './config.js';
import { manejarErrores, noEncontrado } from './lib/errores.js';
import { cabeceras, soloMismoSitio, sinCache, limiteGeneral } from './lib/seguridad.js';
import rutasPublicas from './rutas/publico.js';
import rutasAuth from './rutas/auth.js';
import rutasPortal from './rutas/portal.js';
import rutasAdmin from './rutas/admin.js';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  // Detrás de un proxy (nginx, Cloudflare...) hace falta para ver la IP real de cada visitante.
  app.set('trust proxy', config.trustProxy);
  app.use(cabeceras);

  // ---- API
  app.use('/api', sinCache, limiteGeneral, soloMismoSitio, express.json({ limit: '32kb' }));
  app.use('/api', rutasPublicas);
  app.use('/api/auth', rutasAuth);
  app.use('/api/mis-pedidos', rutasPortal);
  app.use('/api/admin', rutasAdmin);
  app.use('/api', noEncontrado);

  // ---- Frontend (al entrar a la página se pide iniciar sesión)
  app.get('/', (req, res) => res.redirect('/login'));
  app.use(express.static(config.dirFrontend, { extensions: ['html'], index: false, dotfiles: 'ignore' }));

  app.use(manejarErrores);
  return app;
}
