// Tarjeta de seguimiento de un pedido: datos, puntos de estado e historial.
// La usan la consulta pública, "Mis pedidos" y la vista previa del panel admin.
import { esc, fecha, icono, pillEstado } from './ui.js';

const ICONO_ETAPA = ['origen', 'despacho', 'expreso', 'entrega'];

// Cada envío con su remito, expreso, guía y estado. Con despacho parcial, aviso de que falta una parte.
function renderEnvios(s) {
  if (!s.envios.length) return '';
  const numerar = s.envios.length > 1 || s.despacho_parcial;
  const filas = s.envios.map((e, i) => `<li class="envio">
      <div class="envio-ico">${icono('expreso')}</div>
      <div class="envio-txt">
        <strong>${numerar ? `Envío ${i + 1}` : 'Envío'}</strong>
        <span>${esc([e.remito && `Remito ${e.remito}`, e.transporte, e.guia && `Guía ${e.guia}`].filter(Boolean).join(' · '))}</span>
        ${e.estado_viaje && !e.recibido ? `<span class="envio-viaje">Estado del viaje: ${esc(e.estado_viaje)}</span>` : ''}
      </div>
      ${pillEstado(e, true)}
    </li>`).join('');
  return `<ul class="envios" aria-label="Envíos">${filas}</ul>
    ${s.despacho_parcial ? '<p class="aviso-parcial">Se envió una parte del pedido. Lo que falta sale en otro envío, con su propio remito y número de guía.</p>' : ''}`;
}

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
      ${renderEnvios(s)}
      <p class="updated">Última actualización: ${fecha(s.actualizado)}</p>
    </article>
    <article class="card">
      <h3>Historial</h3>
      <ul class="timeline">${s.eventos.map((ev) => `<li><time>${fecha(ev.fecha)}</time>${esc(ev.descripcion)}</li>`).join('')}</ul>
    </article>`;
}
