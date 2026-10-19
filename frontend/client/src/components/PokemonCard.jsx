
function PokemonCard({ name, type, icon }) {
  return (
    <article className="pokemon-card">
      <div className="pokemon-icon">
        {icon}
      </div>

      <h3>{name}</h3>
      <p>Tipo: {type}</p>
    </article>
  )
}

export default PokemonCard
