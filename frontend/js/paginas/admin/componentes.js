// Componentes de formulario del panel: buscador (para elegir taller o perito) y etiquetas (compañías).
import { esc, sinAcentos } from '../../comun/ui.js';

// Resalta la parte que coincide con lo buscado (sin importar acentos ni mayúsculas).
function resaltar(texto, q) {
  const i = q ? sinAcentos(texto).indexOf(q) : -1;
  if (i < 0) return esc(texto);
  return esc(texto.slice(0, i)) + `<mark>${esc(texto.slice(i, i + q.length))}</mark>` + esc(texto.slice(i + q.length));
}

// Buscador: se escribe parte del nombre y se elige de la lista (con el mouse o con flechas + Enter).
// Si se escribe algo y no se elige nada, queda lo que estaba asignado; para quitarlo está la ×.
export function crearCombo(raiz, { lista, titulo, detalle, buscarEn }) {
  const input = raiz.querySelector('input[type=text]');
  const oculto = raiz.querySelector('input[type=hidden]');
  const ul = raiz.querySelector('ul');
  const quitar = raiz.querySelector('.combo-quitar');
  let elegido = null;
  let resultados = [];
  let activo = -1;
  let q = '';

  function pintar() {
    ul.innerHTML = resultados.length
      ? resultados.map((u, i) => `<li role="option" id="${ul.id}-${i}" data-i="${i}" aria-selected="${i === activo}">
          <span>${resaltar(titulo(u), q)}</span>${detalle(u) ? `<small>${esc(detalle(u))}</small>` : ''}</li>`).join('')
      : '<li class="vacio">No se encontró. Revisá el nombre o creá el usuario.</li>';
    input.setAttribute('aria-activedescendant', activo >= 0 ? `${ul.id}-${activo}` : '');
  }
  function abrir(texto = input.value) {
    q = sinAcentos(texto.trim());
    resultados = lista().filter((u) => !q || buscarEn(u).some((t) => sinAcentos(t).includes(q))).slice(0, 50);
    activo = resultados.length ? 0 : -1;
    pintar();
    ul.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  }
  function cerrar() {
    ul.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
  }
  function elegir(u) {
    elegido = u;
    oculto.value = u ? u.id : '';
    input.value = u ? titulo(u) : '';
    quitar.classList.toggle('hidden', !u);
    cerrar();
  }

  input.addEventListener('focus', () => {
    input.select();
    abrir('');
  });
  input.addEventListener('input', () => abrir());
  input.addEventListener('keydown', (ev) => {
    const abierto = !ul.classList.contains('hidden');
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!abierto) return abrir();
      if (!resultados.length) return;
      activo = (activo + (ev.key === 'ArrowDown' ? 1 : -1) + resultados.length) % resultados.length;
      pintar();
      ul.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter' && abierto) {
      ev.preventDefault();
      if (resultados[activo]) elegir(resultados[activo]);
    } else if (ev.key === 'Escape') {
      cerrar();
    }
  });
  // mousedown: se elige antes de que el campo pierda el foco.
  ul.addEventListener('mousedown', (ev) => {
    const li = ev.target.closest('li[data-i]');
    ev.preventDefault();
    if (li) elegir(resultados[li.dataset.i]);
  });
  input.addEventListener('blur', () => elegir(elegido));
  quitar.addEventListener('click', () => {
    elegir(null);
    input.focus();
  });

  return { set: (id) => elegir(lista().find((u) => String(u.id) === String(id)) ?? null) };
}

// Etiquetas: se escribe un valor y Enter (o se elige de las sugerencias) y queda como etiqueta con ×.
export function crearEtiquetas(raiz, sugerencias = []) {
  const input = raiz.querySelector('input');
  let valores = [];

  function pintar() {
    raiz.querySelectorAll('.chip').forEach((c) => c.remove());
    valores.forEach((v, i) => input.insertAdjacentHTML('beforebegin',
      `<span class="chip">${esc(v)}<button type="button" data-i="${i}" aria-label="Quitar ${esc(v)}">×</button></span>`));
  }
  function agregar(texto) {
    for (const v of texto.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean)) {
      if (!valores.some((x) => sinAcentos(x) === sinAcentos(v))) valores.push(v);
    }
    input.value = '';
    pintar();
  }

  input.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ',') && input.value.trim()) {
      ev.preventDefault();
      agregar(input.value);
    } else if (ev.key === 'Backspace' && !input.value && valores.length) {
      valores.pop();
      pintar();
    }
  });
  // Elegir una sugerencia de la lista la agrega directo.
  input.addEventListener('input', (ev) => {
    if (ev.inputType === 'insertReplacementText' || (ev.inputType === undefined && sugerencias.includes(input.value))) {
      agregar(input.value);
    }
  });
  input.addEventListener('blur', () => input.value.trim() && agregar(input.value));
  raiz.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-i]');
    if (btn) {
      valores.splice(Number(btn.dataset.i), 1);
      pintar();
    }
    input.focus();
  });

  return {
    valor: () => valores.join(', '),
    set(texto) {
      valores = [];
      agregar(texto || '');
    },
  };
}
