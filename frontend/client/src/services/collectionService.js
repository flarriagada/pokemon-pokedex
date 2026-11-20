
const COLLECTION_URL = '/api/collection'

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

export async function deleteCollectionCard(id) {
  const response = await fetch(`${COLLECTION_URL}/${id}`, {
    method: 'DELETE'
  })

  if (!response.ok) {
    throw new Error('No se pudo eliminar la carta')
  }
}
