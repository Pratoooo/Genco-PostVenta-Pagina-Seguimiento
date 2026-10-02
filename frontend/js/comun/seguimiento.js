// Tarjeta de seguimiento de un pedido: datos, puntos de estado e historial.
// La usan la consulta pública, "Mis pedidos" y la vista previa del panel admin.
import { esc, fecha, icono, pillEstado } from './ui.js';

const ICONO_ETAPA = ['origen', 'despacho', 'expreso', 'entrega'];

export function renderSeguimiento(s) {
  const etapas = s.etapas
    .map((e, i) => {
      const estado = i < s.etapa_actual ? 'done' : i === s.etapa_actual ? 'current' : '';
      const final = i === s.etapas.length - 1 ? ' final' : '';
      return `<li class="step ${estado}${final}" ${estado === 'current' ? 'aria-current="step"' : ''}>
        <div class="dot">${icono(ICONO_ETAPA[i])}</div>
        <div class="txt"><div class="t">${esc(e.titulo)}</div>${e.detalle ? `<div class="d">${esc(e.detalle)}</div>` : ''}</div>
      </li>`;
    })
    .join('');

  const p = s.pedido;
  const dato = (k, v) => (v || v === 0 ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
  return `
    <article class="card">
      <header class="result-head">
        <div><div class="label">Siniestro</div><h2>${esc(p.siniestro)}</h2></div>
        ${pillEstado(s)}
      </header>
      <dl class="chips">
        ${dato('Patente', p.patente)}${dato('Vehículo', p.vehiculo)}${dato('Taller', p.taller)}
        ${dato('Perito', p.perito)}${dato('Compañía', p.compania)}${dato('Piezas', p.cantidad_piezas)}
      </dl>
      <ol class="stepper" aria-label="Estado del pedido">${etapas}</ol>
      ${s.estado_viaje && !s.recibido ? `<div class="viaje">${icono('expreso')}<span><strong>Estado del viaje:</strong> ${esc(s.estado_viaje)}</span></div>` : ''}
      <p class="updated">Última actualización: ${fecha(s.actualizado)}</p>
    </article>
    <article class="card">
      <h3>Historial</h3>
      <ul class="timeline">${s.eventos.map((ev) => `<li><time>${fecha(ev.fecha)}</time>${esc(ev.descripcion)}</li>`).join('')}</ul>
    </article>`;
}
