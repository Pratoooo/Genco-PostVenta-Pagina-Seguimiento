// Limpieza y validación de los datos que llegan de los formularios.

export const texto = (s) => String(s ?? '').trim();

export const email = (s) => String(s ?? '').trim().toLowerCase();

export const esEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// "ab 123-cd" -> "AB123CD"
export const patente = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
