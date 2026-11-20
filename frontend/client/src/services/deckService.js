const DECKS_URL = '/api/decks'

// Consulta los mazos guardados en SQLite.
export async function getDecks() {
  const response = await fetch(DECKS_URL, {
    credentials: 'same-origin',
    cache: 'no-store'
  })

  if (response.status === 401) {
    throw new Error('Debes iniciar sesión para ver tus mazos.')
  }

  if (!response.ok) {
    throw new Error('No se pudieron cargar los mazos.')
  }

  return response.json()
}

// Envía los datos de un nuevo mazo al backend.
export async function createDeck(name, description) {
  const response = await fetch(DECKS_URL, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      description
    })
  })

  if (response.status === 401) {
    throw new Error('Debes iniciar sesión para crear mazos.')
  }

  if (response.status === 409) {
    throw new Error('Ya tienes un mazo con ese nombre.')
  }

  if (!response.ok) {
    throw new Error('No se pudo crear el mazo.')
  }

  return response.json()
}

 // Obtiene las cartas asociadas a un mazo.
export async function getDeckCards(deckId) {
  const response = await fetch(
    `/api/decks/${deckId}/cards`,
    { credentials: 'same-origin', cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error('No se pudieron cargar las cartas del mazo.')
  }

  return response.json()
}

// Agrega al mazo una carta que ya existe en nuestra colección.
export async function addCardToDeck(deckId, userCardId) {
  const response = await fetch(
    `/api/decks/${deckId}/cards`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userCardId })
    }
  )

  if (response.status === 409) {
    throw new Error('Esta carta ya pertenece al mazo.')
  }

  if (!response.ok) {
    throw new Error('No se pudo agregar la carta al mazo.')
  }

  return response.json()
}

// Modifica cuántas unidades de una carta hay en el mazo.
export async function updateDeckCardQuantity(
  deckId,
  userCardId,
  quantity
) {
  const response = await fetch(
    `/api/decks/${deckId}/cards/${userCardId}`,
    {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ quantity })
    }
  )

  if (!response.ok) {
    throw new Error('No se pudo actualizar la cantidad.')
  }

  return response.json()
}

// Quita la carta del mazo sin eliminarla de la colección.
export async function removeCardFromDeck(deckId, userCardId) {
  const response = await fetch(
    `/api/decks/${deckId}/cards/${userCardId}`,
    {
      method: 'DELETE',
      credentials: 'same-origin'
    }
  )

  if (!response.ok) {
    throw new Error('No se pudo quitar la carta del mazo.')
  }
}

 // Modifica el nombre y descripción de un mazo.
export async function updateDeck(deckId, name, description) {
  const response = await fetch(`/api/decks/${deckId}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, description })
  })

  if (response.status === 409) {
    throw new Error('Ya tienes otro mazo con ese nombre.')
  }

  if (!response.ok) {
    throw new Error('No se pudo actualizar el mazo.')
  }

  return response.json()
}

// Elimina un mazo, pero conserva el inventario general.
export async function deleteDeck(deckId) {
  const response = await fetch(`/api/decks/${deckId}`, {
    method: 'DELETE',
    credentials: 'same-origin'
  })

  if (!response.ok) {
    throw new Error('No se pudo eliminar el mazo.')
  }
}
