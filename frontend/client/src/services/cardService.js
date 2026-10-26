
const API_URL = 'https://api.tcgdex.net/v2/es'

export async function getCards(search) {
  const name = search.trim().toLowerCase()

  if (!name) {
    return []
  }

  const url = new URL(`${API_URL}/cards`)
  url.searchParams.set('name', name)

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('No se pudieron obtener las cartas')
  }

  return await response.json()
}
