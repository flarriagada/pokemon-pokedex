
const API_URL = 'https://api.tcgdex.net/v2'

function getSupportedLanguage(language: string) {
  return language === 'en' ? 'en' : 'es'
}

export async function getCardsFromTcgdex(
  search: string = '',
  page: number = 1,
  language: string = 'es'
) {
  const supportedLanguage = getSupportedLanguage(language)
  const url = new URL(`${API_URL}/${supportedLanguage}/cards`)

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

export async function getCardFromTcgdex(
  cardId: string,
  language: string = 'es'
) {
  const supportedLanguage = getSupportedLanguage(language)
  const url = `${API_URL}/${supportedLanguage}/cards/${encodeURIComponent(cardId)}`

  const response = await fetch(url)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error('Error al consultar los detalles de la carta')
  }

  return response.json()
}

export async function getSetsFromTcgdex(language: string = 'es') {
  const supportedLanguage = getSupportedLanguage(language)
  const url = `${API_URL}/${supportedLanguage}/sets`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('Error al consultar las expansiones de TCGdex')
  }

  return response.json()
}

export async function getSetFromTcgdex(
  setId: string,
  language: string = 'es'
) {
  const supportedLanguage = getSupportedLanguage(language)
  const url = `${API_URL}/${supportedLanguage}/sets/${encodeURIComponent(setId)}`
  const response = await fetch(url)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error('Error al consultar los detalles de la expansión')
  }

  return response.json()
}

