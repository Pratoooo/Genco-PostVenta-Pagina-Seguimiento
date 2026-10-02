// Llamadas al backend. Los errores traen el mensaje para mostrar, el código HTTP (status) y,
// si corresponde, un código propio (por ejemplo "conflicto" cuando otra persona guardó antes).
export async function api(ruta, opciones = {}) {
  const res = await fetch(ruta, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...opciones.headers },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(datos.error || `Error ${res.status}`);
    err.status = res.status;
    err.codigo = datos.codigo;
    throw err;
  }
  return datos;
}

// Para páginas privadas: si la sesión se cerró (venció, o alguien cambió la contraseña de una
// cuenta compartida), vuelve al login avisando.
export async function apiPrivada(ruta, opciones) {
  try {
    return await api(ruta, opciones);
  } catch (err) {
    if (err.status === 401) location.replace('/login?sesion=cerrada');
    throw err;
  }
}
