
import { verifyGoogleCredential } from '../services/googleAuthService.ts'

export async function handleAuthRequest(
  request: Request,
  url: URL
): Promise<Response | null> {

  if (url.pathname !== '/api/auth/google/verify') {
    return null //Preguntamos si la solicitud corresponde a nuestra ruta de autenticacion
    //Si no corresponde, se siguen procesando las demás rutas 
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

  try {
    const profile = await verifyGoogleCredential(
      body.credential //utilizamos función de verificación si es valido devuelve el perfil verificado, si falla responde con 401
    )

    return Response.json(
      { valid: true, profile },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    return Response.json(
      { error: 'No se pudo verificar el token de Google' },
      { status: 401 }
    )
  }
}
