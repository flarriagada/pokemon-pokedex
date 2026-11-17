
const API_URL = 'https://api.tcgdex.net/v2/es'

export async function getCardsFromTcgdex(
  search: string = '',
  page: number = 1
) {
  const url = new URL(`${API_URL}/cards`)

  url.searchParams.set('pagination:page', String(page))
  url.searchParams.set('pagination:itemsPerPage', '12')

  if (search.trim()) {
    url.searchParams.set('name', search.trim())
  }

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('Error al consultar TCGdex')
  }

  return response.json()
}

export async function getCardFromTcgdex(cardId: string) {
  const url = `${API_URL}/cards/${encodeURIComponent(cardId)}`

  const response = await fetch(url)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error('Error al consultar los detalles de la carta')
  }

  return response.json()
}

