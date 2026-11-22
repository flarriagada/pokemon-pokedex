
const alternateImageCache = new Map()

export function getCardImageUrls(image) {
  if (typeof image !== 'string' || !image.trim()) return []

  const baseUrl = image.trim().replace(/\/+$/, '')

  return [
    `${baseUrl}/low.webp`,
    `${baseUrl}/low.png`
  ]
}

export async function getAlternateCardImage(cardId, language = 'es') {
  if (typeof cardId !== 'string' || !cardId.trim()) return null

  const currentLanguage = language === 'en' ? 'en' : 'es'
  const alternateLanguage = currentLanguage === 'es' ? 'en' : 'es'
  const cacheKey = `${alternateLanguage}:${cardId}`

  if (alternateImageCache.has(cacheKey)) {
    return alternateImageCache.get(cacheKey)
  }

  // Compartimos la promesa para evitar consultas duplicadas simultáneas.
  const request = getCardById(cardId, alternateLanguage)
    .then((card) =>
      typeof card?.image === 'string' && card.image.trim()
        ? card.image.trim()
        : null
    )

  alternateImageCache.set(cacheKey, request)

  try {
    return await request
  } catch (error) {
    // Los fallos temporales podrán reintentarse en una carga posterior.
    if (alternateImageCache.get(cacheKey) === request) {
      alternateImageCache.delete(cacheKey)
    }
    throw error
  }
}

export async function getCards(search = '', page = 1, language = 'es') {
  const params = new URLSearchParams()

  params.set('page', String(page))
  params.set('lang', language === 'en' ? 'en' : 'es')
  if (search.trim()) {
    params.set('search', search.trim())
  }

  const response = await fetch(`/api/cards?${params.toString()}`)

  if (!response.ok) {
    throw new Error('No se pudieron obtener las cartas')
  }

  return response.json()
}

export async function getCardById(cardId, language = 'es') {
  const params = new URLSearchParams()

  params.set('lang', language === 'en' ? 'en' : 'es')

  const response = await fetch(
    `/api/cards/${encodeURIComponent(cardId)}?${params.toString()}`
  )

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error('No se pudieron obtener los detalles')
  }

  return response.json()
}

export async function getSets(language = 'es') {
  const params = new URLSearchParams()

  params.set('lang', language === 'en' ? 'en' : 'es')

  const response = await fetch(`/api/sets?${params.toString()}`)

  if (!response.ok) {
    throw new Error('No se pudieron obtener las expansiones')
  }

  return response.json()
}

export async function getSetById(setId, language = 'es') {
  const params = new URLSearchParams()

  params.set('lang', language === 'en' ? 'en' : 'es')

  const response = await fetch(
    `/api/sets/${encodeURIComponent(setId)}?${params.toString()}`
  )

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error('No se pudieron obtener los detalles de la expansión')
  }

  return response.json()
}
