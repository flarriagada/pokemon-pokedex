const GOOGLE_AUTH_URL = '/api/auth/google'
const REQUEST_TIMEOUT_MS = 15000

async function requestAuth(path, options, signal) {
  let response

  try {
    response = await fetch(`${GOOGLE_AUTH_URL}/${path}`, {
      ...options,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      ])
    })
  } catch (error) {
    if (signal.aborted) throw error

    if (error.name === 'TimeoutError') {
      throw new Error('El servidor tardó demasiado en responder. Vuelve a intentarlo.')
    }

    throw new Error('No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.')
  }

  if (response.status === 503) {
    throw new Error('La verificación con Google no está configurada en el servidor.')
  }

  if (response.status === 400 || response.status === 401) {
    throw new Error('La credencial de Google es inválida o ha vencido. Vuelve a intentarlo.')
  }

  if (!response.ok) {
    throw new Error('El servidor no pudo completar la verificación con Google. Vuelve a intentarlo.')
  }

  try {
    return await response.json()
  } catch {
    throw new Error('El servidor devolvió una respuesta que no se pudo interpretar.')
  }
}

export async function getGoogleAuthConfig(signal) {
  const config = await requestAuth('config', { method: 'GET' }, signal)

  if (
    typeof config?.clientId !== 'string' ||
    !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.clientId)
  ) {
    throw new Error('El identificador de Google no está configurado correctamente en el servidor.')
  }

  return config.clientId
}

export async function verifyGoogleCredential(credential, signal) {
  if (typeof credential !== 'string' || !credential || credential.length > 12000) {
    throw new Error('Google no entregó una credencial válida. Vuelve a intentarlo.')
  }

  // El token solo se utiliza para esta petición; no se guarda ni se decodifica.
  const result = await requestAuth('verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential })
  }, signal)

  if (
    result?.valid !== true ||
    typeof result.profile?.googleSubject !== 'string' ||
    !result.profile.googleSubject
  ) {
    throw new Error('El servidor no confirmó una identidad válida de Google.')
  }

  return result.profile
}


// Envía el JWT de Google para crear una sesión en el servidor.
export async function loginWithGoogle(credential, signal) {
  if (
    typeof credential !== 'string' ||
    !credential ||
    credential.length > 12000
  ) {
    throw new Error('Google no entregó una credencial válida.')
  }

  const result = await requestAuth(
    'login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential })
    },
    signal
  )

  if (
    result?.authenticated !== true ||
    !Number.isSafeInteger(result.user?.id)
  ) {
    throw new Error('No se pudo confirmar la sesión.')
  }

  return result.user
}

// Consulta al backend si existe una sesión activa.
export async function getCurrentUser(signal) {
  let response

  try {
    response = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error('No se pudo comprobar la sesión.')
  }

  // Un 401 significa que no existe una sesión válida.
  if (response.status === 401) {
    return null
  }

  if (!response.ok) {
    throw new Error('No se pudo consultar la sesión.')
  }

  const data = await response.json()

  if (
    data.authenticated !== true ||
    !Number.isSafeInteger(data.user?.id)
  ) {
    throw new Error('Respuesta de sesión inválida.')
  }

  return data.user
}

 // Solicita al backend cerrar la sesión.
export async function logoutFromPokedex() {

  // El navegador envía automáticamente la cookie de sesión.
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store'
  })

  // HTTP 204 significa que el servidor completó el logout.
  if (response.status !== 204) {
    throw new Error('No se pudo cerrar la sesión.')
  }
}