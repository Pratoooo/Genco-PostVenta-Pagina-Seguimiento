// Limpieza y validación de los datos que llegan de los formularios (OWASP A05).
// Todo texto se recorta a un largo máximo y pierde los caracteres de control (saltos de línea, tabs,
// nulos...), que no tienen sentido en estos campos y podrían colarse en asuntos de mails o en logs.

// Cc: caracteres de control. Zl y Zp: separadores de línea y de párrafo de Unicode.
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

export const texto = (s, max = 200) => String(s ?? '').replace(CONTROL, ' ').trim().replace(/\s{2,}/g, ' ').slice(0, max);

export const email = (s) => String(s ?? '').replace(CONTROL, '').trim().toLowerCase().slice(0, 254);

export const esEmail = (s) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s);

// "ab 123-cd" -> "AB123CD"
export const patente = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

export const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
