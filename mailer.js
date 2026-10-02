import nodemailer from 'nodemailer';

// Envío de mails por SMTP (configurar SMTP_* en .env).
// Sin configuración, el mail se muestra en la consola del servidor (útil para probar).
const configurado = Boolean(process.env.SMTP_HOST);

const transporte = configurado
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

if (!configurado) console.warn('⚠ SMTP no configurado: los mails de recuperación se muestran en esta consola.');

export async function enviarMail({ para, asunto, texto, html }) {
  if (!transporte) {
    console.log(`\n✉ [mail no enviado — SMTP sin configurar]\nPara: ${para}\nAsunto: ${asunto}\n\n${texto}\n`);
    return;
  }
  await transporte.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: para,
    subject: asunto,
    text: texto,
    html,
  });
}
