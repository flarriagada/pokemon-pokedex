import assert from 'node:assert/strict'
import { handleAuthRequest } from './authRoutes.ts'

const baseUrl = 'http://localhost/api/auth/google'

function sendRequest(path: string, method = 'GET', body?: string) {
  const url = new URL(`${baseUrl}/${path}`)
  return handleAuthRequest(new Request(url, { method, body }), url)
}

Deno.test('Contrato HTTP de verificación de identidad con Google', async (test) => {
  const originalClientId = Deno.env.get('GOOGLE_CLIENT_ID')
  // Identificador ficticio exclusivo de estas pruebas, sin credenciales reales.
  const testClientId = 'test-client.apps.googleusercontent.com'
  Deno.env.set('GOOGLE_CLIENT_ID', testClientId)

  try {
    await test.step('configuración pública con un único campo y sin sesión', async () => {
      const response = await sendRequest('config')
      assert.equal(response?.status, 200)
      assert.deepEqual(await response!.json(), { clientId: testClientId })
      assert.equal(response!.headers.get('Cache-Control'), 'no-store')
      assert.equal(response!.headers.has('Set-Cookie'), false)
    })

    await test.step('métodos incorrectos y rutas ajenas', async () => {
      const configResponse = await sendRequest('config', 'POST')
      assert.equal(configResponse?.status, 405)
      assert.equal(configResponse!.headers.get('Allow'), 'GET')
      const verifyResponse = await sendRequest('verify')
      assert.equal(verifyResponse?.status, 405)
      assert.equal(verifyResponse!.headers.get('Allow'), 'POST')
      assert.equal(await sendRequest('other'), null)
    })

    await test.step('JSON y credenciales ausentes o inválidas', async () => {
      for (const body of ['{', 'null', '[]', '{}', '{"credential":42}', '{"credential":""}']) {
        assert.equal((await sendRequest('verify', 'POST', body))?.status, 400)
      }
    })

    await test.step('token falso rechazado con HTTP 401', async () => {
      const response = await sendRequest('verify', 'POST', JSON.stringify({
        credential: 'token-falso-de-prueba'
      }))
      assert.equal(response?.status, 401)
      assert.equal((await response!.json()).valid, undefined)
      assert.equal(response!.headers.has('Set-Cookie'), false)
    })

    await test.step('claims plausibles sin firma también rechazados con HTTP 401', async () => {
      const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      const payload = btoa(JSON.stringify({
        sub: 'test-subject',
        aud: testClientId,
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1000) + 300
      }))
      const response = await sendRequest('verify', 'POST', JSON.stringify({
        credential: `${header}.${payload}.`
      }))
      assert.equal(response?.status, 401)
    })

    await test.step('configuración ausente responde HTTP 503', async () => {
      Deno.env.delete('GOOGLE_CLIENT_ID')
      assert.equal((await sendRequest('config'))?.status, 503)
      assert.equal((await sendRequest('verify', 'POST', '{}'))?.status, 503)
    })
  } finally {
    if (originalClientId === undefined) {
      Deno.env.delete('GOOGLE_CLIENT_ID')
    } else {
      Deno.env.set('GOOGLE_CLIENT_ID', originalClientId)
    }
  }
})
