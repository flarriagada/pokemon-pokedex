
const alternateImageCache = new Map()

export function getCardImageUrls(image) {
  if (typeof image !== 'string' || !image.trim()) return []

  const baseUrl = image.trim().replace(/\/+$/, '')

  if (/\.(?:avif|webp|png|jpe?g)(?:\?.*)?$/i.test(baseUrl)) {
    return [baseUrl]
  }

  return [
    `${baseUrl}/low.webp`,
    `${baseUrl}/low.png`
  ]
}

export async function getAlternateCardImage(cardId, language = 'es') {
  if (typeof cardId !== 'string' || !cardId.trim()) return null

  const currentLanguage = language === 'en' ? 'en' : 'es'
  const cacheKey = `${currentLanguage}:${cardId}`

  if (alternateImageCache.has(cacheKey)) {
    return alternateImageCache.get(cacheKey)
  }

  // Compartimos la promesa para evitar consultas duplicadas simultáneas.
  const request = fetch(
    `/api/cards/${encodeURIComponent(cardId)}/fallback-image?lang=${currentLanguage}`
  ).then(async (response) => {
    if (response.status === 404) return null
    if (!response.ok) throw new Error('No se pudo obtener la imagen de respaldo')

    const result = await response.json()
    return typeof result.image === 'string' && result.image.trim()
      ? result.image.trim()
      : null
  })

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

export async function getCards(
  search = '',
  page = 1,
  language = 'es',
  localId = '',
  exactLocalId = false,
  hp = ''
) {
  const params = new URLSearchParams()

  params.set('page', String(page))
  params.set('lang', language === 'en' ? 'en' : 'es')
  if (search.trim()) {
    params.set('search', search.trim())
  }
  if (localId.trim()) {
    params.set('localId', localId.trim())
    if (exactLocalId) {
      params.set('exactLocalId', 'true')
    }
  }
  if (hp.trim()) {
    params.set('hp', hp.trim())
  }

  const response = await fetch(`/api/cards?${params.toString()}`)

  if (!response.ok) {
    throw new Error('No se pudieron obtener las cartas')
  }

  return response.json()
}

export async function getLastCardPage(search = '', language = 'es') {
  const params = new URLSearchParams()

  params.set('lang', language === 'en' ? 'en' : 'es')
  if (search.trim()) {
    params.set('search', search.trim())
  }

  const response = await fetch(
    `/api/cards/last-page?${params.toString()}`
  )

  if (!response.ok) {
    throw new Error('No se pudo obtener la última página')
  }

  const result = await response.json()

  return Number.isInteger(result.lastPage) && result.lastPage >= 0
    ? result.lastPage
    : 0
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

export async function getSets(language = 'es', search = '') {
  const params = new URLSearchParams()

  params.set('lang', language === 'en' ? 'en' : 'es')
  if (search.trim()) {
    params.set('search', search.trim())
  }

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
