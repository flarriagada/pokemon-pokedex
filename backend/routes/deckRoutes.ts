import type { DatabaseSync } from 'node:sqlite'
import { getUserFromSession } from '../services/sessionService.ts'

// Maneja las solicitudes para crear y consultar mazos.
export async function handleDeckRequest(
  request: Request,
  url: URL,
  db: DatabaseSync
): Promise<Response | null> {

  // Si la solicitud no es de mazos, dejamos continuar al servidor.
  const isDecksRoot = url.pathname === '/api/decks'

  // Identificamos rutas como /api/decks/1 o /api/decks/5.
  const deckMatch = url.pathname.match(
    /^\/api\/decks\/(\d+)$/
  ) 

  const deckCardsMatch = url.pathname.match(
    /^\/api\/decks\/(\d+)\/cards$/ //Cartas del mazo 
  )

  const deckCardsSyncMatch = url.pathname.match(
    /^\/api\/decks\/(\d+)\/cards\/sync$/
  )

  const deckCardItemMatch = url.pathname.match(
    /^\/api\/decks\/(\d+)\/cards\/(\d+)$/
  )

  //la funcion reconoce solicitudes con las cartas de cada mazo
  if (!isDecksRoot && !deckMatch && !deckCardsMatch && !deckCardsSyncMatch &&
  !deckCardItemMatch) {
    return null
  }

  // Recuperamos el token desde la cookie del navegador.
  const cookies = request.headers.get('Cookie') ?? ''

  const sessionCookie = cookies
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('pokedex_session='))

  const token = sessionCookie
    ? sessionCookie.slice('pokedex_session='.length)
    : ''

  //Comprobmamos quien inicio sesión 
  const user = await getUserFromSession(db, token)

  if (!user) {
    return Response.json(
      { error: 'Debes iniciar sesión para gestionar mazos' },
      { status: 401 }
    )
  }

  const userId = user.id

  // Elimina una carta específica de un mazo.
  if (deckCardItemMatch) {
    const deckId = Number(deckCardItemMatch[1])
    const userCardId = Number(deckCardItemMatch[2])

    // Comprobamos que ambos identificadores sean válidos.
    if (
      !Number.isSafeInteger(deckId) ||
      deckId < 1 ||
      !Number.isSafeInteger(userCardId) ||
      userCardId < 1
    ) {
      return Response.json(
        { error: 'Identificadores inválidos' },
        { status: 400 }
      )
    }
    
    // Permitimos actualizar la cantidad o quitar la carta.
    if (
      request.method !== 'PATCH' &&
      request.method !== 'DELETE'
    ) {
      return Response.json(
        { error: 'Método no permitido' },
        {
          status: 405,
          headers: { Allow: 'PATCH, DELETE' }
        }
      )
    }

    // Comprobamos que la solicitud venga de nuestro frontend.
    if (
      request.headers.get('Origin') !==
      'http://localhost:5173'
    ) {
      return Response.json(
        { error: 'Origen no autorizado' },
        { status: 403 }
      )
    }

    // Verificamos que el mazo pertenezca al usuario.
    const deck = db.prepare(`
      SELECT id FROM decks
      WHERE id = ? AND user_id = ?
    `).get(deckId, userId)

    if (!deck) {
      return Response.json(
        { error: 'Mazo no encontrado' },
        { status: 404 }
      )
    }

    // Comprobamos que la carta pertenezca al mismo usuario.
    const card = db.prepare(`
      SELECT id, quantity AS ownedQuantity
      FROM user_cards
      WHERE id = ? AND user_id = ?
    `).get(userCardId, userId)

    if (!card) {
      return Response.json(
        { error: 'Carta no encontrada' },
        { status: 404 }
      )
    }

// PATCH: actualizamos la cantidad de una carta en el mazo.
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

  // Comprobamos que recibimos un objeto válido.
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

  // La cantidad debe ser un número entero positivo.
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

  // No permitimos más copias que las que tiene el usuario.
  if (quantity > Number(card.ownedQuantity)) {
    return Response.json(
      { error: 'No tienes suficientes cartas en tu colección' },
      { status: 400 }
    )
  }

  // Modificamos únicamente la cantidad dentro del mazo.
  const result = db.prepare(`
    UPDATE deck_cards
    SET quantity = ?
    WHERE deck_id = ? AND user_card_id = ?
  `).run(quantity, deckId, userCardId)

  if (result.changes === 0) {
    return Response.json(
      { error: 'La carta no está en este mazo' },
      { status: 404 }
    )
  }

  // Devolvemos la cantidad actualizada.
  return Response.json({
    deckId,
    userCardId,
    quantity,
    ownedQuantity: Number(card.ownedQuantity)
  })
}
 

    // Eliminamos solo la relación entre el mazo y la carta.
    const result = db.prepare(`
      DELETE FROM deck_cards
      WHERE deck_id = ? AND user_card_id = ?
    `).run(deckId, userCardId)

    if (result.changes === 0) {
      return Response.json(
        { error: 'La carta no está en ese mazo' },
        { status: 404 }
      )
    }

    // HTTP 204 indica que la eliminación fue exitosa.
    return new Response(null, { status: 204 })
  }


  // Reemplaza el borrador completo del mazo dentro de una sola transacciÃ³n.
  if (deckCardsSyncMatch) {
    const deckId = Number(deckCardsSyncMatch[1])

    if (!Number.isSafeInteger(deckId) || deckId < 1) {
      return Response.json(
        { error: 'ID de mazo invÃ¡lido' },
        { status: 400 }
      )
    }

    if (
      request.method !== 'POST' ||
      request.headers.get('Origin') !== 'http://localhost:5173'
    ) {
      return Response.json(
        { error: 'MÃ©todo u origen no permitido' },
        {
          status: request.method === 'POST' ? 403 : 405,
          headers: { Allow: 'POST' }
        }
      )
    }

    const deck = db.prepare(`
      SELECT id FROM decks
      WHERE id = ? AND user_id = ?
    `).get(deckId, userId)

    if (!deck) {
      return Response.json(
        { error: 'Mazo no encontrado' },
        { status: 404 }
      )
    }

    let body: unknown

    try {
      body = await request.json()
    } catch {
      return Response.json(
        { error: 'JSON invÃ¡lido' },
        { status: 400 }
      )
    }

    const bodyRecord = body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body)
      ? body as Record<string, unknown>
      : null

    if (
      !bodyRecord ||
      !Array.isArray(bodyRecord.cards) ||
      bodyRecord.cards.length > 1000
    ) {
      return Response.json(
        { error: 'Cartas del mazo invÃ¡lidas' },
        { status: 400 }
      )
    }

    const cards = bodyRecord.cards as unknown[]
    const normalizedCards: Array<{ userCardId: number; quantity: number }> = []
    const seenCardIds = new Set<number>()

    for (const value of cards) {
      if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        return Response.json(
          { error: 'Cartas del mazo invÃ¡lidas' },
          { status: 400 }
        )
      }

      const card = value as Record<string, unknown>
      const userCardId = card.userCardId
      const quantity = card.quantity

      if (
        typeof userCardId !== 'number' ||
        !Number.isSafeInteger(userCardId) ||
        userCardId < 1 ||
        typeof quantity !== 'number' ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        seenCardIds.has(userCardId)
      ) {
        return Response.json(
          { error: 'Cartas del mazo invÃ¡lidas' },
          { status: 400 }
        )
      }

      seenCardIds.add(userCardId)
      normalizedCards.push({ userCardId, quantity })
    }

    const userCardIds = normalizedCards.map((card) => card.userCardId)
    const ownedCards = userCardIds.length === 0
      ? []
      : db.prepare(`
          SELECT id, quantity
          FROM user_cards
          WHERE user_id = ? AND id IN (${userCardIds.map(() => '?').join(',')})
        `).all(userId, ...userCardIds)
    const ownedById = new Map(
      ownedCards.map((card) => [Number(card.id), Number(card.quantity)])
    )

    for (const card of normalizedCards) {
      const ownedQuantity = ownedById.get(card.userCardId)

      if (ownedQuantity === undefined || card.quantity > ownedQuantity) {
        return Response.json(
          { error: 'No tienes suficientes cartas en tu colecciÃ³n' },
          { status: 400 }
        )
      }
    }

    try {
      db.exec('BEGIN IMMEDIATE')
      db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(deckId)

      for (const card of normalizedCards) {
        db.prepare(`
          INSERT INTO deck_cards (deck_id, user_card_id, quantity)
          VALUES (?, ?, ?)
        `).run(deckId, card.userCardId, card.quantity)
      }

      db.exec('COMMIT')
    } catch {
      try {
        db.exec('ROLLBACK')
      } catch {
        // La transacciÃ³n ya pudo haberse cerrado al informar el error.
      }

      return Response.json(
        { error: 'No se pudo actualizar el mazo' },
        { status: 500 }
      )
    }

    const savedCards = db.prepare(`
      SELECT
        user_cards.id AS userCardId,
        user_cards.card_id AS cardId,
        deck_cards.quantity AS quantity,
        user_cards.quantity AS ownedQuantity
      FROM deck_cards
      INNER JOIN user_cards
        ON deck_cards.user_card_id = user_cards.id
      WHERE deck_cards.deck_id = ?
        AND user_cards.user_id = ?
      ORDER BY user_cards.id DESC
    `).all(deckId, userId)

    return Response.json(savedCards, {
      headers: { 'Cache-Control': 'no-store' }
    })
  }


  // Gestionamos las cartas asociadas a un mazo.
  if (deckCardsMatch) {
    const deckId = Number(deckCardsMatch[1])

    if (!Number.isSafeInteger(deckId) || deckId < 1) {
      return Response.json(
        { error: 'ID de mazo inválido' },
        { status: 400 }
      )
    }

    // Comprobamos que el mazo pertenece al usuario autenticado.
    const deck = db.prepare(`
      SELECT id FROM decks
      WHERE id = ? AND user_id = ?
    `).get(deckId, userId)

    if (!deck) {
      return Response.json(
        { error: 'Mazo no encontrado' },
        { status: 404 }
      )
    }

    // GET: consultar las cartas asociadas al mazo.
    if (request.method === 'GET') {
      const cards = db.prepare(`
        SELECT
          user_cards.id AS userCardId,
          user_cards.card_id AS cardId,
          deck_cards.quantity AS quantity,
          user_cards.quantity AS ownedQuantity
        FROM deck_cards
        INNER JOIN user_cards
          ON deck_cards.user_card_id = user_cards.id
        WHERE deck_cards.deck_id = ?
          AND user_cards.user_id = ?
        ORDER BY user_cards.id DESC
      `).all(deckId, userId)

      return Response.json(cards, {
        headers: { 'Cache-Control': 'no-store' }
      })
    }

    // POST: agregar una carta del inventario al mazo.
    if (request.method === 'POST') {
      if (
        request.headers.get('Origin') !==
        'http://localhost:5173'
      ) {
        return Response.json(
          { error: 'Origen no autorizado' },
          { status: 403 }
        )
      }

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
        Array.isArray(body) ||
        !('userCardId' in body) ||
        typeof body.userCardId !== 'number' ||
        !Number.isSafeInteger(body.userCardId) ||
        body.userCardId < 1
      ) {
        return Response.json(
          { error: 'Identificador de carta inválido' },
          { status: 400 }
        )
      }

      const userCardId = body.userCardId

      // Verificamos que la carta pertenezca al inventario
      // del mismo usuario que creó el mazo.
      const card = db.prepare(`
        SELECT card_id FROM user_cards
        WHERE id = ? AND user_id = ?
      `).get(userCardId, userId)

      if (!card) {
        return Response.json(
          { error: 'Carta no encontrada en tu colección' },
          { status: 404 }
        )
      }

      // Guardamos la relación entre el mazo y la carta.
      const result = db.prepare(`
        INSERT INTO deck_cards (deck_id, user_card_id)
        VALUES (?, ?)
        ON CONFLICT(deck_id, user_card_id) DO NOTHING
      `).run(deckId, userCardId)

      if (result.changes === 0) {
        return Response.json(
          { error: 'La carta ya está en este mazo' },
          { status: 409 }
        )
      }

      return Response.json(
        {
          deckId,
          userCardId,
          cardId: card.card_id
        },
        { status: 201 }
      )
    }

    return Response.json(
      { error: 'Método no permitido' },
      {
        status: 405,
        headers: { Allow: 'GET, POST' }
      }
    )
  }


  // GET: recuperamos solo los mazos del usuario autenticado.
  if (isDecksRoot && request.method === 'GET') {
    const decks = db.prepare(`
      SELECT
        id,
        name,
        description,
        created_at AS createdAt
      FROM decks
      WHERE user_id = ?
      ORDER BY id DESC
    `).all(userId)

    return Response.json(decks, {
      headers: { 'Cache-Control': 'no-store' }
    })
  }

  // POST: creamos un nuevo mazo.
  if (isDecksRoot && request.method === 'POST') {

    // Solo aceptamos modificaciones desde nuestro frontend local.
    if (request.headers.get('Origin') !== 'http://localhost:5173') {
      return Response.json(
        { error: 'Origen no autorizado' },
        { status: 403 }
      )
    }

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

    // El nombre es obligatorio y no puede superar 80 caracteres.
    const name = typeof data.name === 'string'
      ? data.name.trim()
      : ''

    // La descripción es opcional.
    const description = data.description == null
      ? null
      : typeof data.description === 'string'
        ? data.description.trim()
        : undefined

    if (
      !name ||
      name.length > 80 ||
      description === undefined ||
      (description !== null && description.length > 250)
    ) {
      return Response.json(
        { error: 'Nombre o descripción inválidos' },
        { status: 400 }
      )
    }

    // Insertamos el mazo asociado al usuario.
    // Si ya existe otro con el mismo nombre, no lo duplicamos.
    const result = db.prepare(`
      INSERT INTO decks (
        user_id,
        name,
        description
      )
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, name) DO NOTHING
    `).run(userId, name, description || null)

    if (result.changes === 0) {
      return Response.json(
        { error: 'Ya tienes un mazo con ese nombre' },
        { status: 409 }
      )
    }

    // Recuperamos el mazo que acabamos de crear.
    const deck = db.prepare(`
      SELECT
        id,
        name,
        description,
        created_at AS createdAt
      FROM decks
      WHERE id = ? AND user_id = ?
    `).get(Number(result.lastInsertRowid), userId)

    return Response.json(deck, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' }
    })
  }

  // Rutas que trabajan con un mazo específico.
  if (deckMatch) {
    const deckId = Number(deckMatch[1])

    // Comprobamos que el ID sea un número válido.
    if (!Number.isSafeInteger(deckId) || deckId < 1) {
      return Response.json(
        { error: 'ID de mazo inválido' },
        { status: 400 }
      )
    }

    if (
      request.method !== 'PATCH' &&
      request.method !== 'DELETE'
    ) {
      return Response.json(
        { error: 'Método no permitido' },
        {
          status: 405,
          headers: { Allow: 'PATCH, DELETE' }
        }
      )
    }

    // Solo permitimos modificaciones desde nuestro frontend.
    if (request.headers.get('Origin') !== 'http://localhost:5173') {
      return Response.json(
        { error: 'Origen no autorizado' },
        { status: 403 }
      )
    }

    // DELETE: eliminamos un mazo del usuario autenticado.
    if (request.method === 'DELETE') {
      const result = db.prepare(`
        DELETE FROM decks
        WHERE id = ? AND user_id = ?
      `).run(deckId, userId)

      if (result.changes === 0) {
        return Response.json(
          { error: 'Mazo no encontrado' },
          { status: 404 }
        )
      }

      return new Response(null, { status: 204 })
    }

    // PATCH: modificamos el nombre y descripción del mazo.
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

    const name = typeof data.name === 'string'
      ? data.name.trim()
      : ''

    const description = data.description == null
      ? null
      : typeof data.description === 'string'
        ? data.description.trim()
        : undefined

    if (
      !name ||
      name.length > 80 ||
      description === undefined ||
      (description !== null && description.length > 250)
    ) {
      return Response.json(
        { error: 'Nombre o descripción inválidos' },
        { status: 400 }
      )
    }

    // Comprobamos que el mazo pertenece al usuario.
    const existingDeck = db.prepare(`
      SELECT id FROM decks
      WHERE id = ? AND user_id = ?
    `).get(deckId, userId)

    if (!existingDeck) {
      return Response.json(
        { error: 'Mazo no encontrado' },
        { status: 404 }
      )
    }

    // Evitamos nombres duplicados dentro del mismo usuario.
    const duplicate = db.prepare(`
      SELECT id FROM decks
      WHERE user_id = ? AND name = ? AND id != ?
    `).get(userId, name, deckId)

    if (duplicate) {
      return Response.json(
        { error: 'Ya tienes un mazo con ese nombre' },
        { status: 409 }
      )
    }

    // Actualizamos solamente el mazo del usuario autenticado.
    db.prepare(`
      UPDATE decks
      SET name = ?, description = ?
      WHERE id = ? AND user_id = ?
    `).run(name, description || null, deckId, userId)

    // Recuperamos los datos actualizados.
    const updatedDeck = db.prepare(`
      SELECT
        id,
        name,
        description,
        created_at AS createdAt
      FROM decks
      WHERE id = ? AND user_id = ?
    `).get(deckId, userId)

    return Response.json(updatedDeck, {
      headers: { 'Cache-Control': 'no-store' }
    })
  }

  return Response.json(
    { error: 'Método no permitido' },
    {
      status: 405,
      headers: { Allow: 'GET, POST' }
    }
  )
}
