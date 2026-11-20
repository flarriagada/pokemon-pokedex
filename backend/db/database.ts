import { DatabaseSync } from 'node:sqlite'

export function openDatabase() {
  Deno.mkdirSync('./data', { recursive: true })

  const db = new DatabaseSync('./data/pokedex.db')

  db.exec('PRAGMA foreign_keys = ON;')
// tablas para usuarios, cartas de usuarios y sesiones
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auth_issuer TEXT NOT NULL,
      auth_subject TEXT NOT NULL,
      email TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(auth_issuer, auth_subject)
    );

    CREATE TABLE IF NOT EXISTS user_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

      UNIQUE(user_id, card_id),
      CHECK(quantity > 0)
    );

    -- Cada sesión pertenece a un usuario registrado.
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL,

      FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
        --impide guardar una sesión que venza antes de su fecha de creación o exactamente en ella
      CHECK(expires_at > created_at)
    );

    
    -- Guarda los mazos creados por cada usuario.
    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

      UNIQUE(user_id, name),
      CHECK(length(trim(name)) BETWEEN 1 AND 80),
      CHECK(description IS NULL OR length(description) <= 250)
    );

    -- Relaciona los mazos con las cartas del inventario.
    CREATE TABLE IF NOT EXISTS deck_cards (
      deck_id INTEGER NOT NULL,
      user_card_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (deck_id, user_card_id),

      FOREIGN KEY (deck_id)
        REFERENCES decks(id)
        ON DELETE CASCADE,

      FOREIGN KEY (user_card_id)
        REFERENCES user_cards(id)
        ON DELETE CASCADE
    );

  `)

  // Comprobamos si la tabla de cartas del mazo ya tiene cantidad.
  const columns = db.prepare(
    'PRAGMA table_info(deck_cards)'
  ).all()

  const hasQuantity = columns.some(
    (column) => column.name === 'quantity'
  )

  // Actualizamos las bases de datos que ya existían.
  if (!hasQuantity) {
    db.exec(`
      ALTER TABLE deck_cards
      ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1
      CHECK(quantity > 0);
    `)
  }

  return db
}
