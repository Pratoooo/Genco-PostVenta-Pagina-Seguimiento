import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { migrar } from './migraciones.js';

fs.mkdirSync(config.dirDatos, { recursive: true });

// Las migraciones corren con las claves foráneas apagadas: algunas reconstruyen tablas, y con las
// claves activas borrar la tabla vieja dejaría los pedidos sin taller/perito asignado.
export const db = new DatabaseSync(path.join(config.dirDatos, 'genco.db'), { enableForeignKeyConstraints: false });

db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
migrar(db);
db.exec('PRAGMA foreign_keys = ON');

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
