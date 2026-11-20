import { Link, NavLink } from 'react-router'
import GoogleLoginButton from './GoogleLoginButton'

function Header({ texts, language, onLanguageChange }) {
  return (
    <header className="site-header">
      <h1>
        <Link to="/">{texts.header.title}</Link>
      </h1>
      <p>{texts.header.subtitle}</p>
      <nav className="site-nav" aria-label={texts.header.mainNavigation}>
        <NavLink to="/" end>
          {texts.header.home}
        </NavLink>

        <NavLink to="/catalog">
          {texts.header.catalog}
        </NavLink>

        <NavLink to="/collection">
          {texts.header.collection}
        </NavLink>

        <NavLink to="/decks">
          {texts.header.decks}
        </NavLink>

      </nav>
      {/* Switch para cambiar el idioma. */}
      <div
        className="language-switch"
        role="group"
        aria-label={texts.header.language}
      >
        <button
          type="button"
          className={language === 'es' ? 'is-active' : ''}
          onClick={() => onLanguageChange('es')}
          aria-label={texts.header.spanish}
          aria-pressed={language === 'es'}
        >
          ES
        </button>

        <button
          type="button"
          className={language === 'en' ? 'is-active' : ''}
          onClick={() => onLanguageChange('en')}
          aria-label={texts.header.english}
          aria-pressed={language === 'en'}
        >
          EN
        </button>
      </div>
      <GoogleLoginButton texts={texts} language={language} />
    </header>
  )
}

export default Header
