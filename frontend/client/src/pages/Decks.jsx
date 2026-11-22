import { useEffect, useRef, useState } from 'react'
import { getDecks, createDeck, getDeckCards, syncDeckCards,
         updateDeck, deleteDeck } from '../services/deckService'
import { getCollectionPage, getCollectionSummary } from '../services/collectionService'
import {
  getAlternateCardImage,
  getCards,
  getCardById,
  getCardImageUrls
} from '../services/cardService'
import './Decks.css'

const DECK_COLLECTION_PAGE_SIZE = 24
const DECK_SEARCH_PAGE_SIZE = 12

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length) },
      () => worker()
    )
  )

  return results
}

async function getLocalizedCollectionCards(
  language,
  search = '',
  page = 1,
  requiredUserCardIds = [],
  collectionSummary = null
) {
  let candidates
  let hasMore = false

  if (search.trim()) {
    const [summary, catalogCards] = await Promise.all([
      collectionSummary ?? getCollectionSummary(),
      getCards(search.trim(), page, language)
    ])
    const collection = Array.isArray(summary.cards) ? summary.cards : []
    const ownedById = new Map(collection.map((item) => [item.cardId, item]))
    candidates = (Array.isArray(catalogCards) ? catalogCards : [])
      .map((card) => {
        const owned = ownedById.get(card.id)
        return owned ? { ...owned, catalogCard: card } : null
      })
      .filter(Boolean)
    hasMore = Array.isArray(catalogCards) &&
      catalogCards.length >= DECK_SEARCH_PAGE_SIZE
  } else {
    const result = await getCollectionPage({
      page,
      pageSize: DECK_COLLECTION_PAGE_SIZE,
      language,
      sort: 'name-asc'
    })
    candidates = Array.isArray(result.cards) ? result.cards : []
    hasMore = Number.isSafeInteger(result.totalPages) &&
      page < result.totalPages
  }

  const requiredIds = new Set(
    requiredUserCardIds.map((item) => Number(item.userCardId))
  )
  const candidateIds = new Set(candidates.map((item) => item.id))
  for (const item of requiredUserCardIds) {
    if (requiredIds.has(Number(item.userCardId)) && !candidateIds.has(item.userCardId)) {
      candidates.push({
        id: item.userCardId,
        cardId: item.cardId,
        quantity: item.ownedQuantity,
        forTrade: false
      })
      candidateIds.add(item.userCardId)
    }
  }

  const localized = await mapWithConcurrency(
    candidates,
    4,
    async (item) => {
      const knownDetails = item.details ?? item.catalogCard
      if (knownDetails) {
        return {
          ...item,
          displayName: knownDetails.name || item.cardId,
          image: knownDetails.image || null,
          details: knownDetails
        }
      }

      try {
        const details = await getCardById(item.cardId, language)

        return {
          ...item,
          displayName: details?.name || item.cardId,
          image: details?.image || null,
          details: details ?? item.catalogCard ?? null
        }
      } catch {
        return {
          ...item,
          displayName: item.catalogCard?.name || item.cardId,
          image: item.catalogCard?.image || null,
          details: item.catalogCard ?? null
        }
      }
    }
  )

  return { cards: localized, hasMore }
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
  const [collectionSearch, setCollectionSearch] = useState('')
  const [activeCollectionSearch, setActiveCollectionSearch] = useState('')
  const [collectionPage, setCollectionPage] = useState(1)
  const [collectionHasMore, setCollectionHasMore] = useState(false)
  const [deckCardImages, setDeckCardImages] = useState({})
  // Cartas que ya están asociadas al mazo
  const [deckCards, setDeckCards] = useState([])
  const [draftDeckCards, setDraftDeckCards] = useState([])
  const [deckMode, setDeckMode] = useState('view')
  const [deckSaving, setDeckSaving] = useState(false)
  // Carta seleccionada en el formulario
  const [selectedUserCardId, setSelectedUserCardId] = useState('')
  // Controlamos la carga y las acciones sobre las cartas
  const [cardsLoading, setCardsLoading] = useState(false)
  const [addingCard, setAddingCard] = useState(false)
  const [cardsError, setCardsError] = useState(null)
  const [cardsMessage, setCardsMessage] = useState(null)
  // Identifica que carta estamos modificando
  const [editingDeckId, setEditingDeckId] = useState(null) // Que mazo estamos editando
  // Lo que escrbimos al editar
  const [editName, setEditName] = useState('') 
  const [editDescription, setEditDescription] = useState('')
  const [busyDeckId, setBusyDeckId] = useState(null) // Evita editar o eliminar varias veces mientras guardamos
  const [deckActionError, setDeckActionError] = useState(null) //errores
  const loadedDeckId = useRef(null)
  const collectionSummaryRef = useRef(null)
  const requestedDeckMode = useRef('view')
  const imageLanguage = useRef(language)
  const displayedDeckCards = deckMode === 'manage'
    ? draftDeckCards
    : deckCards

  useEffect(() => {
    imageLanguage.current = language
  }, [language])


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
      collectionSummaryRef.current = null
      requestedDeckMode.current = 'view'
      return
    }

    let cancelled = false
    const shouldLoadDeckCards = loadedDeckId.current !== activeDeckId

    async function refreshLocalizedCards() {
      setCardsLoading(true)
      setCardsError(null)

      try {
        const savedDeckCards = shouldLoadDeckCards
          ? await getDeckCards(activeDeckId)
          : deckCards
        let collectionSummary = collectionSummaryRef.current
        if (activeCollectionSearch && !collectionSummary) {
          collectionSummary = await getCollectionSummary()
          if (!cancelled) collectionSummaryRef.current = collectionSummary
        }
        const collectionResult = await getLocalizedCollectionCards(
          language,
          activeCollectionSearch,
          collectionPage,
          savedDeckCards,
          collectionSummary
        )

        if (!cancelled) {
          setCollectionCards(collectionResult.cards)
          setCollectionHasMore(collectionResult.hasMore)

          if (shouldLoadDeckCards) {
            setDeckCards(savedDeckCards)
            setDraftDeckCards(savedDeckCards)
            setDeckMode(requestedDeckMode.current)
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
  }, [
    activeDeckId,
    activeCollectionSearch,
    collectionPage,
    deckCards,
    language
  ])

  useEffect(() => {
    let cancelled = false
    const visibleCards = displayedDeckCards
      .map((item) =>
        collectionCards.find((card) => card.id === item.userCardId)
      )
      .filter(Boolean)
    visibleCards
      .filter((card) => getCardImageUrls(card.image).length === 0)
      .forEach(async (card) => {
        try {
          const alternateImage = await getAlternateCardImage(
            card.cardId,
            language
          )

          if (cancelled) return

          const urls = getCardImageUrls(alternateImage)
          setDeckCardImages((current) => ({
            ...current,
            [card.cardId]: {
              language,
              urls,
              index: 0,
              source: 'alternate',
              unavailable: urls.length === 0
            }
          }))
        } catch {
          if (cancelled) return

          setDeckCardImages((current) => ({
            ...current,
            [card.cardId]: {
              language,
              urls: [],
              index: 0,
              source: 'alternate',
              unavailable: true
            }
          }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [collectionCards, deckCards, deckMode, displayedDeckCards, draftDeckCards, language])

  async function handleDeckImageError(card) {
    const fallbackState = {
      language,
      urls: getCardImageUrls(card.image),
      index: 0,
      source: 'original',
      unavailable: false
    }
    const savedState = deckCardImages[card.cardId]
    const currentState = savedState?.language === language
      ? savedState
      : fallbackState
    const nextIndex = currentState.index + 1

    if (nextIndex < currentState.urls.length) {
      setDeckCardImages((current) => ({
        ...current,
        [card.cardId]: {
          ...currentState,
          index: nextIndex
        }
      }))
      return
    }

    if (currentState.source !== 'original') {
      setDeckCardImages((current) => ({
        ...current,
        [card.cardId]: {
          ...currentState,
          unavailable: true
        }
      }))
      return
    }

    const requestLanguage = language
    setDeckCardImages((current) => ({
      ...current,
      [card.cardId]: {
        language: requestLanguage,
        urls: [],
        index: 0,
        source: 'alternate-loading',
        unavailable: false
      }
    }))

    try {
      const alternateImage = await getAlternateCardImage(
        card.cardId,
        requestLanguage
      )

      if (imageLanguage.current !== requestLanguage) return

      const urls = getCardImageUrls(alternateImage)
      setDeckCardImages((current) => ({
        ...current,
        [card.cardId]: {
          language: requestLanguage,
          urls,
          index: 0,
          source: 'alternate',
          unavailable: urls.length === 0
        }
      }))
    } catch {
      if (imageLanguage.current !== requestLanguage) return

      setDeckCardImages((current) => ({
        ...current,
        [card.cardId]: {
          language: requestLanguage,
          urls: [],
          index: 0,
          source: 'alternate',
          unavailable: true
        }
      }))
    }
  }

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
  function handleOpenCards(deckId, requestedMode = 'view') {
    if (cardsLoading || addingCard || deckSaving) return //evita cambiar de mazo mientras estamos cambiando cantidades

    // Si presionamos el mismo mazo, cerramos su panel.
    if (activeDeckId === deckId) {
      if (requestedMode === 'manage') {
        handleStartManage()
        return
      }

      if (deckMode === 'view') {
        setActiveDeckId(null)
        setDraftDeckCards([])
        setDeckMode('view')
        return
      }

      if (deckMode === 'manage' && deckDraftDirty &&
        !window.confirm(texts.decks.confirmDiscardChanges)) {
        return
      }
      setDraftDeckCards(deckCards.map((card) => ({ ...card })))
      setDeckMode('view')
      return
    }

    requestedDeckMode.current = requestedMode
    setActiveDeckId(deckId)
    collectionSummaryRef.current = null
    setCardsLoading(true)
    setCardsError(null)
    setCardsMessage(null)
    setSelectedUserCardId('')
    setDeckCards([])
    setDraftDeckCards([])
    setDeckMode(requestedMode)
    setCollectionSearch('')
    setActiveCollectionSearch('')
    setCollectionPage(1)
  }

  // Agrega la carta seleccionada al mazo.
  function handleAddCard(event) {
    event.preventDefault()

    if (addingCard || activeDeckId === null || deckMode !== 'manage') return

    const userCardId = Number(selectedUserCardId)

    const selectedCard = collectionCards.find((card) => card.id === userCardId)

    if (
      !Number.isSafeInteger(userCardId) ||
      userCardId < 1 ||
      !selectedCard
    ) {
      setCardsError({ type: 'translation', key: 'invalidCard' })
      return
    }

    setAddingCard(true)
    setCardsError(null)
    setCardsMessage(null)

    setDraftDeckCards((current) => [
      ...current,
      {
        userCardId,
        cardId: selectedCard.cardId,
        quantity: 1,
        ownedQuantity: selectedCard.quantity
      }
    ])
    setSelectedUserCardId('')
    setCardsMessage({ type: 'translation', key: 'draftCardAdded' })
    setAddingCard(false)
  }

  // Aumenta o disminuye la cantidad dentro del mazo.
  function handleChangeDeckQuantity(item, change) {
    if (deckSaving || activeDeckId === null || deckMode !== 'manage') return

    // Calculamos la nueva cantidad.
    const newQuantity = item.quantity + change

    // No permitimos menos de 1 ni más de lo que poseemos.
    if (
      newQuantity < 1 ||
      newQuantity > item.ownedQuantity
    ) {
      return
    }

    setCardsError(null)
    setCardsMessage(null)
    setDraftDeckCards((current) =>
      current.map((card) =>
        card.userCardId === item.userCardId
          ? { ...card, quantity: newQuantity }
          : card
      )
    )
  }

  // Quita completamente una carta del mazo.
  function handleRemoveDeckCard(item) {
    if (deckSaving || activeDeckId === null || deckMode !== 'manage') return

    const card = collectionCards.find(
      (saved) => saved.id === item.userCardId
    )
    const cardName = card?.displayName || item.cardId
    const confirmed = window.confirm(texts.decks.confirmRemoveCard(cardName))

    if (!confirmed) return

    setCardsError(null)
    setCardsMessage(null)
    setDraftDeckCards((current) =>
      current.filter((card) => card.userCardId !== item.userCardId)
    )
    setCardsMessage({ type: 'translation', key: 'draftCardRemoved' })
  }

  function handleStartManage() {
    if (cardsLoading || deckSaving || deckMode === 'manage') return
    setDraftDeckCards(deckCards.map((card) => ({ ...card })))
    setDeckMode('manage')
    setCardsError(null)
    setCardsMessage(null)
  }

  function handleCancelDeckChanges() {
    if (deckDraftDirty && !window.confirm(texts.decks.confirmDiscardChanges)) {
      return
    }

    setDraftDeckCards(deckCards.map((card) => ({ ...card })))
    setDeckMode('view')
    setCardsError(null)
    setCardsMessage({ type: 'translation', key: 'changesDiscarded' })
  }

  async function handleSaveDeckCards() {
    if (activeDeckId === null || deckSaving || !deckDraftDirty) return

    setDeckSaving(true)
    setCardsError(null)
    setCardsMessage(null)

    try {
      const savedCards = await syncDeckCards(
        activeDeckId,
        draftDeckCards.map(({ userCardId, quantity }) => ({
          userCardId,
          quantity
        }))
      )

      setDeckCards(savedCards)
      setDraftDeckCards(savedCards.map((card) => ({ ...card })))
      setDeckMode('view')
      setCardsMessage({ type: 'translation', key: 'deckCardsUpdated' })
    } catch (error) {
      setCardsError({
        type: 'service',
        value: error.message,
        fallback: 'deckCardsUpdateError'
      })
    } finally {
      setDeckSaving(false)
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
      setDraftDeckCards([])
      setCollectionCards([])
      setDeckMode('view')
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
  function handleCollectionSearch(event) {
    event.preventDefault()
    setCollectionPage(1)
    setActiveCollectionSearch(collectionSearch.trim())
  }

  const deckDraftDirty = draftDeckCards.length !== deckCards.length ||
    draftDeckCards.some((draftCard) => {
      const savedCard = deckCards.find(
        (card) => card.userCardId === draftCard.userCardId
      )
      return !savedCard || savedCard.quantity !== draftCard.quantity
    })
  const availableCards = collectionCards.filter(
    (card) =>
      !displayedDeckCards.some(
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
                          deckSaving ||
                          addingCard ||
                          deckSaving
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
                          deckSaving ||
                          addingCard ||
                          deckSaving
                        }
                        onClick={() => handleDeleteDeck(deck)}
                      >
                        {busyDeckId === deck.id
                          ? texts.decks.deleting
                          : texts.decks.delete}
                      </button>
                    </div>
                  )}

                  <div className="deck-card-actions">
                    <button
                      type="button"
                      disabled={cardsLoading || addingCard || deckSaving}
                      onClick={() => handleOpenCards(deck.id, 'view')}
                    >
                      {activeDeckId === deck.id && deckMode === 'view'
                        ? texts.decks.closeCards
                        : texts.decks.viewCards}
                    </button>
                    <button
                      type="button"
                      disabled={cardsLoading || addingCard || deckSaving}
                      onClick={() => handleOpenCards(deck.id, 'manage')}
                    >
                      {texts.decks.manageCards}
                    </button>
                  </div>
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
                          {deckMode === 'manage' && (
                            <>
                          <h5>{texts.decks.addCardTitle}</h5>

                          <form
                            className="deck-card-search"
                            onSubmit={handleCollectionSearch}
                          >
                            <label htmlFor={`deck-card-search-${deck.id}`}>
                              {texts.decks.searchCollection}
                            </label>
                            <input
                              id={`deck-card-search-${deck.id}`}
                              type="search"
                              value={collectionSearch}
                              onChange={(event) => setCollectionSearch(event.target.value)}
                              placeholder={texts.decks.searchCollectionPlaceholder}
                            />
                            <button type="submit" disabled={cardsLoading}>
                              {texts.decks.searchCollectionButton}
                            </button>
                            {activeCollectionSearch && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCollectionSearch('')
                                  setActiveCollectionSearch('')
                                  setCollectionPage(1)
                                }}
                              >
                                {texts.decks.clearCollectionSearch}
                              </button>
                            )}
                          </form>

                          {collectionCards.length === 0 ? (
                            <p>
                              {activeCollectionSearch
                                ? texts.decks.noSearchResults
                                : texts.decks.collectionEmpty}
                            </p>
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

                          {(collectionPage > 1 || collectionHasMore) && (
                            <nav
                              className="transaction-pagination"
                              aria-label={texts.decks.searchCollection}
                            >
                              <button
                                type="button"
                                disabled={cardsLoading || collectionPage <= 1}
                                onClick={() => setCollectionPage((current) =>
                                  Math.max(1, current - 1)
                                )}
                              >
                                {texts.decks.previous}
                              </button>
                              <span>{texts.decks.pageOf(collectionPage)}</span>
                              <button
                                type="button"
                                disabled={cardsLoading || !collectionHasMore}
                                onClick={() => setCollectionPage((current) => current + 1)}
                              >
                                {texts.decks.next}
                              </button>
                            </nav>
                          )}
                            </>
                          )}

                          <h5>{texts.decks.deckCardsTitle(displayedDeckCards.length)}</h5>

                          {displayedDeckCards.length === 0 ? (
                            <p>{texts.decks.deckEmpty}</p>
                          ) : (

                          <div className={deckMode === 'view'
                            ? 'deck-card-gallery'
                            : 'deck-card-list'}>
                            {displayedDeckCards.map((item) => {
                              // Buscamos la información visual de esta carta.
                              const card = collectionCards.find(
                                (saved) => saved.id === item.userCardId
                              )
                              const imageState = card
                                ? deckCardImages[card.cardId]?.language === language
                                  ? deckCardImages[card.cardId]
                                  : null
                                : null
                              const imageUrl = imageState
                                ? imageState.urls[imageState.index] ?? null
                                : getCardImageUrls(card?.image)[0] ?? null
                              const displayName = card?.displayName || item.cardId

                              return (
                                <div
                                  className={deckMode === 'view'
                                    ? 'deck-gallery-card'
                                    : 'deck-card-row'}
                                  key={item.userCardId}
                                >

                                  {/* Imagen obtenida desde TCGdex. */}
                                  {imageUrl && !imageState?.unavailable ? (
                                    <img
                                      src={imageUrl}
                                      alt={texts.decks.cardImageAlt(displayName)}
                                      className="deck-card-image"
                                      loading="lazy"
                                      onError={() => card && handleDeckImageError(card)}
                                    />
                                  ) : (
                                    <div className="deck-card-image-placeholder">
                                      {texts.decks.noImage}
                                    </div>
                                  )}

                                  <div className="deck-card-info">
                                    <strong>
                                      {displayName}
                                    </strong>

                                    <small>
                                      {deckMode === 'view'
                                        ? texts.decks.deckQuantity(item.quantity)
                                        : texts.decks.ownedQuantity(item.ownedQuantity)}
                                    </small>

                                    {deckMode === 'manage' && (
                                    <div className="deck-card-controls">
                                      <button
                                        type="button"
                                        aria-label={texts.decks.decreaseQuantity(displayName)}
                                        disabled={
                                          deckSaving ||
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
                                        aria-label={texts.decks.increaseQuantity(displayName)}
                                        disabled={
                                          deckSaving ||
                                          item.quantity >= item.ownedQuantity
                                        }
                                        onClick={() =>
                                          handleChangeDeckQuantity(item, 1)
                                        }
                                      >
                                        +
                                      </button>
                                    </div>
                                    )}
                                  </div>

                                  {deckMode === 'manage' && (
                                  <button
                                    type="button"
                                    className="remove-deck-card-button"
                                    aria-label={texts.decks.removeCard(displayName)}
                                    disabled={deckSaving}
                                    onClick={() => handleRemoveDeckCard(item)}
                                  >
                                    ✕
                                  </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>

                          )}

                          {deckMode === 'manage' && (
                            <div className="deck-draft-actions">
                              <button
                                type="button"
                                onClick={handleSaveDeckCards}
                                disabled={deckSaving || !deckDraftDirty}
                              >
                                {deckSaving
                                  ? texts.decks.saving
                                  : texts.decks.updateDeckCards}
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelDeckChanges}
                                disabled={deckSaving}
                              >
                                {texts.decks.cancel}
                              </button>
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
