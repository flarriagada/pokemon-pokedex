import { useState, useEffect } from 'react'
import { getCards } from '../services/cardService'

function Catalog() {
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadCards() {
      setLoading(true)
      setError('')

      try {
        const result = await getCards(search, 1)

        if (!cancelled) {
          setCards(result)
        }
      } catch {
        if (!cancelled) {
          setCards([])
          setError('No se pudieron cargar las cartas.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadCards()

    return () => {
      cancelled = true
    }
  }, [search])

  function handleSearch(event) {
    event.preventDefault()
    setSearch(searchText.trim())
  }

  return (
    <section className="catalog">
      <h2>Catálogo de cartas</h2>
      <p>Explora y busca cartas Pokémon.</p>
        <form onSubmit={handleSearch}>
        <label htmlFor="card-search">
          Nombre de la carta
        </label>

        <input
          id="card-search"
          type="search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Ej.: Pikachu"
        />

        <button type="submit">
          Buscar
        </button>
      </form>

      {loading && <p>Buscando cartas...</p>}

      {error && <p role="alert">{error}</p>}

      {!loading && !error && cards.length === 0 && (
        <p>No se encontraron cartas.</p>
      )}

      {!loading && !error && cards.length > 0 && (
        <ul>
          {cards.map((card) => (
            <li key={card.id}>
              {card.name} - N.º {card.localId}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default Catalog