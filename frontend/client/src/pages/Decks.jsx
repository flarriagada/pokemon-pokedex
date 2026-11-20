import { useEffect, useState } from 'react'
import { getDecks, createDeck, getDeckCards, addCardToDeck,
         updateDeckCardQuantity, removeCardFromDeck, updateDeck, deleteDeck} from '../services/deckService'
import { getCollection } from '../services/collectionService'
import { getCardById } from '../services/cardService'
import './Decks.css'

function Decks() {
  // Guardamos Mazos
  const [decks, setDecks] = useState([])
  // Guardamos lo que escribe el usuario.
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  // Estados de la interfaz
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState('')
  // Que mazo estamos viendo
  const [activeDeckId, setActiveDeckId] = useState(null)
  // Cartas disponibles en nuestra colección
  const [collectionCards, setCollectionCards] = useState([])
  // Cartas que ya están asociadas al mazo
  const [deckCards, setDeckCards] = useState([])
  // Carta seleccionada en el formulario
  const [selectedUserCardId, setSelectedUserCardId] = useState('')
  // Controlamos la carga y las acciones sobre las cartas
  const [cardsLoading, setCardsLoading] = useState(false)
  const [addingCard, setAddingCard] = useState(false)
  const [cardsError, setCardsError] = useState('')
  const [cardsMessage, setCardsMessage] = useState('')
  // Identifica que carta estamos modificando
  const [busyCardId, setBusyCardId] = useState(null)
  const [editingDeckId, setEditingDeckId] = useState(null) // Que mazo estamos editando
  // Lo que escrbimos al editar
  const [editName, setEditName] = useState('') 
  const [editDescription, setEditDescription] = useState('')
  const [busyDeckId, setBusyDeckId] = useState(null) // Evita editar o eliminar varias veces mientras guardamos
  const [deckActionError, setDeckActionError] = useState('') //errores




  // Recuperamos los mazos cuando abrimos la página.
  useEffect(() => {
    let cancelled = false

    async function loadDecks() {
      try {
        const result = await getDecks()

        if (!cancelled) {
          setDecks(result)
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error.message)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadDecks()

    return () => {
      cancelled = true
    }
  }, [])

  // Se ejecuta cuando enviamos el formulario.
  async function handleCreateDeck(event) {
    event.preventDefault()

    if (saving) return

    const normalizedName = name.trim()

    if (!normalizedName) {
      setMessage('Debes escribir un nombre para el mazo.')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      // Creamos el mazo en SQLite mediante Deno.
      const newDeck = await createDeck(
        normalizedName,
        description.trim()
      )

      // Lo mostramos inmediatamente en React.
      setDecks((current) => [newDeck, ...current])

      // Limpiamos los campos del formulario.
      setName('')
      setDescription('')

      setMessage('¡Mazo creado correctamente!')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  // Abre un mazo y carga las cartas de la colección.
  async function handleOpenCards(deckId) {
    if (cardsLoading || addingCard || busyCardId !== null) return //evita cambiar de mazo mientras estamos cambiando cantidades

    // Si presionamos el mismo mazo, cerramos su panel.
    if (activeDeckId === deckId) {
      setActiveDeckId(null)
      return
    }

    setActiveDeckId(deckId)
    setCardsLoading(true)
    setCardsError('')
    setCardsMessage('')
    setSelectedUserCardId('')
    setDeckCards([])

    try {
      // Obtenemos las cartas del inventario y del mazo.
      const [collection, savedDeckCards] = await Promise.all([
        getCollection(),
        getDeckCards(deckId)
      ])

      // Consultamos TCGdex para mostrar los nombres.
      const completeCollection = await Promise.all(
        collection.map(async (item) => {
          try {
            const details = await getCardById(item.cardId)

            return {
              ...item,
              displayName: details?.name || item.cardId,
              image: details?.image || null
            }
          } catch {
            return {
              ...item,
              displayName: item.cardId,
              image: null
            }
          }
        })
      )

      setCollectionCards(completeCollection)
      setDeckCards(savedDeckCards)
    } catch (error) {
      setCardsError(error.message)
    } finally {
      setCardsLoading(false)
    }
  }

  // Agrega la carta seleccionada al mazo.
  async function handleAddCard(event) {
    event.preventDefault()

    if (addingCard || activeDeckId === null) return

    const userCardId = Number(selectedUserCardId)

    if (
      !Number.isSafeInteger(userCardId) ||
      userCardId < 1 ||
      !collectionCards.some((card) => card.id === userCardId)
    ) {
      setCardsError('Selecciona una carta válida.')
      return
    }

    setAddingCard(true)
    setCardsError('')
    setCardsMessage('')

    try {
      // Pedimos a Deno asociar la carta con el mazo.
      await addCardToDeck(activeDeckId, userCardId)

      // Consultamos el mazo actualizado.
      const updatedCards = await getDeckCards(activeDeckId)

      setDeckCards(updatedCards)
      setSelectedUserCardId('')
      setCardsMessage('¡Carta agregada correctamente!')
    } catch (error) {
      setCardsError(error.message)
    } finally {
      setAddingCard(false)
    }
  }

  // Aumenta o disminuye la cantidad dentro del mazo.
  async function handleChangeDeckQuantity(item, change) {
    if (busyCardId !== null || activeDeckId === null) return

    // Calculamos la nueva cantidad.
    const newQuantity = item.quantity + change

    // No permitimos menos de 1 ni más de lo que poseemos.
    if (
      newQuantity < 1 ||
      newQuantity > item.ownedQuantity
    ) {
      return
    }

    setBusyCardId(item.userCardId)
    setCardsError('')
    setCardsMessage('')

    try {
      // Guardamos la nueva cantidad en SQLite.
      const updated = await updateDeckCardQuantity(
        activeDeckId,
        item.userCardId,
        newQuantity
      )

      // Actualizamos solamente la carta modificada en React.
      setDeckCards((current) =>
        current.map((card) =>
          card.userCardId === item.userCardId
            ? { ...card, quantity: updated.quantity }
            : card
        )
      )
    } catch (error) {
      setCardsError(error.message)
    } finally {
      setBusyCardId(null)
    }
  }

  // Quita completamente una carta del mazo.
  async function handleRemoveDeckCard(item) {
    if (busyCardId !== null || activeDeckId === null) return

    const confirmed = window.confirm(
      '¿Quieres quitar esta carta del mazo?'
    )

    if (!confirmed) return

    setBusyCardId(item.userCardId)
    setCardsError('')
    setCardsMessage('')

    try {
      // Eliminamos la relación en SQLite.
      await removeCardFromDeck(
        activeDeckId,
        item.userCardId
      )

      // Quitamos la carta de la lista visual.
      setDeckCards((current) =>
        current.filter(
          (card) => card.userCardId !== item.userCardId
        )
      )

      setCardsMessage('Carta quitada del mazo.')
    } catch (error) {
      setCardsError(error.message)
    } finally {
      setBusyCardId(null)
    }
  }

// Abre el formulario con los datos actuales del mazo.
function handleStartEdit(deck) {
  setEditingDeckId(deck.id)
  setEditName(deck.name)
  setEditDescription(deck.description || '')
  setDeckActionError('')
  setMessage('')
}

// Guarda el nombre y descripción modificados.
async function handleSaveDeck(event, deckId) {
  event.preventDefault()

  if (busyDeckId !== null) return

  const normalizedName = editName.trim()

  if (!normalizedName) {
    setDeckActionError('Debes ingresar un nombre.')
    return
  }

  setBusyDeckId(deckId)
  setDeckActionError('')
  setMessage('')

  try {
    const updated = await updateDeck(
      deckId,
      normalizedName,
      editDescription.trim()
    )

    // Reemplazamos el mazo anterior por el actualizado.
    setDecks((current) =>
      current.map((deck) =>
        deck.id === deckId ? updated : deck
      )
    )

    setEditingDeckId(null)
    setMessage('¡Mazo actualizado correctamente!')
  } catch (error) {
    setDeckActionError(error.message)
  } finally {
    setBusyDeckId(null)
  }
}

// Elimina un mazo completo.
async function handleDeleteDeck(deck) {
  if (busyDeckId !== null) return

  const confirmed = window.confirm(
    `¿Quieres eliminar el mazo "${deck.name}"?`
  )

  if (!confirmed) return

  setBusyDeckId(deck.id)
  setDeckActionError('')
  setMessage('')

  try {
    await deleteDeck(deck.id)

    // Quitamos el mazo de nuestra lista.
    setDecks((current) =>
      current.filter((item) => item.id !== deck.id)
    )

    // Cerramos el panel si estaba mostrando este mazo.
    if (activeDeckId === deck.id) {
      setActiveDeckId(null)
      setDeckCards([])
      setCollectionCards([])
    }

    if (editingDeckId === deck.id) {
      setEditingDeckId(null)
    }

    setMessage('Mazo eliminado correctamente.')
  } catch (error) {
    setDeckActionError(error.message)
  } finally {
    setBusyDeckId(null)
  }
}

  // Mostramos solo las cartas que todavía no están en el mazo.
  const availableCards = collectionCards.filter(
    (card) =>
      !deckCards.some(
        (savedCard) => savedCard.userCardId === card.id
      )
  )

  return (
    <section className="decks-page">
      <h2>Mis mazos</h2>

      <p>
        Crea mazos personalizados para organizar
        las cartas de tu colección.
      </p>

      {loading && (
        <p role="status">Cargando mazos...</p>
      )}

      {loadError && (
        <p role="alert">{loadError}</p>
      )}

      {!loading && !loadError && (
        <>
          <form
            className="deck-form"
            onSubmit={handleCreateDeck}
          >
            <h3>Crear nuevo mazo</h3>

            <label htmlFor="deck-name">
              Nombre del mazo
            </label>

            <input
              id="deck-name"
              type="text"
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder="Ej.: Mazo Fuego"
              maxLength={80}
              required
            />

            <label htmlFor="deck-description">
              Descripción (opcional)
            </label>

            <textarea
              id="deck-description"
              value={description}
              onChange={(event) =>
                setDescription(event.target.value)
              }
              placeholder="Describe tu mazo..."
              maxLength={250}
              rows={3}
            />

            <button type="submit" disabled={saving}>
              {saving ? 'Guardando...' : 'Crear mazo'}
            </button>
          </form>

          {message && (
            <p role="status">{message}</p>
          )}

          {deckActionError && (
            <p role="alert">{deckActionError}</p>
          )}

          <h3>Mazos guardados</h3>

          {decks.length === 0 ? (
            <p>Todavía no tienes mazos creados.</p>
          ) : (
            <div className="deck-list">
              {decks.map((deck) => (
                <article
                  key={deck.id}
                  className="deck-item"
                >
                  <h4>{deck.name}</h4>

                  <p>
                    {deck.description || 'Sin descripción'}
                  </p>
                  {editingDeckId === deck.id ? (
                    <form
                      className="deck-edit-form"
                      onSubmit={(event) => handleSaveDeck(event, deck.id)}
                    >
                      <label htmlFor={`edit-name-${deck.id}`}>
                        Nombre del mazo
                      </label>

                      <input
                        id={`edit-name-${deck.id}`}
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        maxLength={80}
                        required
                      />

                      <label htmlFor={`edit-description-${deck.id}`}>
                        Descripción
                      </label>

                      <textarea
                        id={`edit-description-${deck.id}`}
                        value={editDescription}
                        onChange={(event) =>
                          setEditDescription(event.target.value)
                        }
                        maxLength={250}
                        rows={2}
                      />

                      <div className="deck-edit-actions">
                        <button type="submit" disabled={busyDeckId !== null}>
                          {busyDeckId === deck.id
                            ? 'Guardando...'
                            : 'Guardar cambios'}
                        </button>

                        <button
                          type="button"
                          disabled={busyDeckId !== null}
                          onClick={() => setEditingDeckId(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="deck-action-buttons">
                      <button
                        type="button"
                        disabled={
                          busyDeckId !== null ||
                          cardsLoading ||
                          addingCard ||
                          busyCardId !== null
                        }
                        onClick={() => handleStartEdit(deck)}
                      >
                        Editar mazo
                      </button>

                      <button
                        type="button"
                        className="delete-deck-button"
                        disabled={
                          busyDeckId !== null ||
                          cardsLoading ||
                          addingCard ||
                          busyCardId !== null
                        }
                        onClick={() => handleDeleteDeck(deck)}
                      >
                        {busyDeckId === deck.id
                          ? 'Eliminando...'
                          : 'Eliminar mazo'}
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={cardsLoading || addingCard}
                    onClick={() => handleOpenCards(deck.id)}
                  >
                    {activeDeckId === deck.id
                      ? 'Cerrar cartas'
                      : 'Gestionar cartas'}
                  </button>
                  {activeDeckId === deck.id && (
                    <div className="deck-cards-panel">

                      {cardsLoading && (
                        <p role="status">Cargando cartas...</p>
                      )}

                      {cardsError && (
                        <p role="alert">{cardsError}</p>
                      )}

                      {cardsMessage && (
                        <p role="status">{cardsMessage}</p>
                      )}

                      {!cardsLoading && (
                        <>
                          <h5>Agregar carta al mazo</h5>

                          {collectionCards.length === 0 ? (
                            <p>Primero agrega cartas a tu colección.</p>
                          ) : availableCards.length === 0 ? (
                            <p>Todas tus cartas ya están en este mazo.</p>
                          ) : (
                            <form onSubmit={handleAddCard}>
                              <label htmlFor={`deck-card-${deck.id}`}>
                                Selecciona una carta
                              </label>

                              <select
                                id={`deck-card-${deck.id}`}
                                value={selectedUserCardId}
                                onChange={(event) =>
                                  setSelectedUserCardId(event.target.value)
                                }
                                required
                              >
                                <option value="">Selecciona una carta...</option>

                                {availableCards.map((card) => (
                                  <option key={card.id} value={card.id}>
                                    {card.displayName} — {card.quantity} unidades
                                  </option>
                                ))}
                              </select>

                              <button
                                type="submit"
                                disabled={addingCard || !selectedUserCardId}
                              >
                                {addingCard ? 'Agregando...' : 'Agregar al mazo'}
                              </button>
                            </form>
                          )}

                          <h5>Cartas del mazo ({deckCards.length})</h5>

                          {deckCards.length === 0 ? (
                            <p>Este mazo todavía no tiene cartas.</p>
                          ) : (

                          <div className="deck-card-list">
                            {deckCards.map((item) => {
                              // Buscamos la información visual de esta carta.
                              const card = collectionCards.find(
                                (saved) => saved.id === item.userCardId
                              )

                              return (
                                <div className="deck-card-row" key={item.userCardId}>

                                  {/* Imagen obtenida desde TCGdex. */}
                                  {card?.image ? (
                                    <img
                                      src={`${card.image}/low.webp`}
                                      alt={`Carta de ${card.displayName}`}
                                      className="deck-card-image"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="deck-card-image-placeholder">
                                      Sin imagen
                                    </div>
                                  )}

                                  <div className="deck-card-info">
                                    <strong>
                                      {card?.displayName || item.cardId}
                                    </strong>

                                    <small>
                                      En tu colección: {item.ownedQuantity}
                                    </small>

                                    <div className="deck-card-controls">
                                      <button
                                        type="button"
                                        aria-label={`Disminuir cantidad de ${card?.displayName || item.cardId}`}
                                        disabled={
                                          busyCardId !== null ||
                                          item.quantity <= 1
                                        }
                                        onClick={() =>
                                          handleChangeDeckQuantity(item, -1)
                                        }
                                      >
                                        −
                                      </button>

                                      <span>{item.quantity}</span>

                                      <button
                                        type="button"
                                        aria-label={`Aumentar cantidad de ${card?.displayName || item.cardId}`}
                                        disabled={
                                          busyCardId !== null ||
                                          item.quantity >= item.ownedQuantity
                                        }
                                        onClick={() =>
                                          handleChangeDeckQuantity(item, 1)
                                        }
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    className="remove-deck-card-button"
                                    aria-label={`Quitar ${card?.displayName || item.cardId} del mazo`}
                                    disabled={busyCardId !== null}
                                    onClick={() => handleRemoveDeckCard(item)}
                                  >
                                    ✕
                                  </button>
                                </div>
                              )
                            })}
                          </div>

                          )}
                        </>
                      )}
                    </div>
                  )}

                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default Decks
