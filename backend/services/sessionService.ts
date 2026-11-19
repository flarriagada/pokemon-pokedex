import type { DatabaseSync } from 'node:sqlite'
import { insertSession } from '../db/sessionRepository.ts'

const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60

export async function generateSessionCredentials() {

  // Generamos 32 bytes aleatorios utilizando
  // un generador criptográficamente seguro.
  const randomBytes = crypto.getRandomValues(
    new Uint8Array(32)
  )

  // Convertimos los bytes a texto hexadecimal
  // para poder utilizar el token como identificador.
  const token = Array.from(randomBytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')

  // Transformamos el token en bytes para calcular su hash.
  const encodedToken = new TextEncoder().encode(token)

  // Calculamos el hash SHA-256 del token.
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    encodedToken
  )

  // Convertimos el resultado del hash a texto hexadecimal.
  const tokenHash = Array.from(
    new Uint8Array(hashBuffer),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('')

  // Definimos que la sesión vencerá en 7 días.
  // Date.now() entrega milisegundos; SQLite usará segundos Unix.
  const expiresAt =
    Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS

  return {
    token,
    tokenHash,
    expiresAt
  }
}

// Crea una sesión para un usuario y la guarda en SQLite.
export async function createSession(
  db: DatabaseSync,
  userId: number
) {
  // Generamos el token, su hash y la fecha de vencimiento.
  const { token, tokenHash, expiresAt } =
    await generateSessionCredentials()

  // Guardamos únicamente el hash en la base de datos.
  const sessionId = insertSession(
    db,
    userId,
    tokenHash,
    expiresAt
  )

  // Devolvemos los datos necesarios para continuar
  // con la autenticación y crear la cookie posteriormente.
  return {
    sessionId,
    token,
    expiresAt
  }
}
