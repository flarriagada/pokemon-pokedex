
const COLLECTION_URL = '/api/collection'
const TRANSACTIONS_URL = '/api/transactions'
const TAGS_URL = '/api/tags'

export async function getCollection() {
  const response = await fetch(COLLECTION_URL)
  if(response.status===401){
    throw new Error(
      'Debes iniciar ssesión para ver tu colección'
    )
  }

  if(!response.ok){
    throw new Error(
      'No se pudo obtener la colección'
    )
  }

  return response.json()
}

export async function getCollectionPage({
  page = 1,
  pageSize = 24,
  language = 'es',
  search = '',
  rarity = '',
  setId = '',
  trade = 'all',
  tag = 'all',
  sort = 'name-asc'
} = {}) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    lang: language === 'en' ? 'en' : 'es',
    trade,
    tag,
    sort
  })

  if (search.trim()) params.set('search', search.trim())
  if (rarity.trim()) params.set('rarity', rarity.trim())
  if (setId.trim()) params.set('setId', setId.trim())

  const response = await fetch(`${COLLECTION_URL}?${params.toString()}`)

  if (!response.ok) {
    const error = new Error('No se pudo obtener la página de la colección')
    error.status = response.status
    throw error
  }

  return response.json()
}

export async function getCollectionSummary() {
  const response = await fetch(`${COLLECTION_URL}?summary=owned`)

  if (!response.ok) {
    throw new Error('No se pudo obtener el resumen de la colección')
  }

  return response.json()
}
  
export async function addCardToCollection(cardId, quantity = 1) {
  const response = await fetch(COLLECTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      cardId,
      quantity
    })
  })

  if (!response.ok) {
    throw new Error('No se pudo agregar la carta')
  }

  return response.json()
}

export async function updateCollectionQuantity(id, quantity) {
  const response = await fetch(`${COLLECTION_URL}/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ quantity })
  })

  if (!response.ok) {
    throw new Error('No se pudo actualizar la cantidad')
  }

  return response.json()
}

export async function updateCardTradeStatus(id, forTrade) {
  const response = await fetch(`${COLLECTION_URL}/${id}/trade`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ forTrade })
  })

  if (!response.ok) {
    throw new Error('No se pudo actualizar la disponibilidad')
  }

  return response.json()
}

export async function deleteCollectionCard(id) {
  const response = await fetch(`${COLLECTION_URL}/${id}`, {
    method: 'DELETE'
  })

  if (!response.ok) {
    throw new Error('No se pudo eliminar la carta')
  }
}

export async function getTransactions(page = 1, type = 'all') {
  const params = new URLSearchParams({
    page: String(page),
    type
  })
  const response = await fetch(`${TRANSACTIONS_URL}?${params.toString()}`)

  if (!response.ok) {
    throw new Error('No se pudo obtener el historial')
  }

  return response.json()
}

export async function createTransaction(data) {
  const response = await fetch(TRANSACTIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error('No se pudo registrar el movimiento')
    error.status = response.status
    error.code = body.error
    throw error
  }

  return response.json()
}

export async function getTags({ includeAssignments = true } = {}) {
  const params = new URLSearchParams()
  if (!includeAssignments) params.set('assignments', 'none')
  const query = params.toString()
  const response = await fetch(`${TAGS_URL}${query ? `?${query}` : ''}`)

  if (!response.ok) throw new Error('No se pudieron obtener las etiquetas')
  return response.json()
}

export async function createTag(name) {
  const response = await fetch(TAGS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error('No se pudo crear la etiqueta')
    error.status = response.status
    error.code = body.error
    throw error
  }

  return response.json()
}

export async function deleteTag(id) {
  const response = await fetch(`${TAGS_URL}/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('No se pudo eliminar la etiqueta')
}

export async function assignTagToCard(userCardId, tagId) {
  const response = await fetch(
    `${COLLECTION_URL}/${userCardId}/tags/${tagId}`,
    { method: 'POST' }
  )

  if (!response.ok) throw new Error('No se pudo asignar la etiqueta')
  return response.json()
}

export async function removeTagFromCard(userCardId, tagId) {
  const response = await fetch(
    `${COLLECTION_URL}/${userCardId}/tags/${tagId}`,
    { method: 'DELETE' }
  )

  if (!response.ok) throw new Error('No se pudo quitar la etiqueta')
}
