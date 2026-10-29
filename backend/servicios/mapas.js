// Destino de cada pedido en el mapa: busca la dirección (Georef, el servicio de direcciones del Estado
// argentino, y si no la encuentra OpenStreetMap) y calcula la distancia y el tiempo en auto desde Genco
// (OSRM). Son servicios gratuitos y sin clave: los resultados se guardan para no repetir consultas, y si
// no responden la página sigue funcionando (queda el enlace a Google Maps).
import { db } from '../db/conexion.js';
import { config } from '../config.js';

// OpenStreetMap pide identificar la aplicación y hacer como mucho una consulta por segundo.
const AGENTE = `GencoSiniestros/1.0 (${config.gmail.usuario || 'seguimiento de pedidos de siniestros'})`;
const ESPERA_ENTRE_CONSULTAS_MS = 1100;
// Una dirección que no se encontró se vuelve a buscar recién al día siguiente.
const REINTENTO_NO_ENCONTRADA_MS = 24 * 60 * 60 * 1000;

const clave = (direccion) => String(direccion ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const huella = (destino, origen) => `${clave(destino)}|${clave(origen)}`;

async function consultar(url, timeout = 8000) {
  const res = await fetch(url, { headers: { 'User-Agent': AGENTE, 'Accept-Language': 'es' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`el servicio de mapas respondió ${res.status}`);
  return res.json();
}

// De a una consulta por vez, con un segundo de separación.
let cola = Promise.resolve();
let ultima = 0;
function enCola(fn) {
  const tarea = cola.then(async () => {
    const espera = ultima + ESPERA_ENTRE_CONSULTAS_MS - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    try {
      return await fn();
    } finally {
      ultima = Date.now();
    }
  });
  cola = tarea.catch(() => {});
  return tarea;
}

// "Avenida San Martín 1200, Malargüe, Mendoza": cómo quedó ubicada la dirección en el mapa.
function lugarEncontrado(r) {
  const a = r.address ?? {};
  const calle = [a.road, a.house_number].filter(Boolean).join(' ');
  const ciudad = a.city || a.town || a.village || a.municipality || a.county;
  const lugar = [calle, ciudad, a.state].filter(Boolean).join(', ');
  return lugar || String(r.display_name ?? '').split(',').slice(0, 4).join(',').trim();
}

// Georef (servicio de direcciones del Estado argentino, datos.gob.ar): ubica calle y altura dentro de la
// localidad, mucho más preciso que OpenStreetMap para direcciones de Argentina. Se escribe
// "calle y número, ciudad, provincia"; reconoce mejor las abreviaturas ("Av.", "Bv."), así que si no
// encuentra la dirección tal cual, prueba abreviando.
const ABREVIATURAS = [[/^avenida\s/i, 'Av. '], [/^(bulevar|boulevard|boulevar)\s/i, 'Bv. '], [/^pasaje\s/i, 'Pje. '], [/^calle\s/i, '']];

async function ubicarConGeoref(direccion) {
  const [calle, localidad, provincia] = direccion.split(',').map((s) => s.trim()).filter((s) => s && !/^argentina$/i.test(s));
  if (!calle || !/\d/.test(calle)) return null; // Georef necesita la altura de la calle
  const abreviada = ABREVIATURAS.reduce((c, [re, a]) => c.replace(re, a), calle);
  const intentos = [{ calle, localidad, provincia }];
  if (abreviada !== calle) intentos.push({ calle: abreviada, localidad, provincia });
  for (const i of intentos) {
    const params = new URLSearchParams({ direccion: i.calle, max: '1' });
    if (i.localidad) params.set('localidad', i.localidad);
    if (i.provincia) params.set('provincia', i.provincia);
    const r = (await consultar(`https://apis.datos.gob.ar/georef/api/direcciones?${params}`, 10000)).direcciones?.[0];
    if (r?.ubicacion?.lat != null) return { lat: r.ubicacion.lat, lon: r.ubicacion.lon, lugar: r.nomenclatura ?? '' };
  }
  return null;
}

// OpenStreetMap: para lo que Georef no encuentra (por ejemplo, una dirección sin número).
async function ubicarConOpenStreetMap(direccion) {
  const texto = /argentina/i.test(direccion) ? direccion : `${direccion}, Argentina`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&countrycodes=ar&q=${encodeURIComponent(texto)}`;
  const [r] = await enCola(() => consultar(url));
  return r ? { lat: Number(r.lat), lon: Number(r.lon), lugar: lugarEncontrado(r) } : null;
}

// Coordenadas de una dirección ({ lat, lon, lugar }), o null si no aparece en el mapa.
export async function ubicar(direccion) {
  const k = clave(direccion);
  if (!k) return null;
  const guardada = db.prepare('SELECT lat, lon, lugar, encontrada, created_at FROM ubicaciones WHERE direccion = ?').get(k);
  if (guardada?.encontrada) return { lat: guardada.lat, lon: guardada.lon, lugar: guardada.lugar };
  if (guardada && Date.now() - Date.parse(`${guardada.created_at.replace(' ', 'T')}Z`) < REINTENTO_NO_ENCONTRADA_MS) return null;

  let punto = null;
  try {
    punto = await ubicarConGeoref(direccion);
  } catch (err) {
    console.warn(`Georef no respondió (${err.message}): se busca en OpenStreetMap.`);
  }
  punto ??= await ubicarConOpenStreetMap(direccion);
  db.prepare(`INSERT INTO ubicaciones (direccion, lat, lon, lugar, encontrada, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(direccion) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, lugar = excluded.lugar,
                encontrada = excluded.encontrada, created_at = excluded.created_at`)
    .run(k, punto?.lat ?? null, punto?.lon ?? null, punto?.lugar ?? '', punto ? 1 : 0);
  return punto;
}

// Distancia (km) y tiempo (minutos) en auto entre dos puntos, o null si no hay ruta.
async function ruta(a, b) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
  const r = await consultar(url, 10000);
  const mejor = r.code === 'Ok' && r.routes?.[0];
  return mejor ? { km: Math.round(mejor.distance / 100) / 10, minutos: Math.round(mejor.duration / 60) } : null;
}

// Genco: el punto exacto (GENCO_COORDENADAS) si está, si no la dirección (GENCO_DIRECCION).
const coordenadasGenco = () => config.genco.coordenadas;
const origenClave = () => {
  const c = coordenadasGenco();
  return c ? `${c.lat},${c.lon}` : config.genco.direccion;
};

// Lo que se muestra del destino de un pedido en el panel. "calculando" mientras la dirección guardada
// todavía no se buscó en el mapa (o cambió la dirección de Genco).
export function infoDestino(p) {
  const origen = config.genco.direccion || origenClave();
  // Para la ruta en Google Maps: el punto exacto de Genco si se conoce.
  const origenPunto = origenClave();
  if (!p.destino_direccion) return { estado: 'sin_direccion', origen, origen_punto: origenPunto };
  const vigente = p.destino_calculado === huella(p.destino_direccion, origenClave());
  return {
    direccion: p.destino_direccion,
    origen,
    origen_punto: origenPunto,
    estado: vigente ? p.destino_estado : 'calculando',
    lat: vigente ? p.destino_lat : null,
    lon: vigente ? p.destino_lon : null,
    lugar: vigente ? p.destino_lugar : '',
    km: vigente ? p.destino_km : null,
    minutos: vigente ? p.destino_minutos : null,
  };
}

const enCurso = new Map();

// Busca el destino del pedido en el mapa y calcula distancia y tiempo desde Genco. Solo consulta de nuevo
// si cambió alguna de las dos direcciones o si la vez anterior el servicio no respondió. Nunca falla.
export function calcularDestino(pedidoId) {
  if (!enCurso.has(pedidoId)) {
    enCurso.set(pedidoId, calcular(pedidoId)
      .catch((err) => console.warn(`No se pudo ubicar el destino del pedido ${pedidoId}: ${err.message}`))
      .finally(() => enCurso.delete(pedidoId)));
  }
  return enCurso.get(pedidoId);
}

async function calcular(pedidoId) {
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!p) return;
  const info = infoDestino(p);
  if (info.estado !== 'calculando' && info.estado !== 'error') return;
  const origen = origenClave();
  let datos;
  try {
    const destino = await ubicar(p.destino_direccion);
    if (!destino) {
      datos = { estado: 'no_encontrada' };
    } else if (!origen) {
      datos = { estado: 'sin_origen', ...destino };
    } else {
      const desde = coordenadasGenco() ?? await ubicar(origen);
      const r = desde ? await ruta(desde, destino) : null;
      datos = r ? { estado: 'ok', ...destino, ...r } : { estado: desde ? 'sin_ruta' : 'origen_no_encontrado', ...destino };
    }
  } catch (err) {
    console.warn(`No se pudo ubicar el destino del pedido ${p.id}: ${err.message}`);
    datos = { estado: 'error' };
  }
  // Solo datos calculados: no cambia la versión ni la fecha de actualización del pedido.
  db.prepare(`UPDATE pedidos SET destino_lat = ?, destino_lon = ?, destino_lugar = ?, destino_km = ?, destino_minutos = ?,
                destino_estado = ?, destino_calculado = ? WHERE id = ? AND destino_direccion = ?`)
    .run(datos.lat ?? null, datos.lon ?? null, datos.lugar ?? '', datos.km ?? null, datos.minutos ?? null, datos.estado,
      huella(p.destino_direccion, origen), p.id, p.destino_direccion);
}

// Pedidos con el destino sin calcular (por ejemplo, recién cargada la dirección de Genco): de a uno.
export async function recalcularDestinos() {
  const lista = db.prepare("SELECT * FROM pedidos WHERE destino_direccion <> ''").all();
  for (const p of lista) {
    const { estado } = infoDestino(p);
    if (estado === 'calculando' || estado === 'error') await calcularDestino(p.id);
  }
}

export function iniciarMapas() {
  // La dirección de Genco se busca al arrancar, así el primer cálculo de cada pedido es más rápido.
  if (coordenadasGenco()) {
    console.log(`✓ Genco en el mapa: ${config.genco.direccion || origenClave()}`);
  } else if (config.genco.direccion) {
    ubicar(config.genco.direccion)
      .then((p) => !p && console.warn(`⚠ No se encontró GENCO_DIRECCION en el mapa ("${config.genco.direccion}"): revisala.`))
      .catch(() => {});
  } else {
    console.warn('⚠ Falta GENCO_DIRECCION en .env: los pedidos se ubican en el mapa, pero sin distancia ni tiempo desde Genco.');
  }
  recalcularDestinos().catch(() => {});
  setInterval(() => recalcularDestinos().catch(() => {}), 30 * 60 * 1000).unref();
}
