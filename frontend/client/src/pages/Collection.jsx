import { Link } from 'react-router'

function Collection() {
  return (
    <section className="collection">
      <h2>Mi colección</h2>

      <div className="empty-collection">
        <h3>Aquí estará tu colección personal</h3>

        <p>
          El registro de cartas todavía no está habilitado.
          Por ahora puedes explorar el catálogo.
        </p>

        <Link to="/catalog">
          Explorar catálogo
        </Link>
      </div>
    </section>
  )
}

export default Collection