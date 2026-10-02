// Esquema de la base de datos.
// Cada migración lleva la base de una versión a la siguiente; la versión actual se guarda en
// PRAGMA user_version. Una migración ya publicada no se modifica: los cambios van en una nueva al final.

const MIGRACIONES = [
  // 1 · Esquema inicial
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario       TEXT NOT NULL UNIQUE,
        nombre        TEXT NOT NULL,
        rol           TEXT NOT NULL,
        empresa       TEXT NOT NULL DEFAULT '',
        email         TEXT,
        password_hash TEXT NOT NULL,
        activo        INTEGER NOT NULL DEFAULT 1,
        aprobado      INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email) WHERE email IS NOT NULL;

      CREATE TABLE IF NOT EXISTS pedidos (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        siniestro       TEXT NOT NULL UNIQUE,
        patente         TEXT NOT NULL,
        taller_id       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        perito_id       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        taller          TEXT NOT NULL DEFAULT '',
        compania        TEXT NOT NULL DEFAULT '',
        vehiculo        TEXT NOT NULL DEFAULT '',
        cantidad_piezas INTEGER,
        origen          TEXT NOT NULL DEFAULT '',
        remito          TEXT NOT NULL DEFAULT '',
        despacho        TEXT NOT NULL DEFAULT '',
        transporte      TEXT NOT NULL DEFAULT '',
        guia            TEXT NOT NULL DEFAULT '',
        estado_viaje    TEXT NOT NULL DEFAULT '',
        entrega         TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pedidos_patente ON pedidos(patente);
      CREATE INDEX IF NOT EXISTS idx_pedidos_taller ON pedidos(taller_id);
      CREATE INDEX IF NOT EXISTS idx_pedidos_perito ON pedidos(perito_id);

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
  },

  // 2 · Se ingresa con el email: desaparece el nombre de usuario y el email pasa a ser obligatorio.
  //     Además, "version" en pedidos y usuarios permite detectar cuando dos personas editan lo
  //     mismo a la vez (por ejemplo, los administradores que comparten la cuenta).
  (db) => {
    const sinEmail = db.prepare("SELECT id, usuario FROM usuarios WHERE email IS NULL OR email = ''").all();
    for (const u of sinEmail) {
      db.prepare('UPDATE usuarios SET email = ? WHERE id = ?').run(`${u.usuario}@genco.local`, u.id);
    }
    db.exec(`
      CREATE TABLE usuarios_nueva (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT NOT NULL UNIQUE,
        nombre        TEXT NOT NULL,
        -- admin | perito | taller
        rol           TEXT NOT NULL,
        -- Taller: nombre del taller. Perito: sus compañías de seguro ("La Segunda, Zurich").
        empresa       TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        activo        INTEGER NOT NULL DEFAULT 1,
        -- 0 = se registró desde la página y espera que un admin lo apruebe
        aprobado      INTEGER NOT NULL DEFAULT 1,
        version       INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO usuarios_nueva (id, email, nombre, rol, empresa, password_hash, activo, aprobado, created_at)
        SELECT id, lower(email), nombre, rol, empresa, password_hash, activo, aprobado, created_at FROM usuarios;
      DROP TABLE usuarios;
      ALTER TABLE usuarios_nueva RENAME TO usuarios;

      ALTER TABLE pedidos ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
    `);
    if (sinEmail.length) {
      return `Cuentas sin email: se les asignó uno provisorio (${sinEmail.map((u) => `${u.usuario}@genco.local`).join(', ')}). ` +
        'Cambialos por los reales en Administración → Usuarios.';
    }
  },
];

export function migrar(db) {
  const actual = db.prepare('PRAGMA user_version').get().user_version;
  MIGRACIONES.slice(actual).forEach((migracion, i) => {
    const version = actual + i + 1;
    db.exec('BEGIN');
    try {
      const aviso = migracion(db);
      // Ninguna migración puede dejar referencias rotas (por ejemplo, pedidos que apunten a usuarios inexistentes).
      const rotas = db.prepare('PRAGMA foreign_key_check').all();
      if (rotas.length) throw new Error(`quedaron ${rotas.length} referencias rotas en ${rotas[0].table}`);
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
      if (aviso) console.warn(`⚠ ${aviso}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Falló la migración ${version} de la base de datos: ${err.message}`);
    }
  });
}
