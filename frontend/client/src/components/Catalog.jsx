
import { useEffect, useState } from 'react'
import {
  getCards,
  getCardById,
  getLastCardPage
} from '../services/cardService'
import PokemonCard from './PokemonCard'
import { addCardToCollection } from '../services/collectionService'
import './Catalog.css'

const CARDS_PER_PAGE = 12
const DESKTOP_PAGE_COUNT = 5
const MOBILE_PAGE_COUNT = 3

function getNearbyPages(currentPage, lastPage, visibleCount) {
  if (lastPage < 1) return []

  const count = Math.min(visibleCount, lastPage)
  let start = Math.max(1, currentPage - Math.floor(count / 2))
  let end = start + count - 1

  if (end > lastPage) {
    end = lastPage
    start = Math.max(1, end - count + 1)
  }

  return Array.from(
    { length: end - start + 1 },
    (_, index) => start + index
  )
}

function Catalog({ texts, language }) {
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const queryKey = `${language}:${search}`
  const [pageState, setPageState] = useState({ queryKey, page: 1 })
  const [lastPageState, setLastPageState] = useState({
    queryKey: '',
    lastPage: 0,
    error: false
  })
  const page = pageState.queryKey === queryKey ? pageState.page : 1
  const activeLastPageState = lastPageState.queryKey === queryKey
    ? lastPageState
    : { queryKey, lastPage: 0, error: false }
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [addingCardId, setAddingCardId] = useState(null)
  const [addFeedback, setAddFeedback] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadLastPage() {
      try {
        const lastPage = await getLastCardPage(search, language)

        if (cancelled) return

        setLastPageState({
          queryKey,
          lastPage,
          error: false
        })

        setPageState((current) => {
          const currentPage = current.queryKey === queryKey
            ? current.page
            : 1

          return lastPage > 0 && currentPage > lastPage
            ? { queryKey, page: lastPage }
            : current
        })
      } catch {
        if (cancelled) return

        setLastPageState({
          queryKey,
          lastPage: 0,
          error: true
        })
      }
    }

    void loadLastPage()

    return () => {
      cancelled = true
    }
  }, [language, queryKey, search])

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
    const normalizedSearch = searchText.trim()

    setPageState({
      queryKey: `${language}:${normalizedSearch}`,
      page: 1
    })
    setSearch(normalizedSearch)
  }

  function showAll() {
    setSearchText('')
    setSearch('')
    setPageState({ queryKey: `${language}:`, page: 1 })
  }

  function goToPage(nextPage) {
    if (
      !Number.isInteger(nextPage) ||
      nextPage < 1 ||
      (
        activeLastPageState.lastPage > 0 &&
        nextPage > activeLastPageState.lastPage
      )
    ) {
      return
    }

    setPageState({ queryKey, page: nextPage })
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
                  language={language}
                />
              ))}
            </div>
          )}

          <nav className="pagination" aria-label={texts.catalog.paginationLabel}>
            <button
              type="button"
              disabled={page === 1}
              onClick={() => goToPage(1)}
            >
              {texts.catalog.first}
            </button>

            <button
              type="button"
              disabled={page === 1}
              onClick={() => goToPage(page - 1)}
            >
              {texts.catalog.previous}
            </button>

            {getNearbyPages(
              page,
              activeLastPageState.lastPage,
              DESKTOP_PAGE_COUNT
            )[0] > 1 && (
              <span className="pagination-ellipsis" aria-hidden="true">
                …
              </span>
            )}

            {getNearbyPages(
              page,
              activeLastPageState.lastPage,
              DESKTOP_PAGE_COUNT
            ).map((pageNumber) => {
              const mobilePages = getNearbyPages(
                page,
                activeLastPageState.lastPage,
                MOBILE_PAGE_COUNT
              )

              return (
                <button
                  key={pageNumber}
                  type="button"
                  className={[
                    'pagination-page-number',
                    pageNumber === page ? 'is-active' : '',
                    !mobilePages.includes(pageNumber)
                      ? 'pagination-page--mobile-hidden'
                      : ''
                  ].filter(Boolean).join(' ')}
                  aria-current={pageNumber === page ? 'page' : undefined}
                  aria-label={texts.catalog.page(pageNumber)}
                  onClick={() => goToPage(pageNumber)}
                >
                  {pageNumber}
                </button>
              )
            })}

            {getNearbyPages(
              page,
              activeLastPageState.lastPage,
              DESKTOP_PAGE_COUNT
            ).at(-1) < activeLastPageState.lastPage && (
              <span className="pagination-ellipsis" aria-hidden="true">
                …
              </span>
            )}

            <button
              type="button"
              disabled={
                activeLastPageState.lastPage < 1 ||
                page >= activeLastPageState.lastPage
              }
              onClick={() => goToPage(activeLastPageState.lastPage)}
            >
              {texts.catalog.last}
            </button>

            <button
              type="button"
              disabled={
                activeLastPageState.lastPage > 0
                  ? page >= activeLastPageState.lastPage
                  : cards.length < CARDS_PER_PAGE || activeLastPageState.error
              }
              onClick={() => goToPage(page + 1)}
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
