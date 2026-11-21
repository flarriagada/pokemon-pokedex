import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getCollection, addCardToCollection, updateCollectionQuantity, updateCardTradeStatus, deleteCollectionCard, getTransactions, createTransaction } from '../services/collectionService'
import { getCardById, getSets, getSetById } from '../services/cardService'
import PokemonCard from '../components/PokemonCard'
import '../components/Catalog.css'

function getLocalDateValue() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function isValidDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const date = new Date(`${value}T00:00:00.000Z`)

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
}

function formatClp(value, language, currency) {
  const locale = language === 'en' ? 'en-US' : 'es-CL'
  const formattedValue = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0
  }).format(value)

  return `${formattedValue} ${currency}`
}

function formatTransactionDate(value, language) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const locale = language === 'en' ? 'en-US' : 'es-CL'

  return date.toLocaleDateString(locale)
}

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
  const [transactions, setTransactions] = useState([])
  const [transactionsLoading, setTransactionsLoading] = useState(true)
  const [transactionsError, setTransactionsError] = useState(false)
  const [transactionCardDetails, setTransactionCardDetails] = useState({})
  const [transactionCardId, setTransactionCardId] = useState('')
  const [transactionType, setTransactionType] = useState('purchase')
  const [transactionQuantity, setTransactionQuantity] = useState('1')
  const [transactionUnitPrice, setTransactionUnitPrice] = useState('0')
  const [transactionDate, setTransactionDate] = useState(getLocalDateValue)
  const [transactionNotes, setTransactionNotes] = useState('')
  const [transactionSaving, setTransactionSaving] = useState(false)
  const [transactionMessage, setTransactionMessage] = useState('')
  const [transactionFilter, setTransactionFilter] = useState('all')


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

  useEffect(() => {
    let cancelled = false

    async function loadTransactions() {
      try {
        const result = await getTransactions()

        if (!cancelled) {
          setTransactions(Array.isArray(result) ? result : [])
        }
      } catch {
        if (!cancelled) {
          setTransactions([])
          setTransactionsError(true)
        }
      } finally {
        if (!cancelled) {
          setTransactionsLoading(false)
        }
      }
    }

    loadTransactions()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (transactions.length === 0) return

    let cancelled = false

    async function loadTransactionCardDetails() {
      const cardIds = [
        ...new Set(transactions.map((transaction) => transaction.cardId))
      ]
      const entries = await Promise.all(
        cardIds.map(async (cardId) => {
          try {
            const details = await getCardById(cardId, language)
            return [cardId, details]
          } catch {
            return [cardId, null]
          }
        })
      )

      if (!cancelled) {
        setTransactionCardDetails(Object.fromEntries(entries))
      }
    }

    loadTransactionCardDetails()

    return () => {
      cancelled = true
    }
  }, [transactions, language])

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

