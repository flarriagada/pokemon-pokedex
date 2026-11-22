import { useState } from 'react'
import { Link, NavLink } from 'react-router'
import GoogleLoginButton from './GoogleLoginButton'

function Header({ texts, language, onLanguageChange }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const closeMenu = () => setIsMenuOpen(false)

  return (
    <>
      <header className="site-header">
        <button
          type="button"
          className="menu-toggle"
          aria-label={
            isMenuOpen ? texts.header.closeMenu : texts.header.openMenu
          }
          aria-controls="site-sidebar"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((current) => !current)}
        >
          <span aria-hidden="true">☰</span>
        </button>

        <h1>
          <Link to="/">{texts.header.title}</Link>
        </h1>

        <div className="header-actions">
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

          <details className="user-menu">
            <summary>{texts.header.userMenu}</summary>
            <div className="user-menu-panel">
              <GoogleLoginButton texts={texts} language={language} />
            </div>
          </details>
        </div>
      </header>

      <aside
        id="site-sidebar"
        className={`site-sidebar${isMenuOpen ? ' is-open' : ''}`}
      >
        <div className="sidebar-heading">
          <strong>{texts.header.title}</strong>
          <p>{texts.header.subtitle}</p>
        </div>

        <nav className="site-nav" aria-label={texts.header.mainNavigation}>
          <NavLink to="/" end onClick={closeMenu}>
            {texts.header.home}
          </NavLink>

          <NavLink to="/catalog" onClick={closeMenu}>
            {texts.header.catalog}
          </NavLink>

          <NavLink to="/collection" onClick={closeMenu}>
            {texts.header.collection}
          </NavLink>

          <NavLink to="/decks" onClick={closeMenu}>
            {texts.header.decks}
          </NavLink>

          <NavLink to="/history" onClick={closeMenu}>
            {texts.header.history}
          </NavLink>
        </nav>

        <a
          className="image-credit"
          href="https://cardcorpus.com"
          target="_blank"
          rel="noreferrer"
        >
          {texts.header.imageCredit}
        </a>
      </aside>

      {isMenuOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label={texts.header.closeMenu}
          onClick={closeMenu}
        />
      )}
    </>
  )
}

export default Header
