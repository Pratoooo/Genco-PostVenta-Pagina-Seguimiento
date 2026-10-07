// Registro de eventos de seguridad (OWASP A09): ingresos, intentos fallidos, bloqueos, cambios de
// contraseña, cambios de cuentas y accesos denegados. Se guardan como líneas JSON en data/seguridad.log.
// Nunca se registran contraseñas, tokens ni cookies.
//
// Ante eventos graves (por ejemplo, una cuenta bloqueada por intentos fallidos) se manda además un
// mail de alerta a ALERTAS_EMAIL (por defecto, la cuenta de Gmail de la página), como mucho uno por hora
// por motivo, para no llenar la casilla.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const ARCHIVO = path.join(config.dirDatos, 'seguridad.log');
const ultimaAlerta = new Map();
const HORA_MS = 60 * 60 * 1000;
const TAMANO_MAXIMO = 5 * 1024 * 1024;
let escrituras = 0;

// Al pasar 5 MB el archivo se renombra a seguridad.log.1 (se guarda solo el anterior).
function rotarSiHaceFalta() {
  if (escrituras++ % 200 !== 0) return;
  try {
    if (fs.statSync(ARCHIVO).size > TAMANO_MAXIMO) fs.renameSync(ARCHIVO, `${ARCHIVO}.1`);
  } catch {
    // Todavía no existe: nada que rotar.
  }
}

// Para mandar alertas sin depender de cómo se importan los módulos (el mailer se carga después).
let enviarAlertaPorMail = null;
export const configurarAlertas = (fn) => (enviarAlertaPorMail = fn);

const ipDe = (req) => req?.ip ?? '';

// nivel: 'info' (normal) | 'aviso' (sospechoso) | 'alerta' (grave: además se avisa por mail)
export function registrar(evento, datos = {}, req = null, nivel = 'info') {
  const entrada = {
    fecha: new Date().toISOString(),
    nivel,
    evento,
    ip: ipDe(req),
    usuario: req?.usuario?.email,
    ...datos,
  };
  try {
    rotarSiHaceFalta();
    fs.appendFileSync(ARCHIVO, `${JSON.stringify(entrada)}\n`);
  } catch (err) {
    console.error(`No se pudo escribir el registro de seguridad: ${err.message}`);
  }
  if (nivel !== 'info') console.warn(`[seguridad] ${evento} ${JSON.stringify({ ...datos, ip: entrada.ip })}`);
  if (nivel === 'alerta') alertar(evento, entrada);
}

function alertar(evento, entrada) {
  const clave = `${evento}|${entrada.email ?? ''}|${entrada.ip}`;
  if (Date.now() - (ultimaAlerta.get(clave) ?? 0) < HORA_MS || !enviarAlertaPorMail) return;
  ultimaAlerta.set(clave, Date.now());
  const destino = process.env.ALERTAS_EMAIL || config.gmail.usuario;
  if (!destino) return;
  enviarAlertaPorMail({
    para: destino,
    asunto: `Alerta de seguridad — Genco Siniestros: ${evento}`,
    texto: `Se registró un evento de seguridad en la página:\n\n${JSON.stringify(entrada, null, 2)}\n\n`
      + 'Si no lo reconocés, revisá data/seguridad.log en el servidor.',
  }).catch((err) => console.error(`No se pudo mandar la alerta de seguridad: ${err.message}`));
}
