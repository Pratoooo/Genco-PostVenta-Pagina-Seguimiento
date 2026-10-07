// Envío de mails por Gmail (GMAIL_USUARIO y GMAIL_CLAVE_APP en .env).
// Sin configurar, el contenido del mail se muestra en la consola del servidor.
import nodemailer from 'nodemailer';
import path from 'node:path';
import { config } from '../config.js';

const { usuario, claveApp } = config.gmail;

export const mailConfigurado = Boolean(usuario && claveApp);

const transporte = mailConfigurado
  ? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: usuario, pass: claveApp },
      // Si Gmail no responde, se corta en vez de dejar colgado el pedido de quien está esperando.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    })
  : null;

const REMITENTE = `"Grupo Genco Siniestros" <${usuario}>`;

// Los logos van adjuntos dentro del mail (cid), así se ven aunque el lector bloquee imágenes externas.
const LOGOS = [
  { filename: 'genco.png', path: path.join(config.dirFrontend, 'img', 'genco.png'), cid: 'logo-genco' },
  { filename: 'stellantis.png', path: path.join(config.dirFrontend, 'img', 'stellantis.png'), cid: 'logo-stellantis' },
];
export const archivosLogos = LOGOS;

function explicarError(err) {
  if (err.code === 'EAUTH') {
    return 'Gmail rechazó el usuario o la contraseña de aplicación. Revisá GMAIL_USUARIO y GMAIL_CLAVE_APP ' +
      '(tiene que ser una contraseña de aplicación, no la contraseña normal de la cuenta)';
  }
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS'].includes(err.code)) return 'no hay conexión con smtp.gmail.com';
  return err.message;
}

// Prueba la conexión con Gmail, para enterarse al arrancar y no cuando alguien pide recuperar su contraseña.
export async function verificarMail() {
  if (!transporte) {
    console.warn('⚠ Gmail sin configurar (GMAIL_USUARIO y GMAIL_CLAVE_APP en .env): los mails se muestran en esta consola.');
    return false;
  }
  try {
    await transporte.verify();
    console.log(`✓ Gmail listo: los mails salen desde ${usuario}`);
    return true;
  } catch (err) {
    console.error(`✗ No se pueden enviar mails: ${explicarError(err)}.`);
    return false;
  }
}

export async function enviarMail({ para, asunto, texto, html }) {
  if (!transporte) {
    console.log(`\n✉ [mail no enviado — Gmail sin configurar]\nPara: ${para}\nAsunto: ${asunto}\n\n${texto}\n`);
    return;
  }
  try {
    await transporte.sendMail({
      from: REMITENTE,
      to: para,
      subject: asunto,
      text: texto,
      html,
      attachments: html ? LOGOS : [],
    });
  } catch (err) {
    throw new Error(explicarError(err));
  }
}

// Diseño de los mails, con los logos y los colores de la página. Los textos ya vienen escapados.
//   parrafos: textos simples. bloques: HTML propio (tablas de estado, envíos...). boton: { url, texto }.
export function plantillaMail({ titulo, parrafos = [], bloques = '', boton, pie }) {
  return `<div style="background:#f3f5fa;padding:32px 12px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e7f1">
    <div style="padding:22px 28px;border-bottom:4px solid #253883">
      <img src="cid:logo-genco" alt="Grupo Genco" height="44" style="display:block">
    </div>
    <div style="padding:28px;color:#121a33;font-size:15px;line-height:1.55">
      <h1 style="font-size:20px;margin:0 0 14px;color:#121a33">${titulo}</h1>
      ${parrafos.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join('')}
      ${bloques}
      ${boton ? `<p style="margin:26px 0 22px;text-align:center"><a href="${boton.url}" style="display:inline-block;padding:13px 26px;background:#253883;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:bold">${boton.texto}</a></p>` : ''}
      ${pie ? `<p style="margin:0;font-size:13px;color:#5d6680">${pie}</p>` : ''}
    </div>
  </div>
  <div style="text-align:center;margin:18px 0 0">
    <img src="cid:logo-stellantis" alt="Stellantis" height="14" style="opacity:.6">
    <p style="color:#8a93a8;font-size:12px;margin:8px 0 0">Grupo Genco · Siniestros</p>
  </div>
</div>`;
}
