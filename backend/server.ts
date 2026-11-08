import { getCardsFromTcgdex } from './services/tcgdexService.ts'
const PORT = 8000

Deno.serve(
  {
    hostname: '127.0.0.1',
    port: PORT
  },
  async (request: Request) => {
    const url = new URL(request.url)

    if (
      request.method === 'GET' &&
      url.pathname === '/api/health'
    ) {
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
