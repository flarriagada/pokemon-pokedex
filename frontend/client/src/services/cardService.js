
export async function getCards(search = '', page = 1) {
  const params = new URLSearchParams()

  params.set('page', String(page))
  if (search.trim()) {
    params.set('search', search.trim())
  }

  const response = await fetch(`/api/cards?${params.toString()}`)

  if (!response.ok) {
    throw new Error('No se pudieron obtener las cartas')
  }

  return response.json()
}

export async function getCardById(cardId) {
  const response = await fetch(
    `/api/cards/${encodeURIComponent(cardId)}`
  )

  if (!response.ok) {
    throw new Error('No se pudieron obtener los detalles')
  }

  return response.json()
}
