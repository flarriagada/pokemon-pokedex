import { useState } from 'react'

function PokemonCard({ card }) {
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
    </article>
  )
}

export default PokemonCard
