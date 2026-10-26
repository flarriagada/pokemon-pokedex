import { BrowserRouter, Link, Route, Routes } from 'react-router'

import Home from './pages/Home'
import Header from './components/Header'
import Collection from './pages/Collection'
import Catalog from './components/Catalog.jsx'

import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Header />

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home />} />

          <Route path="/catalog" element={<Catalog />} />

          <Route path="/collection" element={<Collection />} />

          <Route
            path="*"
            element={
              <section>
                <h2>Página no encontrada</h2>
                <p>La dirección que ingresaste no existe.</p>
                <Link to="/">Volver al inicio</Link>
              </section>
            }
          />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

export default App