async function handleTransactionSubmit(event) {
  event.preventDefault()

  if (transactionSaving) return

  const quantity = Number(transactionQuantity)
  const unitPrice = Number(transactionUnitPrice)
  const normalizedNotes = transactionNotes.trim()

  if (!cards.some((card) => card.cardId === transactionCardId)) {
    setTransactionMessage('cardRequired')
    return
  }

  if (transactionType !== 'purchase' && transactionType !== 'sale') {
    setTransactionMessage('typeInvalid')
    return
  }

  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    setTransactionMessage('quantityInvalid')
    return
  }

  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
    setTransactionMessage('unitPriceInvalid')
    return
  }

  if (!Number.isSafeInteger(quantity * unitPrice)) {
    setTransactionMessage('totalInvalid')
    return
  }

  if (!isValidDateValue(transactionDate)) {
    setTransactionMessage('dateInvalid')
    return
  }

  if (normalizedNotes.length > 250) {
    setTransactionMessage('notesTooLong')
    return
  }

  setTransactionSaving(true)
  setTransactionMessage('')

  try {
    const created = await createTransaction({
      cardId: transactionCardId,
      transactionType,
      quantity,
      unitPrice,
      transactionDate,
      notes: normalizedNotes || null
    })

    setTransactions((current) =>
      [...current, created].sort((first, second) =>
        second.transactionDate.localeCompare(first.transactionDate) ||
        second.id - first.id
      )
    )
    setTransactionCardId('')
    setTransactionType('purchase')
    setTransactionQuantity('1')
    setTransactionUnitPrice('0')
    setTransactionDate(getLocalDateValue())
    setTransactionNotes('')
    setTransactionMessage('success')
  } catch {
    setTransactionMessage('saveError')
  } finally {
    setTransactionSaving(false)
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
  const previewQuantity = Number(transactionQuantity)
  const previewUnitPrice = Number(transactionUnitPrice)
  const transactionPreviewTotal =
    Number.isSafeInteger(previewQuantity) &&
    Number.isSafeInteger(previewUnitPrice) &&
    previewQuantity > 0 &&
    previewUnitPrice >= 0 &&
    Number.isSafeInteger(previewQuantity * previewUnitPrice)
      ? previewQuantity * previewUnitPrice
      : 0
  const filteredTransactions = transactionFilter === 'purchase'
    ? transactions.filter(
        (transaction) => transaction.transactionType === 'purchase'
      )
    : transactionFilter === 'sale'
      ? transactions.filter(
          (transaction) => transaction.transactionType === 'sale'
        )
      : transactions

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

      {!loading && !error && (
        <details className="transaction-history">
          <summary>{texts.transactions.title}</summary>

          <div className="transaction-history-content">
            <p>{texts.transactions.description}</p>
            <p
              id="transaction-inventory-notice"
              className="transaction-inventory-notice"
            >
              {texts.transactions.inventoryNotice}
            </p>

            <form
              className="transaction-form"
              onSubmit={handleTransactionSubmit}
              aria-describedby="transaction-inventory-notice"
            >
              <h4>{texts.transactions.formTitle}</h4>

              {cards.length === 0 && (
                <p>{texts.transactions.noCardsForForm}</p>
              )}

              <label htmlFor="transaction-card">
                {texts.transactions.cardLabel}
              </label>
              <select
                id="transaction-card"
                value={transactionCardId}
                onChange={(event) => setTransactionCardId(event.target.value)}
                disabled={cards.length === 0 || transactionSaving}
                required
              >
                <option value="">{texts.transactions.cardPlaceholder}</option>
                {cards.map((card) => (
                  <option key={card.id} value={card.cardId}>
                    {card.details?.name || texts.collection.cardFallback(card.cardId)}
                  </option>
                ))}
              </select>

              <label htmlFor="transaction-type">
                {texts.transactions.typeLabel}
              </label>
              <select
                id="transaction-type"
                value={transactionType}
                onChange={(event) => setTransactionType(event.target.value)}
                disabled={transactionSaving}
              >
                <option value="purchase">{texts.transactions.purchase}</option>
                <option value="sale">{texts.transactions.sale}</option>
              </select>

              <label htmlFor="transaction-quantity">
                {texts.transactions.quantityLabel}
              </label>
              <input
                id="transaction-quantity"
                type="number"
                min="1"
                step="1"
                value={transactionQuantity}
                onChange={(event) => setTransactionQuantity(event.target.value)}
                disabled={transactionSaving}
                required
              />

              <label htmlFor="transaction-unit-price">
                {texts.transactions.unitPriceLabel}
              </label>
              <input
                id="transaction-unit-price"
                type="number"
                min="0"
                step="1"
                value={transactionUnitPrice}
                onChange={(event) => setTransactionUnitPrice(event.target.value)}
                disabled={transactionSaving}
                required
              />

              <label htmlFor="transaction-date">
                {texts.transactions.dateLabel}
              </label>
              <input
                id="transaction-date"
                type="date"
                value={transactionDate}
                onChange={(event) => setTransactionDate(event.target.value)}
                disabled={transactionSaving}
                required
              />

              <label htmlFor="transaction-notes">
                {texts.transactions.notesLabel}
              </label>
              <textarea
                id="transaction-notes"
                value={transactionNotes}
                onChange={(event) => setTransactionNotes(event.target.value)}
                placeholder={texts.transactions.notesPlaceholder}
                maxLength={250}
                rows={3}
                disabled={transactionSaving}
              />

              <p className="transaction-total-preview">
                {texts.transactions.totalPreview(
                  formatClp(
                    transactionPreviewTotal,
                    language,
                    texts.transactions.currency
                  )
                )}
              </p>

              {transactionMessage && (
                <p role={transactionMessage === 'success' ? 'status' : 'alert'}>
                  {texts.transactions[transactionMessage]}
                </p>
              )}

              <button
                type="submit"
                disabled={transactionSaving || cards.length === 0}
              >
                {transactionSaving
                  ? texts.transactions.saving
                  : texts.transactions.register}
              </button>
            </form>

            <div className="transaction-history-list">
              <h4>{texts.transactions.historyTitle}</h4>

              {transactionsLoading && (
                <p role="status">{texts.transactions.loading}</p>
              )}

              {transactionsError && (
                <p role="alert">{texts.transactions.loadError}</p>
              )}

              {!transactionsLoading && !transactionsError && transactions.length === 0 && (
                <p>{texts.transactions.empty}</p>
              )}

              {!transactionsLoading && !transactionsError && transactions.length > 0 && (
                <>
                  <div
                    className="transaction-filters"
                    role="group"
                    aria-label={texts.transactions.filterLabel}
                  >
                    <button
                      type="button"
                      className={transactionFilter === 'all' ? 'is-active' : ''}
                      aria-pressed={transactionFilter === 'all'}
                      onClick={() => setTransactionFilter('all')}
                    >
                      {texts.transactions.all}
                    </button>
                    <button
                      type="button"
                      className={transactionFilter === 'purchase' ? 'is-active' : ''}
                      aria-pressed={transactionFilter === 'purchase'}
                      onClick={() => setTransactionFilter('purchase')}
                    >
                      {texts.transactions.purchases}
                    </button>
                    <button
                      type="button"
                      className={transactionFilter === 'sale' ? 'is-active' : ''}
                      aria-pressed={transactionFilter === 'sale'}
                      onClick={() => setTransactionFilter('sale')}
                    >
                      {texts.transactions.sales}
                    </button>
                  </div>

                  {filteredTransactions.length === 0 ? (
                    <p>{texts.transactions.noResults}</p>
                  ) : (
                    <div
                      className="transaction-list"
                      aria-label={texts.transactions.historyLabel}
                    >
                      {filteredTransactions.map((transaction) => {
                        const collectionCard = cards.find(
                          (card) => card.cardId === transaction.cardId
                        )
                        const details = transactionCardDetails[transaction.cardId] ??
                          collectionCard?.details
                        const cardName = details?.name || transaction.cardId
                        const imageUrl = details?.image
                          ? `${details.image}/low.webp`
                          : null
                        const totalPrice = transaction.totalPrice ??
                          transaction.quantity * transaction.unitPrice

                        return (
                          <article
                            key={transaction.id}
                            className={`transaction-item transaction-item--${transaction.transactionType}`}
                          >
                            {imageUrl && (
                              <img
                                src={imageUrl}
                                alt={texts.transactions.cardImageAlt(cardName)}
                                loading="lazy"
                                onLoad={(event) => {
                                  event.currentTarget.hidden = false
                                }}
                                onError={(event) => {
                                  event.currentTarget.hidden = true
                                }}
                              />
                            )}

                            <div className="transaction-item-content">
                              <div className="transaction-item-heading">
                                <strong>{cardName}</strong>
                                <span>
                                  {transaction.transactionType === 'purchase'
                                    ? texts.transactions.purchase
                                    : texts.transactions.sale}
                                </span>
                              </div>
                              <p>{texts.transactions.quantity(transaction.quantity)}</p>
                              <p>
                                {texts.transactions.unitPrice(
                                  formatClp(
                                    transaction.unitPrice,
                                    language,
                                    texts.transactions.currency
                                  )
                                )}
                              </p>
                              <p>
                                <strong>
                                  {texts.transactions.total(
                                    formatClp(
                                      totalPrice,
                                      language,
                                      texts.transactions.currency
                                    )
                                  )}
                                </strong>
                              </p>
                              <p>
                                {texts.transactions.date(
                                  formatTransactionDate(
                                    transaction.transactionDate,
                                    language
                                  )
                                )}
                              </p>
                              {transaction.notes && (
                                <p>{texts.transactions.notes(transaction.notes)}</p>
                              )}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </details>
      )}
    </section>
  )
}
export default Collection
