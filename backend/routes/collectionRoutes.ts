import type { DatabaseSync } from 'node:sqlite'
import { getUserFromSession } from '../services/sessionService.ts'
import { getCardFromTcgdex } from '../services/tcgdexService.ts'

const TRANSACTIONS_PAGE_SIZE = 20
const COLLECTION_PAGE_SIZE = 24
const COLLECTION_MAX_PAGE_SIZE = 50
const MAX_CARD_QUANTITY = 1_000_000

function isValidTransactionDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const date = new Date(`${value}T00:00:00.000Z`)

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
}

export async function handleCollectionRequest(
  request: Request,
  url: URL,
  db: DatabaseSync
): Promise<Response | null> {


const isCollectionRoot = url.pathname === '/api/collection'
const isTransactionsRoot = url.pathname === '/api/transactions'
const isTagsRoot = url.pathname === '/api/tags'

const itemMatch = url.pathname.match(
  /^\/api\/collection\/(\d+)$/
)

const tradeMatch = url.pathname.match(
  /^\/api\/collection\/(\d+)\/trade$/
)

const tagMatch = url.pathname.match(
  /^\/api\/tags\/(\d+)$/
)

const cardTagMatch = url.pathname.match(
  /^\/api\/collection\/(\d+)\/tags\/(\d+)$/
)

if (
  !isCollectionRoot &&
  !isTransactionsRoot &&
  !isTagsRoot &&
  !itemMatch &&
  !tradeMatch &&
  !tagMatch &&
  !cardTagMatch
) {
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

  if (isTagsRoot && request.method === 'GET') {
    const includeAssignments = url.searchParams.get('assignments') !== 'none'
    const tags = db.prepare(`
      SELECT
        id,
        name,
        created_at AS createdAt
      FROM tags
      WHERE user_id = ?
      ORDER BY name COLLATE NOCASE, id
    `).all(userId)
    const assignments = includeAssignments
      ? db.prepare(`
          SELECT
            user_card_tags.user_card_id AS userCardId,
            user_card_tags.tag_id AS tagId
          FROM user_card_tags
          INNER JOIN tags ON tags.id = user_card_tags.tag_id
          INNER JOIN user_cards ON user_cards.id = user_card_tags.user_card_id
          WHERE tags.user_id = ? AND user_cards.user_id = ?
          ORDER BY user_card_tags.user_card_id, user_card_tags.tag_id
        `).all(userId, userId)
      : []

    return Response.json({ tags, assignments })
  }

  if (isTagsRoot && request.method === 'POST') {
    let body: unknown

    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'JSON inválido' }, { status: 400 })
    }

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Datos inválidos' }, { status: 400 })
    }

    const name = (body as Record<string, unknown>).name

    if (typeof name !== 'string') {
      return Response.json({ error: 'Nombre de etiqueta inválido' }, { status: 400 })
    }

    const normalizedName = name.trim().replace(/\s+/g, ' ')

    if (normalizedName.length < 1 || normalizedName.length > 40) {
      return Response.json({ error: 'Nombre de etiqueta inválido' }, { status: 400 })
    }

    const existingTags = db.prepare(`
      SELECT id, name
      FROM tags
      WHERE user_id = ?
    `).all(userId)
    const duplicate = existingTags.find((tag) =>
      String(tag.name).localeCompare(normalizedName, undefined, {
        sensitivity: 'base'
      }) === 0
    )

    if (duplicate) {
      return Response.json({ error: 'La etiqueta ya existe' }, { status: 409 })
    }

    const result = db.prepare(`
      INSERT INTO tags (user_id, name)
      VALUES (?, ?)
    `).run(userId, normalizedName)
    const createdTag = db.prepare(`
      SELECT id, name, created_at AS createdAt
      FROM tags
      WHERE id = ? AND user_id = ?
    `).get(result.lastInsertRowid, userId)

    return Response.json(createdTag, { status: 201 })
  }

  if (isTagsRoot) {
    return Response.json(
      { error: 'Método no permitido' },
      { status: 405, headers: { Allow: 'GET, POST' } }
    )
  }

  if (tagMatch) {
    const tagId = Number(tagMatch[1])

    if (!Number.isSafeInteger(tagId) || tagId < 1) {
      return Response.json({ error: 'ID inválido' }, { status: 400 })
    }

    if (request.method !== 'DELETE') {
      return Response.json(
        { error: 'Método no permitido' },
        { status: 405, headers: { Allow: 'DELETE' } }
      )
    }

    const result = db.prepare(`
      DELETE FROM tags
      WHERE id = ? AND user_id = ?
    `).run(tagId, userId)

    if (result.changes === 0) {
      return Response.json({ error: 'Etiqueta no encontrada' }, { status: 404 })
    }

    return new Response(null, { status: 204 })
  }

  if (cardTagMatch) {
    const userCardId = Number(cardTagMatch[1])
    const tagId = Number(cardTagMatch[2])

    if (
      !Number.isSafeInteger(userCardId) ||
      userCardId < 1 ||
      !Number.isSafeInteger(tagId) ||
      tagId < 1
    ) {
      return Response.json({ error: 'ID inválido' }, { status: 400 })
    }

    const ownership = db.prepare(`
      SELECT user_cards.id
      FROM user_cards
      INNER JOIN tags ON tags.id = ?
      WHERE user_cards.id = ?
        AND user_cards.user_id = ?
        AND tags.user_id = ?
    `).get(tagId, userCardId, userId, userId)

    if (!ownership) {
      return Response.json(
        { error: 'Carta o etiqueta no encontrada' },
        { status: 404 }
      )
    }

    if (request.method === 'POST') {
      db.prepare(`
        INSERT OR IGNORE INTO user_card_tags (user_card_id, tag_id)
        VALUES (?, ?)
      `).run(userCardId, tagId)

      return Response.json({ userCardId, tagId }, { status: 200 })
    }

    if (request.method === 'DELETE') {
      db.prepare(`
        DELETE FROM user_card_tags
        WHERE user_card_id = ? AND tag_id = ?
      `).run(userCardId, tagId)

      return new Response(null, { status: 204 })
    }

    return Response.json(
      { error: 'Método no permitido' },
      { status: 405, headers: { Allow: 'POST, DELETE' } }
    )
  }

  if (isTransactionsRoot && request.method === 'GET') {
    const requestedPage = Number(url.searchParams.get('page') ?? '1')
    const transactionType = url.searchParams.get('type') ?? 'all'

    if (
      !Number.isSafeInteger(requestedPage) ||
      requestedPage < 1 ||
      requestedPage > 1_000_000 ||
      !['all', 'purchase', 'sale'].includes(transactionType)
    ) {
      return Response.json(
        { error: 'Paginación o filtro inválido' },
        { status: 400 }
      )
    }

    const countRow = transactionType === 'all'
      ? db.prepare(`
          SELECT COUNT(*) AS total
          FROM card_transactions
          WHERE user_id = ?
        `).get(userId)
      : db.prepare(`
          SELECT COUNT(*) AS total
          FROM card_transactions
          WHERE user_id = ? AND transaction_type = ?
        `).get(userId, transactionType)
    const total = Number(countRow?.total ?? 0)
    const totalPages = Math.ceil(total / TRANSACTIONS_PAGE_SIZE)
    const page = totalPages > 0
      ? Math.min(requestedPage, totalPages)
      : 1
    const offset = (page - 1) * TRANSACTIONS_PAGE_SIZE
    const transactions = db.prepare(`
      SELECT
        id,
        card_id AS cardId,
        transaction_type AS transactionType,
        quantity,
        unit_price AS unitPrice,
        transaction_date AS transactionDate,
        notes,
        created_at AS createdAt,
        quantity * unit_price AS totalPrice
      FROM card_transactions
      WHERE user_id = ?
        AND (? = 'all' OR transaction_type = ?)
      ORDER BY transaction_date DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(
      userId,
      transactionType,
      transactionType,
      TRANSACTIONS_PAGE_SIZE,
      offset
    )

    return Response.json({
      transactions,
      page,
      pageSize: TRANSACTIONS_PAGE_SIZE,
      total,
      totalPages
    })
  }

  if (isTransactionsRoot && request.method === 'POST') {
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
    const transactionType = data.transactionType
    const quantity = data.quantity
    const unitPrice = data.unitPrice
    const transactionDate = data.transactionDate
    const notes = data.notes

    if (
      typeof cardId !== 'string' ||
      !cardId.trim() ||
      cardId.length > 100 ||
      !/^[a-zA-Z0-9._-]+$/.test(cardId.trim()) ||
      (transactionType !== 'purchase' && transactionType !== 'sale') ||
      typeof quantity !== 'number' ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      typeof unitPrice !== 'number' ||
      !Number.isSafeInteger(unitPrice) ||
      unitPrice < 0 ||
      !Number.isSafeInteger(quantity * unitPrice) ||
      typeof transactionDate !== 'string' ||
      !isValidTransactionDate(transactionDate) ||
      (
        notes !== undefined &&
        notes !== null &&
        typeof notes !== 'string'
      )
    ) {
      return Response.json(
        { error: 'Datos del movimiento inválidos' },
        { status: 400 }
      )
    }

    const normalizedCardId = cardId.trim()
    const normalizedNotes = typeof notes === 'string'
      ? notes.trim()
      : ''

    if (normalizedNotes.length > 250) {
      return Response.json(
        { error: 'Observaciones demasiado extensas' },
        { status: 400 }
      )
    }

    const cardChecks = await Promise.allSettled([
      getCardFromTcgdex(normalizedCardId, 'es'),
      getCardFromTcgdex(normalizedCardId, 'en')
    ])
    const officialCardExists = cardChecks.some(
      (result) => result.status === 'fulfilled' && result.value !== null
    )

    if (!officialCardExists && cardChecks.some(
      (result) => result.status === 'rejected'
    )) {
      return Response.json(
        { error: 'No se pudo validar la carta en TCGdex' },
        { status: 502 }
      )
    }

    if (!officialCardExists) {
      return Response.json(
        { error: 'Carta oficial no encontrada' },
        { status: 404 }
      )
    }

    const result = db.prepare(`
      INSERT INTO card_transactions (
        user_id,
        card_id,
        transaction_type,
        quantity,
        unit_price,
        transaction_date,
        notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      normalizedCardId,
      transactionType,
      quantity,
      unitPrice,
      transactionDate,
      normalizedNotes || null
    )

    const createdTransaction = db.prepare(`
      SELECT
        id,
        card_id AS cardId,
        transaction_type AS transactionType,
        quantity,
        unit_price AS unitPrice,
        transaction_date AS transactionDate,
        notes,
        created_at AS createdAt,
        quantity * unit_price AS totalPrice
      FROM card_transactions
      WHERE id = ? AND user_id = ?
    `).get(result.lastInsertRowid, userId)

    return Response.json(createdTransaction, { status: 201 })
  }

  if (isTransactionsRoot) {
    return Response.json(
      { error: 'Método no permitido' },
      {
        status: 405,
        headers: { Allow: 'GET, POST' }
      }
    )
  }


  // GET: consultar la colección
  if (isCollectionRoot && request.method === 'GET') {
    const summaryOnly = url.searchParams.get('summary') === 'owned'

    if (summaryOnly) {
      const cards = db.prepare(`
        SELECT id, card_id AS cardId, quantity, for_trade AS forTrade
        FROM user_cards
        WHERE user_id = ?
        ORDER BY id DESC
      `).all(userId)

      return Response.json({
        cards: cards.map((card) => ({
          ...card,
          forTrade: Boolean(card.forTrade)
        })),
        totalQuantity: cards.reduce(
          (total, card) => total + Number(card.quantity),
          0
        )
      })
    }

    // Conservamos el formato anterior para consumidores todavía no paginados.
    if (!url.searchParams.has('page')) {
      const cards = db.prepare(`
        SELECT
          id,
          card_id AS cardId,
          quantity,
          for_trade AS forTrade,
          created_at AS createdAt
        FROM user_cards
        WHERE user_id = ?
        ORDER BY id DESC
      `).all(userId)

      return Response.json(
        cards.map((card) => ({
          ...card,
          forTrade: Boolean(card.forTrade)
        }))
      )
    }

    const requestedPage = Number(url.searchParams.get('page') ?? '1')
    const requestedPageSize = Number(
      url.searchParams.get('pageSize') ?? COLLECTION_PAGE_SIZE
    )
    const language = url.searchParams.get('lang') ?? 'es'
    const search = (url.searchParams.get('search') ?? '').trim()
    const rarity = (url.searchParams.get('rarity') ?? '').trim()
    const setId = (url.searchParams.get('setId') ?? '').trim()
    const trade = url.searchParams.get('trade') ?? 'all'
    const tag = url.searchParams.get('tag') ?? 'all'
    const sort = url.searchParams.get('sort') ?? 'name-asc'

    if (
      !Number.isSafeInteger(requestedPage) ||
      requestedPage < 1 ||
      requestedPage > 1_000_000 ||
      !Number.isSafeInteger(requestedPageSize) ||
      requestedPageSize < 1 ||
      requestedPageSize > COLLECTION_MAX_PAGE_SIZE ||
      !['es', 'en'].includes(language) ||
      search.length > 100 ||
      rarity.length > 100 ||
      setId.length > 100 ||
      !['all', 'true'].includes(trade) ||
      ![
        'name-asc',
        'name-desc',
        'quantity-asc',
        'quantity-desc',
        'rarity',
        'set'
      ].includes(sort) ||
      !(
        tag === 'all' ||
        tag === 'none' ||
        (/^\d+$/.test(tag) && Number.isSafeInteger(Number(tag)))
      )
    ) {
      return Response.json(
        { error: 'Paginación o filtros inválidos' },
        { status: 400 }
      )
    }

    const conditions = ['user_cards.user_id = ?']
    const parameters: Array<string | number> = [userId]

    if (search) {
      const escapedSearch = search
        .toLocaleLowerCase()
        .replace(/[\\%_]/g, '\\$&')
      conditions.push(`(
        lower(COALESCE(card_metadata.name, '')) LIKE ? ESCAPE '\\'
        OR lower(user_cards.card_id) LIKE ? ESCAPE '\\'
      )`)
      parameters.push(`%${escapedSearch}%`, `%${escapedSearch}%`)
    }

    if (rarity) {
      conditions.push('card_metadata.rarity = ? COLLATE NOCASE')
      parameters.push(rarity)
    }

    if (setId) {
      conditions.push('card_metadata.set_id = ?')
      parameters.push(setId)
    }

    if (trade === 'true') conditions.push('user_cards.for_trade = 1')

    if (tag === 'none') {
      conditions.push(`NOT EXISTS (
        SELECT 1 FROM user_card_tags
        WHERE user_card_tags.user_card_id = user_cards.id
      )`)
    } else if (tag !== 'all') {
      conditions.push(`EXISTS (
        SELECT 1
        FROM user_card_tags
        INNER JOIN tags ON tags.id = user_card_tags.tag_id
        WHERE user_card_tags.user_card_id = user_cards.id
          AND user_card_tags.tag_id = ?
          AND tags.user_id = user_cards.user_id
      )`)
      parameters.push(Number(tag))
    }

    const whereClause = conditions.join(' AND ')
    const countRow = db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(user_cards.quantity), 0) AS totalQuantity
      FROM user_cards
      LEFT JOIN card_metadata
        ON card_metadata.card_id = user_cards.card_id
        AND card_metadata.language = ?
      WHERE ${whereClause}
    `).get(language, ...parameters)
    const total = Number(countRow?.total ?? 0)
    const totalPages = Math.ceil(total / requestedPageSize)
    const page = totalPages > 0
      ? Math.min(requestedPage, totalPages)
      : 1
    const offset = (page - 1) * requestedPageSize
    const orderBy = {
      'name-asc': "COALESCE(card_metadata.name, user_cards.card_id) COLLATE NOCASE ASC, user_cards.id DESC",
      'name-desc': "COALESCE(card_metadata.name, user_cards.card_id) COLLATE NOCASE DESC, user_cards.id DESC",
      'quantity-asc': 'user_cards.quantity ASC, user_cards.id DESC',
      'quantity-desc': 'user_cards.quantity DESC, user_cards.id DESC',
      rarity: "COALESCE(card_metadata.rarity, '') COLLATE NOCASE ASC, user_cards.id DESC",
      set: "COALESCE(card_metadata.set_name, '') COLLATE NOCASE ASC, user_cards.id DESC"
    }[sort]
    const rows = db.prepare(`
      SELECT
        user_cards.id,
        user_cards.card_id AS cardId,
        user_cards.quantity,
        user_cards.for_trade AS forTrade,
        user_cards.created_at AS createdAt,
        card_metadata.details_json AS detailsJson,
        (
          SELECT GROUP_CONCAT(user_card_tags.tag_id)
          FROM user_card_tags
          INNER JOIN tags ON tags.id = user_card_tags.tag_id
          WHERE user_card_tags.user_card_id = user_cards.id
            AND tags.user_id = user_cards.user_id
        ) AS tagIds
      FROM user_cards
      LEFT JOIN card_metadata
        ON card_metadata.card_id = user_cards.card_id
        AND card_metadata.language = ?
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(
      language,
      ...parameters,
      requestedPageSize,
      offset
    )
    const cards = rows.map((row) => {
      let details = null

      if (typeof row.detailsJson === 'string') {
        try {
          details = JSON.parse(row.detailsJson)
        } catch {
          details = null
        }
      }

      return {
        id: row.id,
        cardId: row.cardId,
        quantity: row.quantity,
        forTrade: Boolean(row.forTrade),
        createdAt: row.createdAt,
        details,
        tagIds: typeof row.tagIds === 'string' && row.tagIds
          ? row.tagIds.split(',').map(Number)
          : []
      }
    })

    return Response.json({
      cards,
      page,
      pageSize: requestedPageSize,
      total,
      totalQuantity: Number(countRow?.totalQuantity ?? 0),
      totalPages
    })
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
      quantity < 1 ||
      quantity > MAX_CARD_QUANTITY
    ) {
      return Response.json(
        { error: 'Carta o cantidad inválida' },
        { status: 400 }
      )
    }

    const normalizedId = cardId.trim()
    const existingCard = db.prepare(`
      SELECT quantity
      FROM user_cards
      WHERE user_id = ? AND card_id = ?
    `).get(userId, normalizedId)
    const nextQuantity = Number(existingCard?.quantity ?? 0) + quantity

    if (!Number.isSafeInteger(nextQuantity) || nextQuantity > MAX_CARD_QUANTITY) {
      return Response.json(
        { error: 'La cantidad total de la carta es demasiado alta' },
        { status: 400 }
      )
    }

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

  if (tradeMatch) {
    const itemId = Number(tradeMatch[1])

    if (!Number.isSafeInteger(itemId) || itemId < 1) {
      return Response.json(
        { error: 'ID inválido' },
        { status: 400 }
      )
    }

    if (request.method !== 'PATCH') {
      return Response.json(
        { error: 'Método no permitido' },
        {
          status: 405,
          headers: { Allow: 'PATCH' }
        }
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
    const forTrade = data.forTrade

    if (typeof forTrade !== 'boolean') {
      return Response.json(
        { error: 'Disponibilidad inválida' },
        { status: 400 }
      )
    }

    const result = db.prepare(`
      UPDATE user_cards
      SET for_trade = ?
      WHERE id = ? AND user_id = ?
    `).run(forTrade ? 1 : 0, itemId, userId)

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
        for_trade AS forTrade,
        created_at AS createdAt
      FROM user_cards
      WHERE id = ? AND user_id = ?
    `).get(itemId, userId)

    return Response.json({
      ...updatedCard,
      forTrade: Boolean(updatedCard?.forTrade)
    })
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
        quantity < 1 ||
        quantity > MAX_CARD_QUANTITY
      ) {
        return Response.json(
          { error: 'Cantidad inválida' },
          { status: 400 }
        )
      }

      const deckRequirement = db.prepare(`
        SELECT COALESCE(MAX(quantity), 0) AS minimumQuantity
        FROM deck_cards
        WHERE user_card_id = ?
      `).get(itemId)

      if (quantity < Number(deckRequirement?.minimumQuantity ?? 0)) {
        return Response.json(
          { error: 'La cantidad es menor que la utilizada en un mazo' },
          { status: 409 }
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
