import { getCardsFromTcgdex , getCardFromTcgdex} from './services/tcgdexService.ts'
import { openDatabase } from './db/database.ts'
import { handleCollectionRequest } from './routes/collectionRoutes.ts'
const PORT = 8000
const db = openDatabase()

Deno.serve(
  {
    hostname: '127.0.0.1',
    port: PORT
  },
  async (request: Request) => {
    const url = new URL(request.url)

console.log('Solicitud recibida:', request.method, url.pathname)


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

      if (!Number.isInteger(page) || page < 1) {
        return Response.json(
          { error: 'Número de página inválido' },
          { status: 400 }
        )
      }

      try {
        const cards = await getCardsFromTcgdex(search, page)
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
        const card = await getCardFromTcgdex(cardId)

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

const collectionResponse = await handleCollectionRequest(
  request,
  url,
  db
)

if (collectionResponse) {
  return collectionResponse
}

    return Response.json(
      { error: 'Ruta no encontrada' },
      { status: 404 }
    )
  }
)
