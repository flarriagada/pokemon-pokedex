
import type { DatabaseSync } from 'node:sqlite'

// Identificador del proveedor de autenticación.
const GOOGLE_ISSUER = 'https://accounts.google.com'

// Busca al usuario de Google en SQLite.
// Si todavía no existe, lo registra.
export function findOrCreateGoogleUser(
  db: DatabaseSync,
  googleSubject: string,
  email: string | null
): number {

  // Insertamos al usuario si todavía no está registrado.
  // ON CONFLICT evita duplicarlo cuando vuelve a iniciar sesión.
  db.prepare(`
    INSERT INTO users (
      auth_issuer,
      auth_subject,
      email
    )
    VALUES (?, ?, ?)
    ON CONFLICT(auth_issuer, auth_subject)
    DO UPDATE SET email = COALESCE(
      excluded.email,
      users.email
    )
  `).run(GOOGLE_ISSUER, googleSubject, email)

  // Recuperamos el identificador interno del usuario.
  const user = db.prepare(`
    SELECT id
    FROM users
    WHERE auth_issuer = ?
      AND auth_subject = ?
  `).get(GOOGLE_ISSUER, googleSubject)

  if (!user) {
    throw new Error('No se pudo obtener el usuario')
  }

  // Devolvemos su ID para asociarlo a una sesión.
  return Number(user.id)
}
