import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getCollection, updateCollectionQuantity, deleteCollectionCard } from '../services/collectionService'
import { getCardById } from '../services/cardService'
import PokemonCard from '../components/PokemonCard'
import '../components/Catalog.css'

function Collection() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')


  useEffect(() => {
    let cancelled = false

    async function loadCollection() {
      try {
        const result = await getCollection()

        if (!cancelled) {
          setCards(result)
        }

        const savedCards = await getCollection()

        const completeCards = await Promise.all(
          savedCards.map(async (item) => {
            try {
              const details = await getCardById(item.cardId)

              return {
                ...item,
                details
              }
            } catch {
              return {
                ...item,
                details: {
                  id: item.cardId,
                  name: `Carta ${item.cardId}`,
                  localId: '—',
                  image: null
                }
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
  }, [])

async function handleQuantityChange(item, newQuantity) {
  if (busyId !== null || newQuantity < 1) return

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
    setActionError('No se pudo actualizar la cantidad.')
  } finally {
    setBusyId(null)
  }
}


async function handleDelete(item) {
  if (busyId !== null) return

  const confirmed = window.confirm(
    `¿Quieres eliminar ${item.details.name} de tu colección?`
  )

  if (!confirmed) return

  setBusyId(item.id)
  setActionError('')

  try {
    await deleteCollectionCard(item.id)

    setCards((current) =>
      current.filter((card) => card.id !== item.id)
    )
  } catch {
    setActionError('No se pudo eliminar la carta.')
  } finally {
    setBusyId(null)
  }
}

  const totalCards = cards.reduce(
    (total, card) => total + card.quantity,
    0
  )

  return (
    <section className="collection">
      <h2>Mi colección</h2>
      {actionError && (
        <p role="alert">{actionError}</p>
      )}

      {loading && <p role="status">Cargando colección...</p>}

      {error && <p role="alert">{error}</p>}

      {!loading && !error && cards.length === 0 && (
        <div className="empty-collection">
          <h3>Tu colección está vacía</h3>
          <p>Todavía no tienes cartas registradas.</p>
          <Link to="/catalog">Explorar catálogo</Link>
        </div>
      )}

      {!loading && !error && cards.length > 0 && (
        <>
          <p>
            Tienes {totalCards} cartas en total,
            de {cards.length} cartas diferentes.
          </p>

          
          <div className="collection-grid">
            {cards.map((item) => (
              <article key={item.id} className="collection-item">
                <PokemonCard card={item.details} />

                <div className="quantity-controls">
                  <button
                    type="button"
                    aria-label={`Quitar una unidad de ${item.details.name}`}
                    disabled={busyId !== null || item.quantity <= 1}
                    onClick={() =>
                      handleQuantityChange(item, item.quantity - 1)
                    }
                  >
                    −
                  </button>

                  <span>Cantidad: {item.quantity}</span>

                  <button
                    type="button"
                    aria-label={`Agregar una unidad de ${item.details.name}`}
                    disabled={busyId !== null}
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
                  disabled={busyId !== null}
                  onClick={() => handleDelete(item)}
                >
                  {busyId === item.id ? 'Guardando...' : 'Eliminar carta'}
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
export default Collection