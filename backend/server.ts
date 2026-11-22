import {
  getCardsFromTcgdex,
  getLastCardsPageFromTcgdex,
  getComplementedCardFromProviders,
  getFallbackCardImage,
  getSetsFromTcgdex,
  getSetFromTcgdex
} from './services/tcgdexService.ts'
import { openDatabase } from './db/database.ts'
import { handleCollectionRequest } from './routes/collectionRoutes.ts'
import { handleAuthRequest } from './routes/authRoutes.ts'
import { cleanupExpiredSessions } from './db/cleanupSessions.ts'
import { handleDeckRequest } from './routes/deckRoutes.ts'

const PORT = 8000
const db = openDatabase()

function getLanguage(url: URL): 'es' | 'en' | null {
  const language = url.searchParams.get('lang') ?? 'es'

  return language === 'es' || language === 'en'
    ? language
    : null
}

// Limpiamos las sesiones vencidas cada vez que inicia el servidor.
const deletedSessions = cleanupExpiredSessions(db)

console.log('Sesiones vencidas eliminadas:', deletedSessions)

Deno.serve(
  {
    hostname: '127.0.0.1',
    port: PORT
  },
  async (request: Request) => {
    const url = new URL(request.url)

console.log('Solicitud recibida:', request.method, url.pathname)

const authResponse = await handleAuthRequest(
  request,
  url,
  db
)

if (authResponse) {
  return authResponse
}



    if (
      request.method === 'GET' &&
      url.pathname === '/api/health'
    ) {
      db.prepare('SELECT 1').get() //comprobamos conexion con SQLite puede realizar consultas
      return Response.json({
        status: 'ok',
        service: 'pokemon-pokedex-api'
      })
    }

    if (
      request.method === 'GET' &&
      url.pathname === '/api/cards'
    ) {
      const search = url.searchParams.get('search') ?? ''
      const localId = url.searchParams.get('localId') ?? ''
      const hp = url.searchParams.get('hp') ?? ''
      const exactLocalIdValue = url.searchParams.get('exactLocalId') ?? ''
      const exactLocalId = exactLocalIdValue === 'true'
      const page = Number(url.searchParams.get('page') ?? '1')
      const language = getLanguage(url)

      if (!language) {
        return Response.json(
          { error: 'Idioma inválido' },
          { status: 400 }
        )
      }

      if (!Number.isInteger(page) || page < 1) {
        return Response.json(
          { error: 'Número de página inválido' },
          { status: 400 }
        )
      }

      if (
        search.length > 100 ||
        localId.length > 30 ||
        (hp && (!/^\d{2,3}$/.test(hp) || Number(hp) > 999)) ||
        !['', 'true', 'false'].includes(exactLocalIdValue) ||
        (localId && !/^[a-zA-Z0-9._-]+$/.test(localId))
      ) {
        return Response.json(
          { error: 'Filtros de cartas inválidos' },
          { status: 400 }
        )
      }

      try {
        const cards = await getCardsFromTcgdex(
          search,
          page,
          language,
          localId,
          exactLocalId,
          hp
        )
        return Response.json(cards)
      } catch {
        return Response.json(
          { error: 'No se pudieron obtener las cartas' },
          { status: 502 }
        )
      }
    }

    if (
      request.method === 'GET' &&
      url.pathname === '/api/cards/last-page'
    ) {
      const search = url.searchParams.get('search') ?? ''
      const localId = url.searchParams.get('localId') ?? ''
      const language = getLanguage(url)

      if (!language) {
        return Response.json(
          { error: 'Idioma inválido' },
          { status: 400 }
        )
      }

      if (
        search.length > 100 ||
        localId.length > 30 ||
        (localId && !/^[a-zA-Z0-9._-]+$/.test(localId))
      ) {
        return Response.json(
          { error: 'Filtros de cartas inválidos' },
          { status: 400 }
        )
      }

      try {
        const lastPage = await getLastCardsPageFromTcgdex(
          search,
          language,
          localId
        )
        return Response.json({ lastPage })
      } catch {
        return Response.json(
          { error: 'No se pudo determinar la última página' },
          { status: 502 }
        )
      }
    }

    const fallbackImageMatch = url.pathname.match(
      /^\/api\/cards\/([^/]+)\/fallback-image$/
    )

    if (request.method === 'GET' && fallbackImageMatch) {
      const language = getLanguage(url)
      let cardId: string

      if (!language) {
        return Response.json(
          { error: 'Idioma inválido' },
          { status: 400 }
        )
      }

      try {
        cardId = decodeURIComponent(fallbackImageMatch[1])
      } catch {
        return Response.json(
          { error: 'Identificador de carta inválido' },
          { status: 400 }
        )
      }

      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(cardId)) {
        return Response.json(
          { error: 'Identificador de carta inválido' },
          { status: 400 }
        )
      }

      try {
        const fallback = await getFallbackCardImage(cardId, language)

        return fallback
          ? Response.json(fallback)
          : Response.json(
              { error: 'Imagen de respaldo no encontrada' },
              { status: 404 }
            )
      } catch {
        return Response.json(
          { error: 'No se pudo obtener la imagen de respaldo' },
          { status: 502 }
        )
      }
    }

    const cardMatch = url.pathname.match(
      /^\/api\/cards\/([^/]+)$/
    )

    if (request.method === 'GET' && cardMatch) {
      let cardId: string
      const language = getLanguage(url)

      if (!language) {
        return Response.json(
          { error: 'Idioma inválido' },
          { status: 400 }
        )
      }

      try {
        cardId = decodeURIComponent(cardMatch[1])
      } catch {
        return Response.json(
          { error: 'Identificador inválido' },
          { status: 400 }
        )
      }

      if (!cardId.trim() || cardId.length > 100) {
        return Response.json(
          { error: 'Identificador inválido' },
          { status: 400 }
        )
      }

      try {
        const card = await getComplementedCardFromProviders(cardId, language)

        if (!card) {
          return Response.json(
            { error: 'Carta no encontrada' },
            { status: 404 }
          )
        }

        return Response.json(card)
      } catch {
        return Response.json(
          { error: 'No se pudieron obtener los detalles' },
          { status: 502 }
        )
      }
    }

    if (
      request.method === 'GET' &&
      url.pathname === '/api/sets'
    ) {
      const language = getLanguage(url)
      const search = url.searchParams.get('search') ?? ''

      if (!language) {
        return Response.json(
          { error: 'Idioma inválido' },
          { status: 400 }
        )
      }

      if (search.length > 100) {
        return Response.json(
          { error: 'Búsqueda de expansión inválida' },
          { status: 400 }
        )
      }

      try {
        const sets = await getSetsFromTcgdex(language, search)
        return Response.json(sets)
      } catch {
        return Response.json(
          { error: 'No se pudieron obtener las expansiones' },
          { status: 502 }
        )
      }
    }

    const setMatch = url.pathname.match(
      /^\/api\/sets\/([^/]+)$/
    )

    if (request.method === 'GET' && setMatch) {
      let setId: string
      const language = getLanguage(url)

      if (!language) {
        return Response.json(
          { error: 'Idioma inválido' },
          { status: 400 }
        )
      }

      try {
        setId = decodeURIComponent(setMatch[1])
      } catch {
        return Response.json(
          { error: 'Identificador inválido' },
          { status: 400 }
        )
      }

      if (
        !setId.trim() ||
        setId.length > 100 ||
        !/^[a-zA-Z0-9._-]+$/.test(setId)
      ) {
        return Response.json(
          { error: 'Identificador inválido' },
          { status: 400 }
        )
      }

      try {
        const set = await getSetFromTcgdex(setId, language)

        if (!set) {
          return Response.json(
            { error: 'Expansión no encontrada' },
            { status: 404 }
          )
        }

        return Response.json(set)
      } catch {
        return Response.json(
          { error: 'No se pudieron obtener los detalles de la expansión' },
          { status: 502 }
        )
      }
    }

const collectionResponse = await handleCollectionRequest(
  request,
  url,
  db
)

if (collectionResponse) {
  return collectionResponse
}

// Procesamos las solicitudes relacionadas con mazos.
const deckResponse = await handleDeckRequest(
  request,
  url,
  db
)

if (deckResponse) {
  return deckResponse
}

    return Response.json(
      { error: 'Ruta no encontrada' },
      { status: 404 }
    )
  }
)
