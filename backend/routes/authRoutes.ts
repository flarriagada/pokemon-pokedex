import type { DatabaseSync } from 'node:sqlite'
import { findOrCreateGoogleUser } from '../db/userRepository.ts'
import { createSession } from '../services/sessionService.ts'
import { getUserFromSession } from '../services/sessionService.ts'

import { verifyGoogleCredential } from '../services/googleAuthService.ts'

export async function handleAuthRequest(
  request: Request,
  url: URL,
  db :DatabaseSync
): Promise<Response | null> {

  if (url.pathname === '/api/auth/me') {

    if (request.method !== 'GET') {
      return Response.json(
        { error: 'Método no permitido' },
        { status: 405 }
      )
    }

    // Leemos la cookie enviada automáticamente por el navegador.
    const cookies = request.headers.get('Cookie') ?? ''

    const sessionCookie = cookies
      .split(';')
      .map((cookie) => cookie.trim())
      .find((cookie) =>
        cookie.startsWith('pokedex_session=')
      )

    const token = sessionCookie
      ? sessionCookie.slice('pokedex_session='.length)
      : ''

    // Buscamos el usuario de la sesión en SQLite.
    const user = await getUserFromSession(db, token)

    if (!user) {
      return Response.json(
        { authenticated: false },
        {
          status: 401,
          headers: { 'Cache-Control': 'no-store' }
        }
      )
    }

    return Response.json(
      { authenticated: true, user },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }


  if (url.pathname === '/api/auth/google/config') {
    if (request.method !== 'GET') {
      return Response.json(
        { error: 'Método no permitido' },
        { status: 405, headers: { Allow: 'GET' } }
      )
    }

    const clientId = Deno.env.get('GOOGLE_CLIENT_ID')

    if (!clientId?.trim()) {
      return Response.json(
        { error: 'Verificación con Google no configurada' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    // El Client ID es público. Nunca devolver el resto de las variables de entorno.
    return Response.json(
      { clientId },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  // Distinguimos entre verificar una identidad e iniciar una sesión.
  const isVerify = url.pathname === '/api/auth/google/verify'
  const isLogin = url.pathname === '/api/auth/google/login'

  if (!isVerify && !isLogin) {
    return null
  }

  // Solo aceptamos el inicio de sesión desde nuestro frontend local.
  // Esto ayuda a prevenir solicitudes de autenticación desde otros sitios.
  if (
    isLogin &&
    request.headers.get('Origin') !== 'http://localhost:5173'
  ) {
    return Response.json(
      { error: 'Origen no autorizado' },
      { status: 403 }
    )
  }


  if (request.method !== 'POST') { //Comprobamos el método
    return Response.json(
      { error: 'Método no permitido' },
      {
        status: 405,
        headers: { Allow: 'POST' }
      }
    )
  }

  if (!Deno.env.get('GOOGLE_CLIENT_ID')) {
    return Response.json(
      { error: 'Autenticación no configurada' },
      { status: 503 }
    )
  }

  let body: unknown

  try {
    body = await request.json()  //leemos datos enviados por react
  } catch {
    return Response.json(
      { error: 'JSON inválido' },
      { status: 400 }
    )
  }

  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !('credential' in body) ||
    typeof body.credential !== 'string' ||
    !body.credential ||
    body.credential.length > 12000
  ) {
    return Response.json(
      { error: 'Credencial inválida' },
      { status: 400 }
    )
  }

  
  let profile: Awaited<ReturnType<typeof verifyGoogleCredential>>

  // Primero verificamos que el JWT realmente provenga de Google.
  try {
    profile = await verifyGoogleCredential(body.credential)
  } catch {
    return Response.json(
      { error: 'No se pudo verificar el token de Google' },
      { status: 401 }
    )
  }

  // Conservamos la ruta original de solo verificación.
  if (isVerify) {
    return Response.json(
      { valid: true, profile },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  try {
    // Buscamos al usuario en SQLite o lo registramos si es nuevo.
    const userId = findOrCreateGoogleUser(
      db,
      profile.googleSubject,
      profile.email
    )

    // Generamos el token y guardamos su hash en la tabla sessions.
    const { token, expiresAt } = await createSession(
      db,
      userId
    )

    // Calculamos cuántos segundos durará la cookie.
    const maxAge = Math.max(
      0,
      expiresAt - Math.floor(Date.now() / 1000)
    )

    // En HTTPS agregamos Secure. En localhost HTTP no es necesario.
    const secure = url.protocol === 'https:' ? '; Secure' : ''

    // HttpOnly impide que JavaScript lea el token de la cookie.
    const cookie =
      `pokedex_session=${token}; HttpOnly; SameSite=Lax; ` +
      `Path=/; Max-Age=${maxAge}${secure}`

    return Response.json(
      {
        authenticated: true,
        user: {
          id: userId,
          email: profile.email
        }
      },
      {
        headers: {
          'Set-Cookie': cookie,
          'Cache-Control': 'no-store'
        }
      }
    )
  } catch {
    return Response.json(
      { error: 'No se pudo crear la sesión' },
      { status: 500 }
    )
  }

}
