
import { useEffect, useState } from 'react'
import { getCards, getCardById } from '../services/cardService'
import PokemonCard from './PokemonCard'
import { addCardToCollection } from '../services/collectionService'
import './Catalog.css'

const CARDS_PER_PAGE = 12

function Catalog({ texts, language }) {
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [addingCardId, setAddingCardId] = useState(null)
  const [addFeedback, setAddFeedback] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadCards() {
      setLoading(true)
      setError(false)

      try { //Obtenemos cartas resumidas del catálogo
        const basicCards = await getCards(search, page, language)

        if (cancelled) return
        
        //Mientras obtenemos los detalles mostramos las cartas básicas
        setCards(basicCards)
        setLoading(false)
        //Consultamos info completa de las cartas
        const completeCards = await Promise.all(
          basicCards.map(async (card) => {
            try{
              const details = await getCardById(card.id, language)
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
          setError(true)
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
  }, [search, page, language])

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
      name: card.name,
      quantity: savedCard.quantity
    })
  } catch {
    setAddFeedback({
      type: 'error'
    })
  } finally {
    setAddingCardId(null)
  }
}


  return (
    <section className="catalog">
      <h2>{texts.catalog.title}</h2>
      <p>{texts.catalog.description}</p>

      <form className="catalog-search" onSubmit={handleSearch}>
        <label htmlFor="card-search">
          {texts.catalog.searchLabel}
        </label>

        <input
          id="card-search"
          type="search"
          placeholder={texts.catalog.placeholder}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />

        <button type="submit">{texts.catalog.search}</button>

        <button type="button" onClick={showAll}>
          {texts.catalog.showAll}
        </button>
      
      </form>

      {/* Mensaje de confirmación o error al agregar una carta */}
      {addFeedback && (
        <p role={addFeedback.type === 'error' ? 'alert' : 'status'}>
          {addFeedback.type === 'error'
            ? texts.catalog.addError
            : texts.catalog.added(addFeedback.name, addFeedback.quantity)}
        </p>
      )}

      {loading && <p role="status">{texts.catalog.loading}</p>}

      {error && <p role="alert">{texts.catalog.loadError}</p>}

      {!loading && !error && (
        <>
          <p>{texts.catalog.pageInfo(page, cards.length)}</p>

          {cards.length === 0 ? (
            <p>{texts.catalog.empty}</p>
          ) : (
            <div className="pokemon-grid">
              {cards.map((card) => (
                <PokemonCard
                  key={card.id}
                  card={card}
                  onAdd={handleAddToCollection}
                  adding={addingCardId === card.id}
                  texts={texts}
                />
              ))}
            </div>
          )}

          <nav className="pagination" aria-label={texts.catalog.paginationLabel}>
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {texts.catalog.previous}
            </button>

            <span>{texts.catalog.page(page)}</span>

            <button
              type="button"
              disabled={cards.length < CARDS_PER_PAGE}
              onClick={() => setPage((p) => p + 1)}
            >
              {texts.catalog.next}
            </button>
          </nav>
        </>
      )}
    </section>
  )
}

export default Catalog
