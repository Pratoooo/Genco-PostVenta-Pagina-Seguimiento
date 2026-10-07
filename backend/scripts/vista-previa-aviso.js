// Genera cómo se ve el mail de novedades de un pedido, sin mandarlo.
// Uso:  npm run vista-previa-aviso -- SIN-2002     (crea data/vista-previa-aviso.html para abrir en el navegador)
//       npm run vista-previa-aviso -- SIN-2002 tu-email@ejemplo.com   (además lo manda a ese email, para probar)
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/conexion.js';
import { archivosLogos, enviarMail } from '../lib/mailer.js';
import { armarMail } from '../servicios/avisosPedido.js';
import * as pedidos from '../modelos/pedidos.js';

const [siniestro, emailPrueba] = process.argv.slice(2);
const fila = siniestro && db.prepare('SELECT id FROM pedidos WHERE siniestro = ?').get(siniestro);
if (!fila) {
  console.error('Indicá un número de siniestro existente, por ejemplo: npm run vista-previa-aviso -- SIN-2002');
  process.exit(1);
}

const p = pedidos.obtener(fila.id);
// Para la vista previa se usan como "novedades" las últimas 4 del historial.
const novedades = db.prepare('SELECT descripcion, fecha FROM eventos WHERE pedido_id = ? ORDER BY id DESC LIMIT 4').all(p.id).reverse();
const mail = armarMail(pedidos.seguimiento(p), novedades, { email: emailPrueba || 'taller@ejemplo.com', nombre: 'Taller Norte' });

// En el archivo las imágenes van embebidas (en el mail real van adjuntas).
let html = mail.html;
for (const logo of archivosLogos) {
  html = html.replaceAll(`cid:${logo.cid}`, `data:image/png;base64,${fs.readFileSync(logo.path).toString('base64')}`);
}
const salida = path.join(config.dirDatos, 'vista-previa-aviso.html');
fs.writeFileSync(salida, `<!doctype html><meta charset="utf-8"><title>${mail.asunto}</title><body style="margin:0">${html}`);
console.log(`Asunto: ${mail.asunto}\nVista previa: ${salida}`);

if (emailPrueba) {
  await enviarMail(mail);
  console.log(`Mail de prueba enviado a ${emailPrueba}.`);
}
