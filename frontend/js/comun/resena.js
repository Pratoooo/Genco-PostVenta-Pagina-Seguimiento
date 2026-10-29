// Reseña de pedidos: números por estado (que además sirven de filtro), filtros, lista y descarga a
// Excel. La usan el panel admin (todos los pedidos) y "Mis pedidos" (los del taller o el perito).
import { esc, fecha, fechaCorta, celda, sinAcentos } from './ui.js';

// "Hoy" según la computadora, como "AAAA-MM-DD" (igual que el plazo de entrega).
const hoy = () => new Date().toLocaleDateString('en-CA');
// Día local "AAAA-MM-DD" de una fecha de la base (UTC "AAAA-MM-DD HH:MM:SS").
const diaLocal = (s) => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleDateString('en-CA') : '');

export const plazoVencido = (p) => Boolean(p.plazo_entrega) && !p.recibido && p.plazo_entrega < hoy();

// Plazo de entrega en las listas. Con `marcar` (panel admin) resalta los vencidos y los que vencen hoy.
export function plazoHtml(p, marcar = false) {
  if (!p.plazo_entrega) return '<span class="muted">—</span>';
  const f = esc(fechaCorta(p.plazo_entrega));
  if (!marcar || p.recibido) return f;
  if (p.plazo_entrega < hoy()) return `${f} <span class="badge error">Vencido</span>`;
  if (p.plazo_entrega === hoy()) return `${f} <span class="badge pendiente">Vence hoy</span>`;
  return f;
}

// Listas desplegables de filtro: las opciones salen de los pedidos que hay.
export const FILTROS = {
  expreso: { clave: 'expreso', titulo: 'Expreso', valores: (p) => p.expresos },
  compania: { clave: 'compania', titulo: 'Compañía', valores: (p) => [p.compania] },
  taller: { clave: 'taller', titulo: 'Taller', valores: (p) => [p.taller] },
  perito: { clave: 'perito', titulo: 'Perito', valores: (p) => [p.perito] },
};

const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const ORDENES = {
  actualizado: ['Última actualización', (a, b) => cmp(b.updated_at, a.updated_at)],
  nuevos: ['Más nuevos primero', (a, b) => cmp(b.created_at, a.created_at)],
  viejos: ['Más viejos primero', (a, b) => cmp(a.created_at, b.created_at)],
  plazo: ['Entrega estimada más próxima', (a, b) => cmp(a.plazo_entrega || '9999', b.plazo_entrega || '9999')],
};

// Columnas del Excel (iguales para todos).
const EXPORTAR = [
  ['Siniestro', (p) => p.siniestro],
  ['Patente', (p) => p.patente],
  ['Vehículo', (p) => p.vehiculo],
  ['Taller', (p) => p.taller],
  ['Perito', (p) => p.perito],
  ['Compañía', (p) => p.compania],
  ['Estado', (p) => p.estado],
  ['Expreso', (p) => p.expresos.join(', ')],
  ['Guías', (p) => p.guias.join(', ')],
  ['Remitos', (p) => p.remitos.join(', ')],
  ['Entrega estimada', (p) => fechaCorta(p.plazo_entrega)],
  ['Plazo vencido', (p) => (plazoVencido(p) ? 'Sí' : '')],
  ['Alta', (p) => fecha(p.created_at)],
  ['Última actualización', (p) => fecha(p.updated_at)],
];

let instancias = 0;

/**
 * Arma la reseña dentro de `raiz`.
 *   columnas: [{ titulo, html: (pedido) => HTML ya escapado }]
 *   selects:  filtros desplegables (de FILTROS)
 *   vencidos: muestra el número y el filtro de "Plazo vencido" (panel admin)
 *   enlace:   (pedido) => dirección de su ficha ("#/pedidos/1")
 *   vacio:    texto cuando todavía no hay pedidos
 *   extrasExcel: columnas extra del Excel ([título, (pedido) => valor])
 * Devuelve { cargar(lista) } para cargar o actualizar los pedidos sin perder los filtros.
 */
