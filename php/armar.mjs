// Arma la carpeta y el .zip para subir al hosting (versión PHP): las pantallas (frontend/) + la API en PHP (php/).
//   node php/armar.mjs   ->  dist/genco-seguimiento-php/  y  dist/genco-seguimiento-php.zip
// Cada vez genera un código de instalación nuevo (lo pide instalar.php la primera vez).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const raiz = path.resolve(import.meta.dirname, '..');
const dist = path.join(raiz, 'dist');
const destino = path.join(dist, 'genco-seguimiento-php');
const zip = path.join(dist, 'genco-seguimiento-php.zip');

fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });
fs.cpSync(path.join(raiz, 'frontend'), destino, { recursive: true });
fs.cpSync(path.join(raiz, 'php', 'publico'), destino, { recursive: true });
fs.cpSync(path.join(raiz, 'php', 'privado'), path.join(destino, 'privado'), { recursive: true });

// Código de instalación: sin él nadie puede instalar la página antes que Genco. Se borra al instalar.
const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codigo = Array.from({ length: 3 }, () => Array.from(crypto.randomBytes(4), (b) => letras[b % letras.length]).join('')).join('-');
fs.writeFileSync(path.join(destino, 'privado', 'codigo-instalacion.php'),
  `<?php\n// Código para instalar la página (lo pide instalar.php). Se borra solo al terminar la instalación.\nreturn '${codigo}';\n`);

// ---------------------------------------------------------------- .zip (con "/" en las rutas, para Linux)

function archivos(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? archivos(path.join(dir, e.name), rel) : [rel];
  });
}

function fechaDos(d) {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    fecha: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const locales = [];
const centrales = [];
let posicion = 0;
const { hora, fecha } = fechaDos(new Date());
for (const rel of archivos(destino).sort()) {
  const datos = fs.readFileSync(path.join(destino, rel));
  const comprimido = zlib.deflateRawSync(datos, { level: 9 });
  const nombre = Buffer.from(rel, 'utf8');
  const crc = zlib.crc32(datos);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(hora, 10);
  local.writeUInt16LE(fecha, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comprimido.length, 18);
  local.writeUInt32LE(datos.length, 22);
  local.writeUInt16LE(nombre.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4); // hecho en Unix, versión 2.0
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(hora, 12);
  central.writeUInt16LE(fecha, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comprimido.length, 20);
  central.writeUInt32LE(datos.length, 24);
  central.writeUInt16LE(nombre.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // permisos rw-r--r--
  central.writeUInt32LE(posicion, 42);
  locales.push(local, nombre, comprimido);
  centrales.push(central, nombre);
  posicion += local.length + nombre.length + comprimido.length;
}
const directorio = Buffer.concat(centrales);
const fin = Buffer.alloc(22);
fin.writeUInt32LE(0x06054b50, 0);
fin.writeUInt16LE(centrales.length / 2, 8);
fin.writeUInt16LE(centrales.length / 2, 10);
fin.writeUInt32LE(directorio.length, 12);
fin.writeUInt32LE(posicion, 16);
fs.writeFileSync(zip, Buffer.concat([...locales, directorio, fin]));

console.log(`Carpeta: ${path.relative(raiz, destino)}`);
console.log(`Zip:     ${path.relative(raiz, zip)} (${(fs.statSync(zip).size / 1024).toFixed(0)} KB, ${centrales.length / 2} archivos)`);
console.log(`Código de instalación: ${codigo}`);
