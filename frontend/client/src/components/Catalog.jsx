
import { useEffect, useState } from 'react'
import { getCards, getCardById } from '../services/cardService'
import PokemonCard from './PokemonCard'
import { addCardToCollection } from '../services/collectionService'
import './Catalog.css'

const CARDS_PER_PAGE = 12

function Catalog() {
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addingCardId, setAddingCardId] = useState(null)
  const [addFeedback, setAddFeedback] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadCards() {
      setLoading(true)
      setError('')

      try { //Obtenemos cartas resumidas del catálogo
        const basicCards = await getCards(search, page)

        if (cancelled) return
        
        //Mientras obtenemos los detalles mostramos las cartas básicas
        setCards(basicCards)
        setLoading(false)
        //Consultamos info completa de las cartas
        const completeCards = await Promise.all(
          basicCards.map(async (card) => {
            try{
              const details = await getCardById(card.id)
              return details ?? card //si la API no entrega detalles conservamos la carta básica
            }
            catch {
              return card //Si tenemos un error en una carta, no afecta a las demás
            }
          })
        )
        // Actualizamos el catalogo solo si seguimos en esa página.
        if (!cancelled){
          setCards(completeCards)
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


async function handleAddToCollection(card) {
  if (addingCardId !== null) return

  setAddingCardId(card.id)
  setAddFeedback(null)

  try {
    const savedCard = await addCardToCollection(card.id, 1)

    setAddFeedback({
      type: 'success',
      text: `${card.name} agregada. Cantidad: ${savedCard.quantity}`
    })
  } catch {
    setAddFeedback({
      type: 'error',
      text: 'No se pudo agregar la carta a tu colección.'
    })
  } finally {
    setAddingCardId(null)
  }
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

      {/* Mensaje de confirmación o error al agregar una carta */}
      {addFeedback && (
        <p role={addFeedback.type === 'error' ? 'alert' : 'status'}>
          {addFeedback.text}
        </p>
      )}

      {loading && <p role="status">Cargando cartas...</p>}

      {error && <p role="alert">{error}</p>}


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
                  onAdd={handleAddToCollection}
                  adding={addingCardId === card.id}
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
