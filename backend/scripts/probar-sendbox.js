// Prueba el lector de Sendbox sin tocar la base: entra con la cuenta de .env, busca las guías y
// muestra lo que leyó y cómo lo traduciría la página.
// Uso:  npm run probar-sendbox -- Z-0325-00000508 Z-0325-00000520
import * as sendbox from '../expresos/sendbox.js';

const guias = process.argv.slice(2);
if (!sendbox.configurado()) {
  console.error('✗ Falta completar SENDBOX_USUARIO y SENDBOX_CLAVE en el archivo .env');
  process.exit(1);
}
if (!guias.length) {
  console.error('Indicá al menos una guía, por ejemplo: npm run probar-sendbox -- Z-0325-00000508');
  process.exit(1);
}

try {
  console.log(`Entrando a Sendbox y buscando ${guias.length} guía(s)...`);
  const resultados = await sendbox.consultarGuias(guias, { desde: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) });
  for (const [guia, fila] of resultados) {
    console.log(`\n${guia}`);
    if (fila.error || fila.noEncontrada) {
      console.log(`  ✗ ${fila.error ?? 'No se encontró en Sendbox (último año)'}`);
      continue;
    }
    console.log(`  Sendbox:  ${fila.estado} · tracking ${fila.tracking} (${fila.fechaTracking}) · ${fila.ubicacion} · entrega ${fila.fechaEntrega}`);
    console.log('  Página:  ', sendbox.interpretar(fila));
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
