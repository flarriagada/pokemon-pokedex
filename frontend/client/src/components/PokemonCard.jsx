import { useState } from 'react'

function PokemonCard({ card, onAdd, adding = false }) {
  const [imageError, setImageError] = useState(false)

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
