
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
