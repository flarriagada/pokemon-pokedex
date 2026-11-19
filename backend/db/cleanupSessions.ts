import type { DatabaseSync } from 'node:sqlite'

// Elimina las sesiones vencidas de SQLite.
export function cleanupExpiredSessions(
  db: DatabaseSync
): number {

  // Obtenemos la fecha actual en segundos Unix.
  const now = Math.floor(Date.now() / 1000)

  // Eliminamos únicamente las sesiones vencidas.
  const result = db.prepare(`
    DELETE FROM sessions
    WHERE expires_at <= ?
  `).run(now)

  // Devolvemos cuántas sesiones eliminamos.
  return Number(result.changes)
}

