import Header from '../components/Header'
import PokemonCard from '../components/PokemonCard'
import './Home.css'
import { Link } from 'react-router'


function Home() {
  return (
    <section className="home">
       <h2>Bienvenido a tu Pokédex</h2>

      <p>
        Consulta el catálogo de cartas Pokémon y accede
        a las distintas secciones de tu colección.
      </p>

      <div className="home-links">
        <Link to="/catalog" className="home-link">
          <h3>Catálogo</h3>
          <p>Busca cartas Pokémon y consulta sus imágenes.</p>
        </Link>

        <Link to="/collection" className="home-link">
          <h3>Mi colección</h3>
          <p>Accede a la sección de tu inventario personal.</p>
        </Link>
      </div>
    </section>
  )
}

export default Home