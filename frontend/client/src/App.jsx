import { BrowserRouter, Link, Route, Routes } from 'react-router'
import Home from './pages/Home'
import Header from './components/Header'
import Collection from './pages/Collection'
import Catalog from './components/Catalog.jsx'
import Decks from './pages/Decks'
import { useState } from 'react'
import { translations } from './translations'
import './App.css'

function App() {

// Idioma seleccionado por el usuario.
const [language, setLanguage] = useState('es')

// Seleccionamos los textos correspondientes.
const texts = translations[language]

  return (
    <BrowserRouter>
      <Header
       texts={texts}
       language={language}
       onLanguageChange={setLanguage}
      />

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home texts={texts} />} />

          <Route
            path="/catalog"
            element={<Catalog texts={texts} language={language} />}
          />

          <Route
            path="/collection"
            element={<Collection texts={texts} language={language} />}
          />

          <Route
            path="/decks"
            element={<Decks texts={texts} language={language} />}
          />

          <Route
            path="/history"
            element={
              <Collection
                texts={texts}
                language={language}
                view="history"
              />
            }
          />

          <Route
            path="*"
            element={
              <section>
                <h2>{texts.notFound.title}</h2>
                <p>{texts.notFound.description}</p>
                <Link to="/">{texts.notFound.back}</Link>
              </section>
            }
          />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

export default App
