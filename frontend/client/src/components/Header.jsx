import { Link, NavLink } from 'react-router'

function Header() {
  return (
    <header className="site-header">
      <h1>
        <Link to="/">Mi Pokédex</Link>
      </h1>
      <p>Organiza y administra tus cartas pokemón</p>
      <nav className="site-nav" aria-label="Navegación principal">
        <NavLink to="/" end>
          Inicio
        </NavLink>

        <NavLink to="/catalog">
          Catálogo
        </NavLink>

        <NavLink to="/collection">
          Mi colección
        </NavLink>
      </nav>
    </header>
  )
}

export default Header
