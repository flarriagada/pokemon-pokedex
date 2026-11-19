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

 // Busca al usuario asociado a una sesión vigente.
export function findActiveSessionUser(
  db: DatabaseSync,
  tokenHash: string
): { id: number; email: string | null } | null {

  const user = db.prepare(`
    SELECT users.id, users.email
    FROM sessions
    INNER JOIN users
      ON sessions.user_id = users.id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
  `).get(
    tokenHash,
    Math.floor(Date.now() / 1000)
  )

  // Si no existe la sesión o está vencida, devolvemos null.
  if (!user) return null

  return {
    id: Number(user.id),
    email: typeof user.email === 'string'
      ? user.email
      : null
  }
}

// Elimina una sesión específica utilizando el hash de su token.
export function deleteSessionByTokenHash(
  db: DatabaseSync,
  tokenHash: string
): boolean {

  // Buscamos y eliminamos solamente la sesión
  // que coincida con el hash recibido.
  const result = db.prepare(`
    DELETE FROM sessions
    WHERE token_hash = ?
  `).run(tokenHash)

  // Devolvemos true si SQLite eliminó una sesión.
  return Number(result.changes) > 0
}
