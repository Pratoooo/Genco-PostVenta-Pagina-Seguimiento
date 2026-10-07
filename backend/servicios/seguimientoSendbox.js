// Lectura periódica de Sendbox: cada N minutos consulta los envíos de Sendbox que no llegaron y
// actualiza su estado en la página. El panel admin muestra el resultado de la última lectura.
import { config } from '../config.js';
import * as sendbox from '../expresos/sendbox.js';
import * as pedidos from '../modelos/pedidos.js';

const DIA_MS = 24 * 60 * 60 * 1000;

const estado = {
  leyendo: false,
  ultimaLectura: null,
  consultados: 0,
  actualizados: 0,
  error: null,
  // Envíos que alguien tiene que revisar (guía anulada, devolución, no encontrada...).
  avisos: [],
};

export const estadoLectura = () => ({
  configurado: sendbox.configurado(),
  intervaloMin: config.sendbox.intervaloMin,
  ...estado,
});

export async function leerSendbox() {
  if (!sendbox.configurado() || estado.leyendo) return estadoLectura();
  estado.leyendo = true;
  try {
    const pendientes = pedidos.enviosPendientes('sendbox');
    const avisos = [];
    let actualizados = 0;
    if (pendientes.length) {
      // Sendbox filtra por fecha de envío: se busca desde 60 días antes del envío pendiente más viejo.
      const masViejo = Math.min(...pendientes.map((e) => Date.parse(`${e.created_at.replace(' ', 'T')}Z`)));
      const resultados = await sendbox.consultarGuias([...new Set(pendientes.map((e) => e.guia))], {
        desde: new Date(masViejo - 60 * DIA_MS),
      });
      for (const envio of pendientes) {
        const fila = resultados.get(envio.guia);
        const aviso = (texto) => avisos.push({ pedido_id: envio.pedido_id, siniestro: envio.siniestro, guia: envio.guia, texto });
        if (fila?.error) aviso(fila.error);
        else if (fila?.noEncontrada) aviso('No se encontró la guía en Sendbox. Revisá el número cargado.');
        else if (fila) {
          const cambio = sendbox.interpretar(fila);
          if (cambio.aviso) aviso(cambio.aviso);
          if (pedidos.actualizarEnvioDesdeExpreso(envio.id, cambio)) actualizados++;
        }
      }
    }
    Object.assign(estado, { consultados: pendientes.length, actualizados, avisos, error: null });
    if (actualizados) console.log(`Sendbox: ${actualizados} envío(s) actualizado(s).`);
  } catch (err) {
    estado.error = err.message;
    console.error(`✗ Lectura de Sendbox: ${err.message}`);
  } finally {
    estado.ultimaLectura = new Date().toISOString();
    estado.leyendo = false;
  }
  return estadoLectura();
}

export function iniciarLecturaPeriodica() {
  if (!sendbox.configurado()) {
    console.warn('⚠ Sendbox sin configurar (SENDBOX_USUARIO y SENDBOX_CLAVE en .env): los envíos de Sendbox se actualizan a mano.');
    return;
  }
  console.log(`✓ Lectura automática de Sendbox cada ${config.sendbox.intervaloMin} minutos.`);
  setTimeout(leerSendbox, 20_000);
  setInterval(leerSendbox, config.sendbox.intervaloMin * 60_000);
}
