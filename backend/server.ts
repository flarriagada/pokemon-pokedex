import {
  getCardsFromTcgdex,
  getCardFromTcgdex,
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

      try {
        const cards = await getCardsFromTcgdex(search, page, language)
        return Response.json(cards)
      } catch {
        return Response.json(
          { error: 'No se pudieron obtener las cartas' },
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
        const card = await getCardFromTcgdex(cardId, language)

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

      if (!language) {
        return Response.json(
          { error: 'Idioma inválido' },
          { status: 400 }
        )
      }

      try {
        const sets = await getSetsFromTcgdex(language)
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