export function crearResena(raiz, { columnas, selects = [], vencidos = false, enlace, vacio = 'No hay pedidos.', extrasExcel = [] }) {
  const exportar = [...EXPORTAR, ...extrasExcel];
  const id = `resena-${instancias++}`;
  const grupos = [['todos', 'Todos'], ['preparacion', 'En preparación'], ['en_camino', 'En camino'], ['recibido', 'Recibidos'],
    ...(vencidos ? [['vencido', 'Plazo vencido']] : [])];
  let pedidos = [];
  let grupo = 'todos';

  raiz.innerHTML = `
    <div class="resena-stats" role="group" aria-label="Filtrar por estado">
      ${grupos.map(([k, t]) => `<button type="button" class="stat stat-filtro${k === 'vencido' ? ' alerta' : ''}" data-grupo="${k}" aria-pressed="${k === 'todos'}">
          <span>${t}</span><strong data-cuenta="${k}">–</strong></button>`).join('')}
    </div>
    <div class="card">
      <div class="filtros">
        <div class="filtro-buscar">
          <label for="${id}-q">Buscar</label>
          <input id="${id}-q" type="search" data-f="q" autocomplete="off"
            placeholder="Siniestro, patente, vehículo, taller, perito, compañía, remito o guía">
        </div>
        <div class="mas-filtros">
          <button type="button" class="link-btn boton-filtros" aria-expanded="false">Más filtros</button>
          <div class="filtros-grilla">
            ${selects.map((s) => `<div><label for="${id}-${s.clave}">${s.titulo}</label>
              <select id="${id}-${s.clave}" data-f="${s.clave}"><option value="">Todos</option></select></div>`).join('')}
            <div><label for="${id}-desde">Cargados desde</label><input id="${id}-desde" type="date" data-f="desde"></div>
            <div><label for="${id}-hasta">Hasta</label><input id="${id}-hasta" type="date" data-f="hasta"></div>
            <div><label for="${id}-orden">Ordenar por</label><select id="${id}-orden" data-f="orden">
              ${Object.entries(ORDENES).map(([k, [t]]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
          </div>
        </div>
      </div>
      <div class="resena-barra">
        <span class="resena-cuenta" aria-live="polite"></span>
        <div class="resena-acciones">
          <button type="button" class="btn ghost hidden" data-limpiar>Limpiar filtros</button>
          <button type="button" class="btn outline" data-descargar>Descargar Excel</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="tabla-resp">
          <thead><tr>${columnas.map((c) => `<th>${esc(c.titulo)}</th>`).join('')}</tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;

  const campo = (clave) => raiz.querySelector(`[data-f="${clave}"]`);
  const tbody = raiz.querySelector('tbody');

  const leerFiltros = () => ({
    q: sinAcentos(campo('q').value.trim()),
    ...Object.fromEntries(selects.map((s) => [s.clave, campo(s.clave).value])),
    desde: campo('desde').value,
    hasta: campo('hasta').value,
    orden: campo('orden').value,
  });

  function coincide(p, f) {
    if (f.q) {
      const texto = sinAcentos([p.siniestro, p.patente, p.vehiculo, p.taller, p.perito, p.compania,
        ...p.expresos, ...p.remitos, ...p.guias].join(' '));
      if (!f.q.split(/\s+/).every((palabra) => texto.includes(palabra))) return false;
    }
    if (selects.some((s) => f[s.clave] && !s.valores(p).includes(f[s.clave]))) return false;
    const alta = diaLocal(p.created_at);
    if (f.desde && alta < f.desde) return false;
    if (f.hasta && alta > f.hasta) return false;
    return true;
  }
  const enGrupo = (p, g) => g === 'todos' || (g === 'vencido' ? plazoVencido(p) : p.grupo === g);

  // Las opciones de cada desplegable salen de los pedidos cargados (se conserva lo elegido).
  function actualizarOpciones() {
    for (const s of selects) {
      const sel = campo(s.clave);
      const elegido = sel.value;
      const valores = [...new Set(pedidos.flatMap(s.valores).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      sel.innerHTML = '<option value="">Todos</option>' +
        valores.map((v) => `<option value="${esc(v)}" ${v === elegido ? 'selected' : ''}>${esc(v)}</option>`).join('');
    }
  }

  let visibles = [];
  function pintar() {
    const f = leerFiltros();
    const filtrados = pedidos.filter((p) => coincide(p, f));
    for (const [k] of grupos) raiz.querySelector(`[data-cuenta="${k}"]`).textContent = filtrados.filter((p) => enGrupo(p, k)).length;
    visibles = filtrados.filter((p) => enGrupo(p, grupo)).sort(ORDENES[f.orden]?.[1] ?? ORDENES.actualizado[1]);

    const hayFiltros = Boolean(f.q || f.desde || f.hasta || selects.some((s) => f[s.clave]) || grupo !== 'todos');
    raiz.querySelector('[data-limpiar]').classList.toggle('hidden', !hayFiltros);
    raiz.querySelector('.resena-cuenta').textContent = pedidos.length
      ? `Mostrando ${visibles.length} de ${pedidos.length} ${pedidos.length === 1 ? 'pedido' : 'pedidos'}`
      : '';
    raiz.querySelector('[data-descargar]').disabled = !visibles.length;
    tbody.innerHTML = visibles.length
      ? visibles.map((p) => `<tr class="clickable${plazoVencido(p) && vencidos ? ' fila-vencida' : ''}" data-href="${esc(enlace(p))}">
          ${columnas.map((c) => celda(c.titulo, c.html(p))).join('')}</tr>`).join('')
      : `<tr><td colspan="${columnas.length}" class="empty">${pedidos.length ? 'Ningún pedido coincide con los filtros.' : esc(vacio)}</td></tr>`;
  }

  function descargar() {
    const valor = (v) => {
      let t = String(v ?? '');
      if (/^[=+\-@]/.test(t)) t = `'${t}`; // que Excel no lo tome como fórmula
      return `"${t.replace(/"/g, '""')}"`;
    };
    const lineas = [exportar.map(([t]) => valor(t)).join(';'),
      ...visibles.map((p) => exportar.map(([, f]) => valor(f(p))).join(';'))];
    // Con BOM y punto y coma, Excel en castellano lo abre con acentos y columnas bien.
    const blob = new Blob([`${String.fromCharCode(0xfeff)}${lineas.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pedidos-genco-${hoy()}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  raiz.querySelector('.resena-stats').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-grupo]');
    if (!b) return;
    grupo = b.dataset.grupo === grupo ? 'todos' : b.dataset.grupo;
    raiz.querySelectorAll('[data-grupo]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.grupo === grupo)));
    pintar();
  });
  raiz.addEventListener('input', (ev) => ev.target.matches('[data-f]') && pintar());
  raiz.addEventListener('change', (ev) => ev.target.matches('[data-f]') && pintar());
  raiz.querySelector('[data-limpiar]').addEventListener('click', () => {
    raiz.querySelectorAll('[data-f]').forEach((el) => (el.value = el.dataset.f === 'orden' ? 'actualizado' : ''));
    grupo = 'todos';
    raiz.querySelectorAll('[data-grupo]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.grupo === 'todos')));
    pintar();
  });
  raiz.querySelector('[data-descargar]').addEventListener('click', descargar);
  // En el celular los filtros extra se despliegan con un botón (en la computadora están siempre a la vista).
  raiz.querySelector('.boton-filtros').addEventListener('click', (ev) => {
    const abierto = raiz.querySelector('.mas-filtros').classList.toggle('abierto');
    ev.currentTarget.setAttribute('aria-expanded', String(abierto));
  });
  tbody.addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });

  return {
    cargar(lista) {
      pedidos = lista;
      actualizarOpciones();
      pintar();
    },
  };
}
