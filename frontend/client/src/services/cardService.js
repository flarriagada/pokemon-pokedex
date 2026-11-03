
const API_URL = 'https://api.tcgdex.net/v2/es'

export async function getCards(search= '', page = 1) {
  const url = new URL(`${API_URL}/cards`)
  
  url.searchParams.set('pagination:page', String(page))
  url.searchParams.set('pagination:itemsPerPage', '12')

  if (search.trim()) {
    url.searchParams.set('name', search.trim())
  }

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('No se pudieron obtener las cartas')
  }

  return response.json()
}