import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getCollection } from '../services/collectionService'

function Collection() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadCollection() {
      try {
        const result = await getCollection()

        if (!cancelled) {
          setCards(result)
        }
      } catch {
        if (!cancelled) {
          setError('No se pudo cargar tu colección.')
        }
      } finally {
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

  const totalCards = cards.reduce(
    (total, card) => total + card.quantity,
    0
  )

  return (
    <section className="collection">
      <h2>Mi colección</h2>

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
            {cards.map((card) => (
              <article key={card.id} className="collection-item">
                <h3>Carta: {card.cardId}</h3>
                <p>Cantidad: {card.quantity}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
export default Collection