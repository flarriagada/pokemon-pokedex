import { useState } from 'react'

function PokemonCard({ card, onAdd, adding = false, texts }) {
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
          alt={texts.card.imageAlt(card.name)}
          className="pokemon-card-image"
          loading="lazy"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="pokemon-placeholder">
          {texts.card.noImage}
        </div>
      )}

      <h3>{card.name}</h3>
      <p>{texts.card.number} {card.localId}</p>
      <p>{texts.card.id}: {card.id}</p>
      
      {/* Mostramos los detalles cuando la API los proporcione */}
      {hasDetails && (
        <div className="pokemon-card-details">
          <p>
            <strong>{texts.card.type}:</strong> {cardType || texts.card.unavailable}
          </p>

          <p>
            <strong>{texts.card.rarity}:</strong> {card.rarity || texts.card.unavailable}
          </p>

          <p>
            <strong>{texts.card.expansion}:</strong> {card.set?.name || texts.card.unavailable}
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
         {adding ? texts.card.adding : texts.card.add}
        </button>
)}

    </article>
  )
}

export default PokemonCard
