
const PORT = 8000

Deno.serve(
  {
    hostname: '127.0.0.1',
    port: PORT
  },
  (request: Request) => {
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

    return Response.json(
      { error: 'Ruta no encontrada' },
      { status: 404 }
    )
  }
)
