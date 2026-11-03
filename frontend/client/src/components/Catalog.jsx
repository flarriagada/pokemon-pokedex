
import { useEffect, useState } from 'react'
import { getCards } from '../services/cardService'
import PokemonCard from './PokemonCard'
import './Catalog.css'

const CARDS_PER_PAGE = 12

function Catalog() {
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadCards() {
      setLoading(true)
      setError('')

      try {
        const result = await getCards(search, page)

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
  }, [search, page])

  function handleSearch(event) {
    event.preventDefault()
    setPage(1)
    setSearch(searchText.trim())
  }

  function showAll() {
    setSearchText('')
    setSearch('')
    setPage(1)
  }

  return (
    <section className="catalog">
      <h2>Catálogo de cartas</h2>
      <p>Explora o busca cartas Pokémon.</p>

      <form className="catalog-search" onSubmit={handleSearch}>
        <label htmlFor="card-search">
          Buscar por nombre
        </label>

        <input
          id="card-search"
          type="search"
          placeholder="Ej.: Pikachu"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />

        <button type="submit">Buscar</button>

        <button type="button" onClick={showAll}>
          Mostrar todo
        </button>
      </form>

      {loading && <p role="status">Cargando cartas...</p>}

      {error && <p role="alert">{error}</p>}

      {!loading && !error && (
        <>
          <p>
            Página {page} · {cards.length} cartas mostradas
          </p>

          {cards.length === 0 ? (
            <p>No se encontraron cartas en esta página.</p>
          ) : (
            <div className="pokemon-grid">
              {cards.map((card) => (
                <PokemonCard
                  key={card.id}
                  card={card}
                />
              ))}
            </div>
          )}

          <nav className="pagination" aria-label="Páginas del catálogo">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>

            <span>Página {page}</span>

            <button
              type="button"
              disabled={cards.length < CARDS_PER_PAGE}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </button>
          </nav>
        </>
      )}
    </section>
  )
}

export default Catalog
