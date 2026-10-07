import { HttpError } from './errores.js';

const todos = new Set();

// Límite simple en memoria: como mucho `max` eventos por clave dentro de la ventana de tiempo.
export function limitador(max, ventanaMs, mensaje) {
  const registros = new Map();
  const vigente = (clave) => {
    const r = registros.get(clave);
    if (r && Date.now() - r.desde > ventanaMs) registros.delete(clave);
    return registros.get(clave);
  };
  const l = {
    excedido: (clave) => (vigente(clave)?.n ?? 0) >= max,
    controlar(clave) {
      if (this.excedido(clave)) throw new HttpError(429, mensaje);
    },
    sumar(clave) {
      const r = vigente(clave) ?? { n: 0, desde: Date.now() };
      r.n++;
      registros.set(clave, r);
    },
    limpiar: (clave) => registros.delete(clave),
    // Saca las ventanas vencidas, para que la memoria no crezca con cada IP que pasa.
    podar() {
      const ahora = Date.now();
      for (const [clave, r] of registros) if (ahora - r.desde > ventanaMs) registros.delete(clave);
    },
  };
  todos.add(l);
  return l;
}

export const MINUTO = 60 * 1000;

setInterval(() => todos.forEach((l) => l.podar()), 5 * MINUTO).unref();
