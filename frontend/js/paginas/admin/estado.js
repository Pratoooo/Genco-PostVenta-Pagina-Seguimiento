// Datos compartidos por las secciones del panel: la cuenta que ingresó y las opciones de los formularios.
import { apiPrivada } from '../../comun/api.js';
import { esc } from '../../comun/ui.js';

export const estado = { yo: null, opciones: null };

const suscriptores = [];

// Registra una función que se llama cada vez que se cargan las opciones (listas, roles, pendientes).
export const alCargarOpciones = (fn) => suscriptores.push(fn);

export async function cargarOpciones() {
  estado.opciones = await apiPrivada('/api/admin/opciones');
  suscriptores.forEach((fn) => fn(estado.opciones));
}

// Rearma las opciones de un <select> conservando lo que estaba elegido.
export function llenarSelect(select, valores, vacio) {
  const actual = select.value;
  select.innerHTML = (vacio ? `<option value="">${vacio}</option>` : '') +
    Object.entries(valores).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  if ([...select.options].some((o) => o.value === actual)) select.value = actual;
}

// Botón para el aviso de error al guardar: si otra persona modificó lo mismo, ofrece recargar;
// si lo eliminó, volver a la lista.
export function avisoDeError(err, recargar, hashLista) {
  if (err.codigo === 'conflicto') return { texto: 'Recargar', alHacerClic: recargar };
  if (err.status === 404) return { texto: 'Volver a la lista', alHacerClic: () => (location.hash = hashLista) };
  return undefined;
}
