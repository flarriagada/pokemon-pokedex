import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getCollection, updateCollectionQuantity, updateCardTradeStatus, deleteCollectionCard } from '../services/collectionService'
import { getCardById } from '../services/cardService'
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

  const totalCards = cards.reduce(
    (total, card) => total + card.quantity,
    0
  )
  const visibleCards = showTradeOnly
    ? cards.filter((card) => card.forTrade)
    : cards

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
    </section>
  )
}
export default Collection
