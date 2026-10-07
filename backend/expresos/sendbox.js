// Lector de Sendbox.
//
// Sendbox no tiene API (dicen que va a salir más adelante): este lector entra a su sistema web con
// la cuenta de Genco, como lo haría una persona, y lee el estado de cada guía en "Envios Consulta".
// Cuando publiquen la API se reemplaza solo este archivo; el resto de la página queda igual.
//
// Cómo funciona la pantalla de Sendbox (sistema hecho en GeneXus): al cambiar un filtro y salir del
// campo (Tab) se actualiza la tabla sola. Enter NO busca: manda el formulario entero y cierra la sesión.
import { chromium } from 'playwright';
import { config } from '../config.js';

const BASE = 'https://sendboxbfg.com.ar/BFG/';
const ESPERA_MS = 30_000;

export const configurado = () => Boolean(config.sendbox.usuario && config.sendbox.clave);

// "Z-0325-00000507" (también "0325-507") -> { punto: '0325', numero: '00000507' }
export function partesGuia(guia) {
  const m = String(guia ?? '').match(/(\d{1,4})\D+(\d{1,8})\s*$/);
  if (!m) return null;
  return { punto: m[1].padStart(4, '0'), numero: m[2].padStart(8, '0') };
}

const clave = ({ punto, numero }) => `${punto}-${numero}`;

// Sendbox usa fechas "dd/mm/aa".
const fechaSendbox = (fecha) =>
  fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });

// Consulta varias guías en una sola visita. `desde`: fecha mínima de búsqueda (Sendbox filtra por fecha de envío).
// Devuelve un Map: guía -> fila de Sendbox ({ numero, estado, tracking, fechaTracking, ubicacion, fechaEntrega }),
// { noEncontrada: true } o { error }.
export async function consultarGuias(guias, { desde }) {
  const navegador = await chromium.launch();
  try {
    const pagina = await navegador.newPage();
    pagina.setDefaultTimeout(ESPERA_MS);
    await iniciarSesion(pagina);

    await pagina.goto(`${BASE}guia.guiaconsultacliente.aspx`);
    if (/login\.aspx/i.test(pagina.url())) throw new Error('Sendbox cerró la sesión al abrir la consulta de envíos');
    await completarFiltro(pagina, '#vGUIAFECHADESDE', fechaSendbox(desde));
    await completarFiltro(pagina, '#vGUIAFECHAHASTA', fechaSendbox(new Date()));

    const resultados = new Map();
    for (const guia of guias) {
      const partes = partesGuia(guia);
      if (!partes) {
        resultados.set(guia, { error: 'El número de guía no tiene el formato de Sendbox (ej: Z-0325-00000507)' });
        continue;
      }
      await completarFiltro(pagina, '#vGUIAPUNTO', partes.punto);
      await completarFiltro(pagina, '#vGUIANUMERO', partes.numero);
      resultados.set(guia, (await leerFila(pagina, clave(partes))) ?? { noEncontrada: true });
    }
    return resultados;
  } finally {
    await navegador.close();
  }
}

async function iniciarSesion(pagina) {
  await pagina.goto(`${BASE}login.aspx`);
  await pagina.fill('#vUSERNAME', config.sendbox.usuario);
  await pagina.fill('#vUSERPASSWORD', config.sendbox.clave);
  try {
    await Promise.all([
      pagina.waitForURL((url) => !/login\.aspx/i.test(url.href), { timeout: ESPERA_MS }),
      pagina.click('#BTNENTER'),
    ]);
  } catch {
    throw new Error('No se pudo iniciar sesión en Sendbox. Revisá SENDBOX_USUARIO y SENDBOX_CLAVE en el archivo .env');
  }
}

// Escribe un filtro y sale del campo con Tab, que es lo que hace actualizar la tabla de Sendbox.
async function completarFiltro(pagina, selector, valor) {
  if ((await pagina.inputValue(selector)) === valor) return;
  const actualizacion = pagina
    .waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('guiaconsultacliente.aspx'), { timeout: ESPERA_MS })
    .catch(() => null);
  await pagina.fill(selector, valor);
  await pagina.press(selector, 'Tab');
  await actualizacion;
  await pagina.waitForLoadState('networkidle').catch(() => {});
}

// Busca en la tabla de resultados la fila de la guía y devuelve sus columnas útiles.
function leerFila(pagina, claveGuia) {
  return pagina.evaluate((claveGuia) => {
    const tabla = document.getElementById('Grid1ContainerTbl');
    if (!tabla) return null;
    const columnas = [...tabla.rows[0].cells].map((c) => c.textContent.trim());
    const soloDigitos = (s) => s.replace(/\D+/g, '');
    for (const fila of tabla.querySelectorAll('tr[id^=Grid1ContainerRow]')) {
      const celda = (nombre) => fila.cells[columnas.indexOf(nombre)]?.textContent.trim() ?? '';
      const numero = celda('Numero Guia');
      if (!soloDigitos(numero).endsWith(soloDigitos(claveGuia))) continue;
      return {
        numero,
        estado: celda('Estado'),
        tracking: celda('Estado Tracking'),
        fechaTracking: celda('Fecha Estado Tracking'),
        ubicacion: celda('PSB/CL Actual'),
        fechaEntrega: celda('Fecha Entrega'),
      };
    }
    return null;
  }, claveGuia);
}

// ---------------------------------------------------------------- Traducción a nuestros estados

const normal = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

// "CENTRO LOGISTICO MENDOZA" -> "Centro logístico Mendoza"
function lugar(texto) {
  const t = String(texto ?? '').trim();
  if (!t || t === '-') return '';
  return t.toLowerCase()
    .replace(/(^|\s)\S/g, (l) => l.toUpperCase())
    .replace(/^Centro Logistico\b/, 'Centro logístico');
}

const conLugar = (texto, ubicacion) => [texto, lugar(ubicacion)].filter(Boolean).join(' · ');

// Lo que dice Sendbox -> { estado_viaje, entrega } para nuestro envío, o { aviso } si hay que revisarlo.
export function interpretar(fila) {
  const estado = normal(fila.estado);
  const tracking = normal(fila.tracking);
  if (estado === 'ENTREGADA' || tracking === 'ENTREGADO') return { entrega: 'recibido' };
  if (estado === 'ANULADA' || tracking === 'ANULADO') return { aviso: 'Sendbox figura la guía como anulada' };
  if (estado.startsWith('DEVOLUCION') || tracking.startsWith('DEVOLUCION')) {
    return { aviso: 'Sendbox informa una devolución', estado_viaje: 'En devolución', entrega: 'en_camino' };
  }
  if (tracking === 'CL DESTINO') return { estado_viaje: conLugar('En centro logístico de destino', fila.ubicacion), entrega: 'en_camino' };
  if (estado === 'EN REPARTO' || tracking.includes('REPARTO')) return { estado_viaje: 'En reparto', entrega: 'en_camino' };
  if (estado === 'EN TRANSITO' || tracking.includes('TRANSITO')) return { estado_viaje: conLugar('En tránsito', fila.ubicacion), entrega: 'en_camino' };
  if (estado === 'EN DEPOSITO' || tracking.includes('DEPOSITO')) return { estado_viaje: conLugar('En depósito', fila.ubicacion), entrega: 'en_camino' };
  // Cualquier otro estado: se muestra tal cual lo informa Sendbox.
  const texto = fila.tracking || fila.estado;
  if (!texto || texto === '-') return {};
  return { estado_viaje: conLugar(texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase(), fila.ubicacion), entrega: 'en_camino' };
}
