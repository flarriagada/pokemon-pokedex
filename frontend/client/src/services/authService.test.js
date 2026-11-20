import assert from 'node:assert/strict'
import test from 'node:test'
import { getGoogleAuthConfig, verifyGoogleCredential } from './authService.js'

test('obtiene únicamente el Client ID público desde el backend', async context => {
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/auth/google/config')
    assert.equal(options.method, 'GET')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.cache, 'no-store')
    return Response.json({ clientId: 'test-client.apps.googleusercontent.com' })
  })

  assert.equal(
    await getGoogleAuthConfig(new AbortController().signal),
    'test-client.apps.googleusercontent.com'
  )
})

test('rechaza una configuración ausente o con formato incorrecto', async context => {
  for (const config of [null, {}, { clientId: 'incorrecto' }]) {
    const fetchMock = context.mock.method(globalThis, 'fetch', async () => Response.json(config))
    await assert.rejects(getGoogleAuthConfig(new AbortController().signal), /identificador de Google/)
    fetchMock.mock.restore()
  }
})

test('envía la credencial por POST y requiere la confirmación del backend', async context => {
  // Respuesta simulada del contrato HTTP; no prueba una identidad real de Google.
  const profile = { googleSubject: 'test-subject', email: null }
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/auth/google/verify')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(options.body), { credential: 'test-credential' })
    assert.equal(options.credentials, 'omit')
    return Response.json({ valid: true, profile })
  })

  assert.deepEqual(
    await verifyGoogleCredential('test-credential', new AbortController().signal),
    profile
  )
})

test('una respuesta HTTP 200 sin identidad confirmada no es un éxito', async context => {
  for (const result of [null, {}, { valid: false }, { valid: true }, { valid: true, profile: {} }]) {
    const fetchMock = context.mock.method(globalThis, 'fetch', async () => Response.json(result))
    await assert.rejects(
      verifyGoogleCredential('test-credential', new AbortController().signal),
      /no confirmó una identidad válida/
    )
    fetchMock.mock.restore()
  }
})

test('muestra errores en español para HTTP 400, 401, 503 y 500', async context => {
  for (const [status, message] of [
    [400, /inválida o ha vencido/],
    [401, /inválida o ha vencido/],
    [503, /no está configurada/],
    [500, /no pudo completar/]
  ]) {
    const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response(null, { status }))
    await assert.rejects(
      verifyGoogleCredential('test-credential', new AbortController().signal),
      message
    )
    fetchMock.mock.restore()
  }
})

test('maneja una respuesta que no contiene JSON', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response('<html>Error</html>'))
  await assert.rejects(getGoogleAuthConfig(new AbortController().signal), /no se pudo interpretar/)
})

test('maneja fallos de conexión y tiempo de espera agotado', async context => {
  for (const [error, message] of [
    [new TypeError('Failed to fetch'), /No se pudo conectar/],
    [new DOMException('Timeout', 'TimeoutError'), /tardó demasiado/]
  ]) {
    const fetchMock = context.mock.method(globalThis, 'fetch', async () => { throw error })
    await assert.rejects(getGoogleAuthConfig(new AbortController().signal), message)
    fetchMock.mock.restore()
  }
})

test('no envía una credencial ausente al servidor', async context => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => Response.json({}))
  await assert.rejects(
    verifyGoogleCredential(undefined, new AbortController().signal),
    /no entregó una credencial válida/
  )
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('conserva la cancelación de una petición al desmontar el componente', async context => {
  const controller = new AbortController()
  controller.abort()
  context.mock.method(globalThis, 'fetch', async (_url, options) => {
    options.signal.throwIfAborted()
  })
  await assert.rejects(getGoogleAuthConfig(controller.signal), { name: 'AbortError' })
})
