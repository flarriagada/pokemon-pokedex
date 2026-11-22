import { DatabaseSync } from 'node:sqlite'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function cacheCardMetadata(
  db: DatabaseSync,
  cardId: string,
  language: 'es' | 'en',
  details: unknown
) {
  if (!isRecord(details)) return

  const set = isRecord(details.set) ? details.set : null
  const name = typeof details.name === 'string' ? details.name.trim() : null
  const rarity = typeof details.rarity === 'string'
    ? details.rarity.trim()
    : null
  const setId = typeof set?.id === 'string' ? set.id.trim() : null
  const setName = typeof set?.name === 'string' ? set.name.trim() : null

  db.prepare(`
    INSERT INTO card_metadata (
      card_id,
      language,
      name,
      rarity,
      set_id,
      set_name,
      details_json,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(card_id, language) DO UPDATE SET
      name = excluded.name,
      rarity = excluded.rarity,
      set_id = excluded.set_id,
      set_name = excluded.set_name,
      details_json = excluded.details_json,
      updated_at = excluded.updated_at
  `).run(
    cardId,
    language,
    name || null,
    rarity || null,
    setId || null,
    setName || null,
    JSON.stringify(details)
  )
}

export function openDatabase() {
  Deno.mkdirSync('./data', { recursive: true })

  const db = new DatabaseSync('./data/pokedex.db')

  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
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
      for_trade INTEGER NOT NULL DEFAULT 0 CHECK(for_trade IN (0, 1)),
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

    -- Conserva un historial independiente de las cantidades del inventario.
    CREATE TABLE IF NOT EXISTS card_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_id TEXT NOT NULL CHECK(length(trim(card_id)) BETWEEN 1 AND 100),
      transaction_type TEXT NOT NULL
        CHECK(transaction_type IN ('purchase', 'sale')),
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
      transaction_date TEXT NOT NULL,
      notes TEXT CHECK(notes IS NULL OR length(notes) <= 250),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    );

    -- Etiquetas privadas creadas por cada usuario.
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

      UNIQUE(user_id, name),
      CHECK(name = trim(name)),
      CHECK(length(name) BETWEEN 1 AND 40)
    );

    -- Relaciona las etiquetas con registros concretos del inventario.
    CREATE TABLE IF NOT EXISTS user_card_tags (
      user_card_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (user_card_id, tag_id),

      FOREIGN KEY (user_card_id)
        REFERENCES user_cards(id)
        ON DELETE CASCADE,

      FOREIGN KEY (tag_id)
        REFERENCES tags(id)
        ON DELETE CASCADE
    );

    -- Caché reconstruible para buscar y paginar sin consultar TCGdex masivamente.
    CREATE TABLE IF NOT EXISTS card_metadata (
      card_id TEXT NOT NULL,
      language TEXT NOT NULL CHECK(language IN ('es', 'en')),
      name TEXT,
      rarity TEXT,
      set_id TEXT,
      set_name TEXT,
      details_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

      PRIMARY KEY (card_id, language)
    );

    CREATE INDEX IF NOT EXISTS idx_user_cards_user_id_id
      ON user_cards(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_date_id
      ON card_transactions(user_id, transaction_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_type_date_id
      ON card_transactions(
        user_id,
        transaction_type,
        transaction_date DESC,
        id DESC
      );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
      ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_user_card_tags_tag_id
      ON user_card_tags(tag_id, user_card_id);
    CREATE INDEX IF NOT EXISTS idx_card_metadata_language_name
      ON card_metadata(language, name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_card_metadata_language_rarity
      ON card_metadata(language, rarity COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_card_metadata_language_set
      ON card_metadata(language, set_id);

  `)

  // Agregamos la disponibilidad a inventarios creados anteriormente.
  const userCardColumns = db.prepare(
    'PRAGMA table_info(user_cards)'
  ).all()

  const hasForTrade = userCardColumns.some(
    (column) => column.name === 'for_trade'
  )

  if (!hasForTrade) {
    db.exec(`
      ALTER TABLE user_cards
      ADD COLUMN for_trade INTEGER NOT NULL DEFAULT 0
      CHECK(for_trade IN (0, 1));
    `)
  }

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
