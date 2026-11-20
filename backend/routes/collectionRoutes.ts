import type { DatabaseSync } from 'node:sqlite'
import { getUserFromSession } from '../services/sessionService.ts'

export async function handleCollectionRequest(
  request: Request,
  url: URL,
  db: DatabaseSync
): Promise<Response | null> {


const isCollectionRoot = url.pathname === '/api/collection'

const itemMatch = url.pathname.match(
  /^\/api\/collection\/(\d+)$/
)

if (!isCollectionRoot && !itemMatch) {
  return null
}

// Obtenemos las cookies enviadas por el navegador.
const cookies = request.headers.get('Cookie') ?? ''

// Buscamos la cookie de nuestra sesión.
const sessionCookie = cookies
  .split(';')
  .map((cookie) => cookie.trim())
  .find((cookie) =>
    cookie.startsWith('pokedex_session=')
  )

// Extraemos el token de sesión.
const token = sessionCookie
  ? sessionCookie.slice('pokedex_session='.length)
  : ''

// Comprobamos la sesión en SQLite y recuperamos el usuario.
const user = await getUserFromSession(db, token)

// Si no hay una sesión válida, rechazamos el acceso.
if (!user) {
  return Response.json(
    { error: 'Debes iniciar sesión para acceder a tu colección' },
    { status: 401 }
  )
}

// Comprobamos el origen de las operaciones que modifican datos.
if (
  ['POST', 'PATCH', 'DELETE'].includes(request.method) &&
  request.headers.get('Origin') !== 'http://localhost:5173'
) {
  return Response.json(
    { error: 'Origen no autorizado' },
    { status: 403 }
  )
}

// Utilizamos el ID del usuario autenticado.
const userId = user.id


  // GET: consultar la colección
  if (isCollectionRoot && request.method === 'GET') {
    const cards = db.prepare(`
      SELECT
        id,
        card_id AS cardId,
        quantity,
        created_at AS createdAt
      FROM user_cards
      WHERE user_id = ?
      ORDER BY id DESC
    `).all(userId)

    return Response.json(cards)
  }

  // POST: agregar una carta
  if (isCollectionRoot && request.method === 'POST') {
    let body: unknown

    try {
      body = await request.json()
    } catch {
      return Response.json(
        { error: 'JSON inválido' },
        { status: 400 }
      )
    }

    if (
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      return Response.json(
        { error: 'Datos inválidos' },
        { status: 400 }
      )
    }

    const data = body as Record<string, unknown>
    const cardId = data.cardId
    const quantity = data.quantity

    if (
      typeof cardId !== 'string' ||
      !cardId.trim() ||
      cardId.length > 100 ||
      typeof quantity !== 'number' ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1
    ) {
      return Response.json(
        { error: 'Carta o cantidad inválida' },
        { status: 400 }
      )
    }

    const normalizedId = cardId.trim()

    db.prepare(`
      INSERT INTO user_cards
        (user_id, card_id, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, card_id)
      DO UPDATE SET quantity =
        user_cards.quantity + excluded.quantity
    `).run(userId, normalizedId, quantity)

    const savedCard = db.prepare(`
      SELECT
        id,
        card_id AS cardId,
        quantity,
        created_at AS createdAt
      FROM user_cards
      WHERE user_id = ? AND card_id = ?
    `).get(userId, normalizedId)

    return Response.json(savedCard, { status: 200 })
  }
 
  if (itemMatch) {
    const itemId = Number(itemMatch[1])

    if (!Number.isSafeInteger(itemId) || itemId < 1) {
      return Response.json(
        { error: 'ID inválido' },
        { status: 400 }
      )
    }

    // PATCH: modificar cantidad
    if (request.method === 'PATCH') {
      let body: unknown

      try {
        body = await request.json()
      } catch {
        return Response.json(
          { error: 'JSON inválido' },
          { status: 400 }
        )
      }

      if (
        body === null ||
        typeof body !== 'object' ||
        Array.isArray(body)
      ) {
        return Response.json(
          { error: 'Datos inválidos' },
          { status: 400 }
        )
      }

      const data = body as Record<string, unknown>
      const quantity = data.quantity

      if (
        typeof quantity !== 'number' ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1
      ) {
        return Response.json(
          { error: 'Cantidad inválida' },
          { status: 400 }
        )
      }

      const result = db.prepare(`
        UPDATE user_cards
        SET quantity = ?
        WHERE id = ? AND user_id = ?
      `).run(quantity, itemId, userId)

      if (result.changes === 0) {
        return Response.json(
          { error: 'Registro no encontrado' },
          { status: 404 }
        )
      }

      const updatedCard = db.prepare(`
        SELECT
          id,
          card_id AS cardId,
          quantity,
          created_at AS createdAt
        FROM user_cards
        WHERE id = ? AND user_id = ?
      `).get(itemId, userId)

      return Response.json(updatedCard)
    }

    // DELETE: eliminar carta del inventario
    if (request.method === 'DELETE') {
      const result = db.prepare(`
        DELETE FROM user_cards
        WHERE id = ? AND user_id = ?
      `).run(itemId, userId)

      if (result.changes === 0) {
        return Response.json(
          { error: 'Registro no encontrado' },
          { status: 404 }
        )
      }

      return new Response(null, { status: 204 })
    }

    return Response.json(
      { error: 'Método no permitido' },
      {
        status: 405,
        headers: { Allow: 'PATCH, DELETE' }
      }
    )
  }

  return Response.json(
    { error: 'Método no permitido' },
    { status: 405 }
  )
}
