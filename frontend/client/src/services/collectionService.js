
const COLLECTION_URL = '/api/collection'

export async function getCollection() {
  const response = await fetch(COLLECTION_URL)

  if (!response.ok) {
    throw new Error('No se pudo obtener la colección')
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
