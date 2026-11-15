
import type { DatabaseSync } from 'node:sqlite'

export async function handleCollectionRequest(
  request: Request,
  url: URL,
  db: DatabaseSync
): Promise<Response | null> {

  if (url.pathname !== '/api/collection') {
    return null
  }

  // Acceso temporal solo para desarrollo local
  if (Deno.env.get('APP_ENV') !== 'development') {
    return Response.json(
      { error: 'Autenticación requerida' },
      { status: 401 }
    )
  }

  const user = db.prepare(`
    SELECT id FROM users
    WHERE auth_issuer = ? AND auth_subject = ?
  `).get('local-dev', 'test-user')

  if (!user) {
    return Response.json(
      { error: 'Usuario de prueba no encontrado' },
      { status: 503 }
    )
  }

  const userId = Number(user.id)

  // GET: consultar la colección
  if (request.method === 'GET') {
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
  if (request.method === 'POST') {
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

  return Response.json(
    { error: 'Método no permitido' },
    { status: 405 }
  )
}
