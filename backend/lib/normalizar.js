// Limpieza y validación de los datos que llegan de los formularios.

export const texto = (s) => String(s ?? '').trim();

export const email = (s) => String(s ?? '').trim().toLowerCase();

export const esEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// "ab 123-cd" -> "AB123CD"
export const patente = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Compañías de un perito: "la segunda,  Zurich, La Segunda" -> "la segunda, Zurich"
export function companias(s) {
  const unicas = new Map();
  for (const c of String(s ?? '').split(',').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean)) {
    if (!unicas.has(sinAcentos(c))) unicas.set(sinAcentos(c), c);
  }
  return [...unicas.values()].join(', ');
}

export const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
