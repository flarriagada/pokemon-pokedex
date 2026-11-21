import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getCollection, addCardToCollection, updateCollectionQuantity, updateCardTradeStatus, deleteCollectionCard } from '../services/collectionService'
import { getCardById, getSets, getSetById } from '../services/cardService'
import PokemonCard from '../components/PokemonCard'
import '../components/Catalog.css'

function Collection({ texts, language }) {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [busyTradeId, setBusyTradeId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [showTradeOnly, setShowTradeOnly] = useState(false)
  const [sets, setSets] = useState([])
  const [setsLoading, setSetsLoading] = useState(true)
  const [setsError, setSetsError] = useState(false)
  const [selectedSetId, setSelectedSetId] = useState('')
  const [setDetails, setSetDetails] = useState(null)
  const [setDetailsLoading, setSetDetailsLoading] = useState(false)
  const [setDetailsError, setSetDetailsError] = useState('')
  const [setFilter, setSetFilter] = useState('all')
  const [addingMissingCardId, setAddingMissingCardId] = useState(null)
  const [setFeedback, setSetFeedback] = useState(null)


  useEffect(() => {
    let cancelled = false

    async function loadCollection() {
      setLoading(true)
      setError('')

      try {
        const result = await getCollection()

        if (!cancelled) {
          setCards(result)
        }

        const savedCards = await getCollection()

        const completeCards = await Promise.all(
          savedCards.map(async (item) => {
            try {
              const details = await getCardById(item.cardId, language)

              return {
                ...item,
                details
              }
            } catch {
              return {
                ...item,
                details: null
              }
            }
          })
        )

        if (!cancelled) {
          setCards(completeCards)
        }

      } catch (error) {
        if (!cancelled) {
          setCards([])
          setError(error.message)
        }
      } 
      
      finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadCollection()

    return () => {
      cancelled = true
    }
  }, [language])

  useEffect(() => {
    let cancelled = false

    async function loadSets() {
      setSetsLoading(true)
      setSetsError(false)
      setSetFeedback(null)

      try {
        const result = await getSets(language)
        const availableSets = Array.isArray(result) ? result : []

        if (!cancelled) {
          setSets(availableSets)
          setSelectedSetId((current) =>
            availableSets.some((set) => set.id === current)
              ? current
              : ''
          )
        }
      } catch {
        if (!cancelled) {
          setSets([])
          setSelectedSetId('')
          setSetsError(true)
        }
      } finally {
        if (!cancelled) {
          setSetsLoading(false)
        }
      }
    }

    loadSets()

    return () => {
      cancelled = true
    }
  }, [language])

  useEffect(() => {
    if (!selectedSetId) {
      return
    }

    let cancelled = false

    async function loadSetDetails() {
      setSetDetails(null)
      setSetDetailsLoading(true)
      setSetDetailsError('')
      setSetFeedback(null)

      try {
        const result = await getSetById(selectedSetId, language)

        if (!cancelled) {
          if (result) {
            setSetDetails(result)
          } else {
            setSetDetailsError('notFound')
          }
        }
      } catch {
        if (!cancelled) {
          setSetDetailsError('loadError')
        }
      } finally {
        if (!cancelled) {
          setSetDetailsLoading(false)
        }
      }
    }

    loadSetDetails()

    return () => {
      cancelled = true
    }
  }, [selectedSetId, language])

async function handleQuantityChange(item, newQuantity) {
  if (busyId !== null || busyTradeId !== null || newQuantity < 1) return

  setBusyId(item.id)
  setActionError('')

  try {
    const updated = await updateCollectionQuantity(
      item.id,
      newQuantity
    )

    setCards((current) =>
      current.map((card) =>
        card.id === item.id
          ? { ...card, quantity: updated.quantity }
          : card
      )
    )
  } catch {
    setActionError('updateError')
  } finally {
    setBusyId(null)
  }
}


async function handleDelete(item) {
  if (busyId !== null || busyTradeId !== null) return

  const cardName = item.details?.name || texts.collection.cardFallback(item.cardId)
  const confirmed = window.confirm(texts.collection.confirmDelete(cardName))

  if (!confirmed) return

  setBusyId(item.id)
  setActionError('')

  try {
    await deleteCollectionCard(item.id)

    setCards((current) =>
      current.filter((card) => card.id !== item.id)
    )
  } catch {
    setActionError('deleteError')
  } finally {
    setBusyId(null)
  }
}

async function handleTradeChange(item, forTrade) {
  if (busyTradeId !== null || busyId !== null) return

  setBusyTradeId(item.id)
  setActionError('')

  try {
    const updated = await updateCardTradeStatus(item.id, forTrade)

    setCards((current) =>
      current.map((card) =>
        card.id === item.id
          ? { ...card, forTrade: updated.forTrade }
          : card
      )
    )
  } catch {
    setActionError('tradeUpdateError')
  } finally {
    setBusyTradeId(null)
  }
}

async function handleAddMissingCard(card) {
  if (addingMissingCardId !== null) return

  setAddingMissingCardId(card.id)
  setSetFeedback(null)

  try {
    const savedCard = await addCardToCollection(card.id, 1)

    setCards((current) => {
      const existingCard = current.find(
        (item) => item.cardId === card.id
      )

      if (existingCard) {
        return current.map((item) =>
          item.cardId === card.id
            ? { ...item, quantity: savedCard.quantity }
            : item
        )
      }

      return [
        {
          ...savedCard,
          forTrade: false,
          details: card
        },
        ...current
      ]
    })

    setSetFeedback({
      type: 'success',
      name: card.name,
      quantity: savedCard.quantity
    })
  } catch {
    setSetFeedback({ type: 'error' })
  } finally {
    setAddingMissingCardId(null)
  }
}

  const totalCards = cards.reduce(
    (total, card) => total + card.quantity,
    0
  )
  const visibleCards = showTradeOnly
    ? cards.filter((card) => card.forTrade)
    : cards
  const ownedCardIds = new Set(
    cards.map((card) => card.cardId)
  )
  const officialSetCards = Array.isArray(setDetails?.cards)
    ? setDetails.cards.filter(
        (card) => typeof card?.id === 'string'
      )
    : []
  const ownedSetCards = officialSetCards.filter(
    (card) => ownedCardIds.has(card.id)
  )
  const missingSetCards = officialSetCards.filter(
    (card) => !ownedCardIds.has(card.id)
  )
  const completionPercentage = officialSetCards.length > 0
    ? Math.round(
        (ownedSetCards.length / officialSetCards.length) * 100
      )
    : 0
  const filteredSetCards = setFilter === 'owned'
    ? ownedSetCards
    : setFilter === 'missing'
      ? missingSetCards
      : officialSetCards

  return (
    <section className="collection">
      <h2>{texts.collection.title}</h2>
      {actionError && (
        <p role="alert">{texts.collection[actionError]}</p>
      )}

      {loading && <p role="status">{texts.collection.loading}</p>}

      {error && (
        <p role="alert">
          {texts.collection.serviceError(error, texts.collection.loadError)}
        </p>
      )}

      {!loading && !error && cards.length === 0 && (
        <div className="empty-collection">
          <h3>{texts.collection.emptyTitle}</h3>
          <p>{texts.collection.emptyText}</p>
          <Link to="/catalog">{texts.collection.explore}</Link>
        </div>
      )}

      {!loading && !error && cards.length > 0 && (
        <>
          <p>{texts.collection.total(totalCards, cards.length)}</p>

          <div className="trade-filter">
            <button
              type="button"
              aria-pressed={showTradeOnly}
              onClick={() => setShowTradeOnly((current) => !current)}
            >
              {showTradeOnly
                ? texts.collection.showAll
                : texts.collection.showTradeOnly}
            </button>
          </div>

          {visibleCards.length === 0 ? (
            <p className="trade-filter-empty">{texts.collection.noTradeCards}</p>
          ) : (
          <div className="collection-grid">
            {visibleCards.map((item) => {
              const details = item.details ?? {
                id: item.cardId,
                name: texts.collection.cardFallback(item.cardId),
                localId: '—',
                image: null
              }

              return (
              <article
                key={item.id}
                className={`collection-item${item.forTrade ? ' collection-item--for-trade' : ''}`}
              >
                <PokemonCard card={details} texts={texts} />

                <div className="trade-control">
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(item.forTrade)}
                      disabled={busyTradeId !== null || busyId !== null}
                      onChange={(event) =>
                        handleTradeChange(item, event.target.checked)
                      }
                    />
                    <span>{texts.collection.tradeAvailable}</span>
                  </label>

                  <span
                    className="trade-status"
                    role="status"
                    aria-live="polite"
                  >
                    {busyTradeId === item.id
                      ? texts.collection.saving
                      : item.forTrade
                        ? texts.collection.tradeAvailable
                        : texts.collection.tradeUnavailable}
                  </span>
                </div>

                <div className="quantity-controls">
                  <button
                    type="button"
                    aria-label={texts.collection.decrease(details.name)}
                    disabled={busyId !== null || busyTradeId !== null || item.quantity <= 1}
                    onClick={() =>
                      handleQuantityChange(item, item.quantity - 1)
                    }
                  >
                    −
                  </button>

                  <span>{texts.collection.quantity(item.quantity)}</span>

                  <button
                    type="button"
                    aria-label={texts.collection.increase(details.name)}
                    disabled={busyId !== null || busyTradeId !== null}
                    onClick={() =>
                      handleQuantityChange(item, item.quantity + 1)
                    }
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  className="delete-card-button"
                  disabled={busyId !== null || busyTradeId !== null}
                  onClick={() => handleDelete(item)}
                >
                  {busyId === item.id ? texts.collection.saving : texts.collection.delete}
                </button>
              </article>
              )
            })}
          </div>
          )}
        </>
      )}

      {!loading && !error && (
        <section
          className="set-completion"
          aria-labelledby="set-completion-title"
        >
          <h3 id="set-completion-title">{texts.setCompletion.title}</h3>
          <p>{texts.setCompletion.description}</p>

          {setsLoading && (
            <p role="status">{texts.setCompletion.loadingSets}</p>
          )}

          {setsError && (
            <p role="alert">{texts.setCompletion.loadSetsError}</p>
          )}

          {!setsLoading && !setsError && (
            <div className="set-selector">
              <label htmlFor="collection-set">
                {texts.setCompletion.selectLabel}
              </label>
              <select
                id="collection-set"
                value={selectedSetId}
                onChange={(event) => {
                  setSelectedSetId(event.target.value)
                  setSetDetails(null)
                  setSetDetailsError('')
                  setSetFilter('all')
                  setSetFeedback(null)
                }}
              >
                <option value="">{texts.setCompletion.selectPlaceholder}</option>
                {sets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!setsLoading && !setsError && !selectedSetId && (
            <p>{texts.setCompletion.selectPrompt}</p>
          )}

          {selectedSetId && setDetailsLoading && (
            <p role="status">{texts.setCompletion.loadingSet}</p>
          )}

          {selectedSetId && setDetailsError && (
            <p role="alert">
              {setDetailsError === 'notFound'
                ? texts.setCompletion.setNotFound
                : texts.setCompletion.loadSetError}
            </p>
          )}

          {selectedSetId && setDetails && !setDetailsLoading && !setDetailsError && (
            <div className="set-details">
              <h4>{setDetails.name}</h4>

              {cards.length === 0 && officialSetCards.length > 0 && (
                <p>{texts.setCompletion.emptyCollection}</p>
              )}

              {officialSetCards.length === 0 ? (
                <p>{texts.setCompletion.emptySet}</p>
              ) : (
                <>
                  <div className="set-progress-summary">
                    <progress
                      value={ownedSetCards.length}
                      max={officialSetCards.length}
                      aria-label={texts.setCompletion.progressLabel(
                        setDetails.name,
                        completionPercentage
                      )}
                    />

                    <div className="set-progress-stats">
                      <span>{texts.setCompletion.totalCards(officialSetCards.length)}</span>
                      <span>{texts.setCompletion.ownedCards(ownedSetCards.length)}</span>
                      <span>{texts.setCompletion.missingCards(missingSetCards.length)}</span>
                      <strong>{texts.setCompletion.completion(completionPercentage)}</strong>
                    </div>
                  </div>

                  <div
                    className="set-filters"
                    role="group"
                    aria-label={texts.setCompletion.filterLabel}
                  >
                    <button
                      type="button"
                      className={setFilter === 'all' ? 'is-active' : ''}
                      aria-pressed={setFilter === 'all'}
                      onClick={() => setSetFilter('all')}
                    >
                      {texts.setCompletion.all}
                    </button>
                    <button
                      type="button"
                      className={setFilter === 'owned' ? 'is-active' : ''}
                      aria-pressed={setFilter === 'owned'}
                      onClick={() => setSetFilter('owned')}
                    >
                      {texts.setCompletion.owned}
                    </button>
                    <button
                      type="button"
                      className={setFilter === 'missing' ? 'is-active' : ''}
                      aria-pressed={setFilter === 'missing'}
                      onClick={() => setSetFilter('missing')}
                    >
                      {texts.setCompletion.missing}
                    </button>
                  </div>

                  {setFeedback && (
                    <p role={setFeedback.type === 'error' ? 'alert' : 'status'}>
                      {setFeedback.type === 'error'
                        ? texts.setCompletion.addError
                        : texts.setCompletion.added(
                            setFeedback.name,
                            setFeedback.quantity
                          )}
                    </p>
                  )}

                  {filteredSetCards.length === 0 ? (
                    <p>{texts.setCompletion.noFilterResults}</p>
                  ) : (
                    <div className="pokemon-grid set-card-grid">
                      {filteredSetCards.map((card) => {
                        const isOwned = ownedCardIds.has(card.id)
                        const displayCard = {
                          ...card,
                          name: card.name || card.id,
                          localId: card.localId || '—'
                        }

                        return (
                          <div
                            key={card.id}
                            className={`set-card-item ${isOwned ? 'set-card-item--owned' : 'set-card-item--missing'}`}
                          >
                            <p className="set-card-status">
                              {isOwned
                                ? texts.setCompletion.ownedStatus
                                : texts.setCompletion.missingStatus}
                            </p>
                            <PokemonCard
                              card={displayCard}
                              onAdd={isOwned ? undefined : handleAddMissingCard}
                              adding={addingMissingCardId === card.id}
                              texts={texts}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}
    </section>
  )
}
export default Collection
