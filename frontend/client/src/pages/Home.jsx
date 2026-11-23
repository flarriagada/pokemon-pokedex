import './Home.css'
import { Link } from 'react-router'
import fondoImage from '../../../../fondo.png'


function Home({texts}) {
  return (
    <section
      className="home"
      style={{ '--home-background-image': `url("${fondoImage}")` }}
    >
       <h2>{texts.home.welcome}</h2>

      <p>
        {texts.home.description}
      </p>

      <div className="home-links">
        <Link to="/catalog" className="home-link">
          <h3>{texts.header.catalog}</h3>
          <p>{texts.home.catalogDescription}</p>
        </Link>

        <Link to="/collection" className="home-link">
          <h3>{texts.header.collection}</h3>
          <p>{texts.home.collectionDescription}</p>
        </Link>
      </div>
    </section>
  )
}

export default Home
