
import { DatabaseSync } from 'node:sqlite'

export function openDatabase() {
  Deno.mkdirSync('./data', { recursive: true })

  const db = new DatabaseSync('./data/pokedex.db')

  db.exec('PRAGMA foreign_keys = ON;')

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
  `)

  return db
}
