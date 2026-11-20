import { useState } from 'react'

function PokemonCard({ card, onAdd, adding = false }) {
  const [imageError, setImageError] = useState(false)

  // Algunas cartas tienen varios tipos y otras no tienen ninguno
  const types = Array.isArray(card.types)
    ? card.types
    : []

  // Usamos los tipos del Pokémon o su categoría (Pokémon, Entrenador o Energía).
  const cardType = types.length > 0
    ? types.join(', ')
    : card.category

  // Las cartas del catálogo solo traen información resumida.
  const hasDetails = Boolean(
    card.set || card.rarity || card.category
  )

  const imageUrl = card.image
    ? `${card.image}/low.webp`
    : null

  return (
    <article className="pokemon-card">
      {imageUrl && !imageError ? (
        <img
          src={imageUrl}
          alt={`Carta de ${card.name}`}
          className="pokemon-card-image"
          loading="lazy"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="pokemon-placeholder">
          Imagen no disponible
        </div>
      )}

      <h3>{card.name}</h3>
      <p>N.º {card.localId}</p>
      <p>ID: {card.id}</p>
      
      {/* Mostramos los detalles cuando la API los proporcione */}
      {hasDetails && (
        <div className="pokemon-card-details">
          <p>
            <strong>Tipo:</strong> {cardType || 'No disponible'}
          </p>

          <p>
            <strong>Rareza:</strong> {card.rarity || 'No disponible'}
          </p>

          <p>
            <strong>Expansión:</strong> {card.set?.name || 'No disponible'}
          </p>
        </div>
      )}

      {onAdd && (
        <button
         type="button"
         className="add-card-button"
         onClick={() => onAdd(card)}
         disabled={adding}
  >
         {adding ? 'Agregando...' : 'Agregar a mi colección'}
        </button>
)}

    </article>
  )
}

export default PokemonCard
