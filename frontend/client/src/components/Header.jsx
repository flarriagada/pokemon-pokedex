import { Link, NavLink } from 'react-router'
import GoogleLoginButton from './GoogleLoginButton'

function Header() {
  return (
    <header className="site-header">
      <h1>
        <Link to="/">Mi Pokédex</Link>
      </h1>
      <p>Organiza y administra tus cartas Pokémon</p>
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

        <NavLink to="/decks">
          Mis mazos
        </NavLink>

      </nav>
      <GoogleLoginButton />
    </header>
  )
}

export default Header
