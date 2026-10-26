import Header from '../components/Header'
import PokemonCard from '../components/PokemonCard'
import './Home.css'

function Home() {
  return (
    <>
      <Header />

      <main className="main-content">
        <section className="collection">
          <h2>Mi Colección</h2>

          <div className="empty-collection">
            <h3>Tu colección está vacía</h3>
            <p>
             Empieza a añadir tus cartas pokemon para construir tu colección personal
            </p>
          </div>
        </section>
      </main>
    </>
  )
}

export default Home
