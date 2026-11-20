import { useEffect, useRef, useState } from 'react'
import { getDecks, createDeck, getDeckCards, addCardToDeck,
         updateDeckCardQuantity, removeCardFromDeck, updateDeck, deleteDeck} from '../services/deckService'
import { getCollection } from '../services/collectionService'
import { getCardById } from '../services/cardService'
import './Decks.css'

async function getLocalizedCollectionCards(language) {
  const collection = await getCollection()

  return Promise.all(
    collection.map(async (item) => {
      try {
        const details = await getCardById(item.cardId, language)

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
}

function Decks({ texts, language }) {
  // Guardamos Mazos
  const [decks, setDecks] = useState([])
  // Guardamos lo que escribe el usuario.
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  // Estados de la interfaz
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState(null)
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
  const [cardsError, setCardsError] = useState(null)
  const [cardsMessage, setCardsMessage] = useState(null)
  // Identifica que carta estamos modificando
  const [busyCardId, setBusyCardId] = useState(null)
  const [editingDeckId, setEditingDeckId] = useState(null) // Que mazo estamos editando
  // Lo que escrbimos al editar
  const [editName, setEditName] = useState('') 
  const [editDescription, setEditDescription] = useState('')
  const [busyDeckId, setBusyDeckId] = useState(null) // Evita editar o eliminar varias veces mientras guardamos
  const [deckActionError, setDeckActionError] = useState(null) //errores
  const loadedDeckId = useRef(null)




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

  // Actualizamos los datos visuales sin modificar el contenido del mazo.
  useEffect(() => {
    if (activeDeckId === null) {
      loadedDeckId.current = null
      return
    }

    let cancelled = false
    const shouldLoadDeckCards = loadedDeckId.current !== activeDeckId

    async function refreshLocalizedCards() {
      setCardsLoading(true)
      setCardsError(null)

      try {
        const [completeCollection, savedDeckCards] = await Promise.all([
          getLocalizedCollectionCards(language),
          shouldLoadDeckCards
            ? getDeckCards(activeDeckId)
            : Promise.resolve(null)
        ])

        if (!cancelled) {
          setCollectionCards(completeCollection)

          if (shouldLoadDeckCards) {
            setDeckCards(savedDeckCards)
          }

          loadedDeckId.current = activeDeckId
        }
      } catch (error) {
        if (!cancelled) {
          setCardsError({
            type: 'service',
            value: error.message,
            fallback: 'cardsLoadError'
          })
        }
      } finally {
        if (!cancelled) {
          setCardsLoading(false)
        }
      }
    }

    refreshLocalizedCards()

    return () => {
      cancelled = true
    }
  }, [activeDeckId, language])

  // Se ejecuta cuando enviamos el formulario.
  async function handleCreateDeck(event) {
    event.preventDefault()

    if (saving) return

    const normalizedName = name.trim()

    if (!normalizedName) {
      setMessage({ type: 'translation', key: 'nameRequired' })
      return
    }

    setSaving(true)
    setMessage(null)

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

      setMessage({ type: 'translation', key: 'created' })
    } catch (error) {
      setMessage({ type: 'service', value: error.message, fallback: 'createError' })
    } finally {
      setSaving(false)
    }
  }

  // Abre un mazo y carga las cartas de la colección.
  function handleOpenCards(deckId) {
    if (cardsLoading || addingCard || busyCardId !== null) return //evita cambiar de mazo mientras estamos cambiando cantidades

    // Si presionamos el mismo mazo, cerramos su panel.
    if (activeDeckId === deckId) {
      setActiveDeckId(null)
      return
    }

    setActiveDeckId(deckId)
    setCardsLoading(true)
    setCardsError(null)
    setCardsMessage(null)
    setSelectedUserCardId('')
    setDeckCards([])
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
      setCardsError({ type: 'translation', key: 'invalidCard' })
      return
    }

    setAddingCard(true)
    setCardsError(null)
    setCardsMessage(null)

    try {
      // Pedimos a Deno asociar la carta con el mazo.
      await addCardToDeck(activeDeckId, userCardId)

      // Consultamos el mazo actualizado.
      const updatedCards = await getDeckCards(activeDeckId)

      setDeckCards(updatedCards)
      setSelectedUserCardId('')
      setCardsMessage({ type: 'translation', key: 'cardAdded' })
    } catch (error) {
      setCardsError({ type: 'service', value: error.message, fallback: 'addCardError' })
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
    setCardsError(null)
    setCardsMessage(null)

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
      setCardsError({ type: 'service', value: error.message, fallback: 'quantityError' })
    } finally {
      setBusyCardId(null)
    }
  }

  // Quita completamente una carta del mazo.
  async function handleRemoveDeckCard(item) {
    if (busyCardId !== null || activeDeckId === null) return

    const card = collectionCards.find(
      (saved) => saved.id === item.userCardId
    )
    const cardName = card?.displayName || item.cardId
    const confirmed = window.confirm(texts.decks.confirmRemoveCard(cardName))

    if (!confirmed) return

    setBusyCardId(item.userCardId)
    setCardsError(null)
    setCardsMessage(null)

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

      setCardsMessage({ type: 'translation', key: 'cardRemoved' })
    } catch (error) {
      setCardsError({ type: 'service', value: error.message, fallback: 'removeCardError' })
    } finally {
      setBusyCardId(null)
    }
  }

// Abre el formulario con los datos actuales del mazo.
function handleStartEdit(deck) {
  setEditingDeckId(deck.id)
  setEditName(deck.name)
  setEditDescription(deck.description || '')
  setDeckActionError(null)
  setMessage(null)
}

// Guarda el nombre y descripción modificados.
async function handleSaveDeck(event, deckId) {
  event.preventDefault()

  if (busyDeckId !== null) return

  const normalizedName = editName.trim()

  if (!normalizedName) {
    setDeckActionError({ type: 'translation', key: 'editNameRequired' })
    return
  }

  setBusyDeckId(deckId)
  setDeckActionError(null)
  setMessage(null)

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
    setMessage({ type: 'translation', key: 'updated' })
  } catch (error) {
    setDeckActionError({ type: 'service', value: error.message, fallback: 'updateError' })
  } finally {
    setBusyDeckId(null)
  }
}

// Elimina un mazo completo.
async function handleDeleteDeck(deck) {
  if (busyDeckId !== null) return

  const confirmed = window.confirm(texts.decks.confirmDelete(deck.name))

  if (!confirmed) return

  setBusyDeckId(deck.id)
  setDeckActionError(null)
  setMessage(null)

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

    setMessage({ type: 'translation', key: 'deleted' })
  } catch (error) {
    setDeckActionError({ type: 'service', value: error.message, fallback: 'deleteError' })
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

  function translateFeedback(feedback) {
    if (!feedback) return ''

    return feedback.type === 'service'
      ? texts.decks.serviceError(
          feedback.value,
          texts.decks[feedback.fallback]
        )
      : texts.decks[feedback.key]
  }

  return (
    <section className="decks-page">
      <h2>{texts.decks.title}</h2>
      <p>{texts.decks.description}</p>

      {loading && (
        <p role="status">{texts.decks.loading}</p>
      )}

      {loadError && (
        <p role="alert">
          {texts.decks.serviceError(loadError, texts.decks.loadError)}
        </p>
      )}

      {!loading && !loadError && (
        <>
          <form
            className="deck-form"
            onSubmit={handleCreateDeck}
          >
            <h3>{texts.decks.createTitle}</h3>

            <label htmlFor="deck-name">
              {texts.decks.nameLabel}
            </label>

            <input
              id="deck-name"
              type="text"
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder={texts.decks.namePlaceholder}
              maxLength={80}
              required
            />

            <label htmlFor="deck-description">
              {texts.decks.optionalDescriptionLabel}
            </label>

            <textarea
              id="deck-description"
              value={description}
              onChange={(event) =>
                setDescription(event.target.value)
              }
              placeholder={texts.decks.descriptionPlaceholder}
              maxLength={250}
              rows={3}
            />

            <button type="submit" disabled={saving}>
              {saving ? texts.decks.saving : texts.decks.create}
            </button>
          </form>

          {message && (
            <p role="status">{translateFeedback(message)}</p>
          )}

          {deckActionError && (
            <p role="alert">{translateFeedback(deckActionError)}</p>
          )}

          <h3>{texts.decks.savedTitle}</h3>

          {decks.length === 0 ? (
            <p>{texts.decks.empty}</p>
          ) : (
            <div className="deck-list">
              {decks.map((deck) => (
                <article
                  key={deck.id}
                  className="deck-item"
                >
                  <h4>{deck.name}</h4>

                  <p>
                    {deck.description || texts.decks.noDescription}
                  </p>
                  {editingDeckId === deck.id ? (
                    <form
                      className="deck-edit-form"
                      onSubmit={(event) => handleSaveDeck(event, deck.id)}
                    >
                      <label htmlFor={`edit-name-${deck.id}`}>
                        {texts.decks.nameLabel}
                      </label>

                      <input
                        id={`edit-name-${deck.id}`}
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        maxLength={80}
                        required
                      />

                      <label htmlFor={`edit-description-${deck.id}`}>
                        {texts.decks.descriptionLabel}
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
                            ? texts.decks.saving
                            : texts.decks.saveChanges}
                        </button>

                        <button
                          type="button"
                          disabled={busyDeckId !== null}
                          onClick={() => setEditingDeckId(null)}
                        >
                          {texts.decks.cancel}
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
                        {texts.decks.edit}
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
                          ? texts.decks.deleting
                          : texts.decks.delete}
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={cardsLoading || addingCard}
                    onClick={() => handleOpenCards(deck.id)}
                  >
                    {activeDeckId === deck.id
                      ? texts.decks.closeCards
                      : texts.decks.manageCards}
                  </button>
                  {activeDeckId === deck.id && (
                    <div className="deck-cards-panel">

                      {cardsLoading && (
                        <p role="status">{texts.decks.cardsLoading}</p>
                      )}

                      {cardsError && (
                        <p role="alert">{translateFeedback(cardsError)}</p>
                      )}

                      {cardsMessage && (
                        <p role="status">{translateFeedback(cardsMessage)}</p>
                      )}

                      {!cardsLoading && (
                        <>
                          <h5>{texts.decks.addCardTitle}</h5>

                          {collectionCards.length === 0 ? (
                            <p>{texts.decks.collectionEmpty}</p>
                          ) : availableCards.length === 0 ? (
                            <p>{texts.decks.allCardsAdded}</p>
                          ) : (
                            <form onSubmit={handleAddCard}>
                              <label htmlFor={`deck-card-${deck.id}`}>
                                {texts.decks.selectCardLabel}
                              </label>

                              <select
                                id={`deck-card-${deck.id}`}
                                value={selectedUserCardId}
                                onChange={(event) =>
                                  setSelectedUserCardId(event.target.value)
                                }
                                required
                              >
                                <option value="">{texts.decks.selectCardPlaceholder}</option>

                                {availableCards.map((card) => (
                                  <option key={card.id} value={card.id}>
                                    {texts.decks.cardOption(card.displayName, card.quantity)}
                                  </option>
                                ))}
                              </select>

                              <button
                                type="submit"
                                disabled={addingCard || !selectedUserCardId}
                              >
                                {addingCard ? texts.decks.adding : texts.decks.addCard}
                              </button>
                            </form>
                          )}

                          <h5>{texts.decks.deckCardsTitle(deckCards.length)}</h5>

                          {deckCards.length === 0 ? (
                            <p>{texts.decks.deckEmpty}</p>
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
                                      alt={texts.decks.cardImageAlt(card.displayName)}
                                      className="deck-card-image"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="deck-card-image-placeholder">
                                      {texts.decks.noImage}
                                    </div>
                                  )}

                                  <div className="deck-card-info">
                                    <strong>
                                      {card?.displayName || item.cardId}
                                    </strong>

                                    <small>
                                      {texts.decks.ownedQuantity(item.ownedQuantity)}
                                    </small>

                                    <div className="deck-card-controls">
                                      <button
                                        type="button"
                                        aria-label={texts.decks.decreaseQuantity(card?.displayName || item.cardId)}
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
                                        aria-label={texts.decks.increaseQuantity(card?.displayName || item.cardId)}
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
                                    aria-label={texts.decks.removeCard(card?.displayName || item.cardId)}
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
