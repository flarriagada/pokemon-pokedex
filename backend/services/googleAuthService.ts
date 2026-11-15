
import {
  createRemoteJWKSet,
  jwtVerify
} from 'jose' // biblioteca para jwt

// Claves públicas de Google
const googleKeys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs')
) //Google firma usando claves privaadas, nuestro server usa claves publicas
// para comprobar que la frima es autentica

export async function verifyGoogleCredential(
  credential: string
) { //al verificar el token comprobamos que fue emitido para nuestra Pokedex
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')

  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID no configurado')
  }

  if (!credential || credential.length > 12000) {
    throw new Error('Credencial inválida')
  }
//firma clave publica validada
  const { payload } = await jwtVerify( //jwtVerify el token no esta caducado
    credential,
    googleKeys,
    {
      audience: clientId, //token para nuestra aplicacion
      issuer: [
        'https://accounts.google.com',
        'accounts.google.com' //emisor google
      ],
      algorithms: ['RS256'], //utiliza algoritmo de firma aceptado
      requiredClaims: ['sub', 'exp'] //contiene id usuario y expiracion
    }
  )

  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Identificador de usuario inválido')
  }
//al verificar correctamente google subject es el id estable del usuario en google
  return {
    googleSubject: payload.sub,
    email:
      payload.email_verified === true &&
      typeof payload.email === 'string'
        ? payload.email
        : null
  }
}
