import type { DatabaseSync } from 'node:sqlite'

// Guarda una sesión en SQLite y devuelve su ID.
export function insertSession(
  db: DatabaseSync,
  userId: number,
  tokenHash: string,
  expiresAt: number
): number {

  // Preparamos una consulta para insertar la sesión.
  const result = db.prepare(`
    INSERT INTO sessions (
      user_id,
      token_hash,
      expires_at
    )
    VALUES (?, ?, ?)
  `).run(userId, tokenHash, expiresAt)

  // SQLite genera automáticamente el ID de la nueva sesión.
  return Number(result.lastInsertRowid)
}
