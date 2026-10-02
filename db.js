import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const dataDir = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'genco.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS usuarios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario       TEXT NOT NULL UNIQUE,
    nombre        TEXT NOT NULL,
    -- admin | perito | taller
    rol           TEXT NOT NULL,
    -- Taller: nombre del taller. Perito: compañía de seguro.
    empresa       TEXT NOT NULL DEFAULT '',
    -- Para recuperar la contraseña (en minúsculas)
    email         TEXT,
    password_hash TEXT NOT NULL,
    activo        INTEGER NOT NULL DEFAULT 1,
    -- 0 = se registró desde la página y espera que un admin lo apruebe
    aprobado      INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pedidos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    siniestro       TEXT NOT NULL UNIQUE,
    patente         TEXT NOT NULL,
    taller_id       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    perito_id       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    -- Nombre de taller en texto libre (pedidos cargados antes de existir las cuentas)
    taller          TEXT NOT NULL DEFAULT '',
    compania        TEXT NOT NULL DEFAULT '',
    vehiculo        TEXT NOT NULL DEFAULT '',
    cantidad_piezas INTEGER,
    -- '' | stock | fabrica
    origen          TEXT NOT NULL DEFAULT '',
    remito          TEXT NOT NULL DEFAULT '',
    -- '' | parcial | total
    despacho        TEXT NOT NULL DEFAULT '',
    -- '' | angeleri | andreani | sendbox
    transporte      TEXT NOT NULL DEFAULT '',
    guia            TEXT NOT NULL DEFAULT '',
    estado_viaje    TEXT NOT NULL DEFAULT '',
    -- '' | en_camino | recibido
    entrega         TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pedidos_patente ON pedidos(patente);

  -- Enlaces de "me olvidé la contraseña" (se guarda solo el hash del token)
  CREATE TABLE IF NOT EXISTS recuperaciones (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expira      INTEGER NOT NULL,
    usado       INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS eventos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id   INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL,
    fecha       TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migraciones de bases creadas con versiones anteriores.
const columnas = (tabla) => db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
for (const col of ['taller_id', 'perito_id']) {
  if (!columnas('pedidos').includes(col)) db.exec(`ALTER TABLE pedidos ADD COLUMN ${col} INTEGER REFERENCES usuarios(id) ON DELETE SET NULL`);
}
if (!columnas('usuarios').includes('aprobado')) db.exec('ALTER TABLE usuarios ADD COLUMN aprobado INTEGER NOT NULL DEFAULT 1');
if (!columnas('usuarios').includes('empresa')) db.exec("ALTER TABLE usuarios ADD COLUMN empresa TEXT NOT NULL DEFAULT ''");
if (!columnas('usuarios').includes('email')) db.exec('ALTER TABLE usuarios ADD COLUMN email TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email) WHERE email IS NOT NULL');
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_pedidos_taller ON pedidos(taller_id);
  CREATE INDEX IF NOT EXISTS idx_pedidos_perito ON pedidos(perito_id);
`);

export function logEvento(pedidoId, descripcion) {
  db.prepare('INSERT INTO eventos (pedido_id, descripcion) VALUES (?, ?)').run(pedidoId, descripcion);
}

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
