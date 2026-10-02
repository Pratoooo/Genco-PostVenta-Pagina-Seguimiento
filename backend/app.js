// Arma la aplicación: API en /api y el frontend como archivos estáticos.
import express from 'express';
import { config } from './config.js';
import { manejarErrores, noEncontrado } from './lib/errores.js';
import rutasPublicas from './rutas/publico.js';
import rutasAuth from './rutas/auth.js';
import rutasPortal from './rutas/portal.js';
import rutasAdmin from './rutas/admin.js';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json());

  // ---- API
  app.use('/api', rutasPublicas);
  app.use('/api/auth', rutasAuth);
  app.use('/api/mis-pedidos', rutasPortal);
  app.use('/api/admin', rutasAdmin);
  app.use('/api', noEncontrado);

  // ---- Frontend (al entrar a la página se pide iniciar sesión)
  app.get('/', (req, res) => res.redirect('/login'));
  app.use(express.static(config.dirFrontend, { extensions: ['html'], index: false }));

  app.use(manejarErrores);
  return app;
}
