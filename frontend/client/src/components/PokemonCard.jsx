import { useEffect, useId, useState } from 'react'
import { getAlternateCardImage, getCardImageUrls } from '../services/cardService'

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function formatMarketPrice(value, currency, locale) {
  if (!isValidPrice(value)) return null

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

function formatPricingDate(value, locale) {
  if (typeof value !== 'string') return null

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium'
  }).format(date)
}

function createImageState(image, source = 'original', key = '') {
  const urls = getCardImageUrls(image)

  return {
    key,
    urls,
    index: 0,
    source,
    loading: false,
    unavailable: urls.length === 0
  }
}

function PokemonCard({ card, onAdd, adding = false, texts, language = 'es' }) {
  const [showDetails, setShowDetails] = useState(false)
  const imageKey = `${language}:${card.id}:${card.image ?? ''}`
  const [imageState, setImageState] = useState(() =>
    createImageState(card.image, 'original', imageKey)
  )
  const detailsId = useId()

  // Algunas cartas tienen varios tipos y otras no tienen ninguno
  const types = Array.isArray(card.types)
    ? card.types
    : []

  // Usamos los tipos del Pokémon o su categoría (Pokémon, Entrenador o Energía).
  const cardType = types.length > 0
    ? types.join(', ')
    : card.category

  const activeImageState = imageState.key === imageKey
    ? imageState
    : createImageState(card.image, 'original', imageKey)

  useEffect(() => {
    if (getCardImageUrls(card.image).length > 0) return

    let cancelled = false

    async function loadMissingImage() {
      try {
        const alternateImage = await getAlternateCardImage(card.id, language)

        if (cancelled) return

        setImageState(
          createImageState(alternateImage, 'alternate', imageKey)
        )
      } catch {
        if (cancelled) return

        setImageState({
          key: imageKey,
          urls: [],
          index: 0,
          source: 'alternate',
          loading: false,
          unavailable: true
        })
      }
    }

    void loadMissingImage()

    return () => {
      cancelled = true
    }
  }, [card.id, card.image, imageKey, language])

  async function loadAlternateImage() {
    const requestedKey = imageKey
    setImageState({
      key: requestedKey,
      urls: [],
      index: 0,
      source: 'alternate-loading',
      loading: true,
      unavailable: false
    })

    try {
      const alternateImage = await getAlternateCardImage(card.id, language)
      setImageState(
        createImageState(alternateImage, 'alternate', requestedKey)
      )
    } catch {
      setImageState({
        key: requestedKey,
        urls: [],
        index: 0,
        source: 'alternate',
        loading: false,
        unavailable: true
      })
    }
  }

  function handleImageError() {
    const nextIndex = activeImageState.index + 1

    if (nextIndex < activeImageState.urls.length) {
      setImageState({
        ...activeImageState,
        index: nextIndex
      })
      return
    }

    if (activeImageState.source === 'original') {
      void loadAlternateImage()
      return
    }

    setImageState({
      ...activeImageState,
      loading: false,
      unavailable: true
    })
  }

  const imageUrl = activeImageState.unavailable
    ? null
    : activeImageState.urls[activeImageState.index] ?? null
  const pricing = isRecord(card.pricing) ? card.pricing : {}
  const tcgplayer = isRecord(pricing.tcgplayer)
    ? pricing.tcgplayer
    : null
  const cardmarket = isRecord(pricing.cardmarket)
    ? pricing.cardmarket
    : null
  const tcgplayerCurrency = typeof tcgplayer?.unit === 'string'
    ? tcgplayer.unit
    : texts.card.tcgplayerCurrency
  const cardmarketCurrency = typeof cardmarket?.unit === 'string'
    ? cardmarket.unit
    : texts.card.cardmarketCurrency
  const tcgplayerPrices = tcgplayer
    ? Object.entries(tcgplayer)
        .filter(([, value]) =>
          isRecord(value) && isValidPrice(value.marketPrice)
        )
        .map(([variant, value]) => ({
          variant,
          price: formatMarketPrice(
            value.marketPrice,
            tcgplayerCurrency,
            texts.card.locale
          )
        }))
    : []
  const cardmarketPrices = cardmarket
    ? [
        {
          key: 'trend',
          label: texts.card.trendPrice,
          value: cardmarket.trend
        },
        {
          key: 'avg',
          label: texts.card.averagePrice,
          value: cardmarket.avg
        },
        {
          key: 'trend-holo',
          label: `${texts.card.holoVariant} — ${texts.card.trendPrice}`,
          value: cardmarket['trend-holo']
        },
        {
          key: 'avg-holo',
          label: `${texts.card.holoVariant} — ${texts.card.averagePrice}`,
          value: cardmarket['avg-holo']
        }
      ]
        .filter((item) => isValidPrice(item.value))
        .map((item) => ({
          ...item,
          price: formatMarketPrice(
            item.value,
            cardmarketCurrency,
            texts.card.locale
          )
        }))
    : []
  const tcgplayerUpdated = formatPricingDate(
    tcgplayer?.updated,
    texts.card.locale
  )
  const cardmarketUpdated = formatPricingDate(
    cardmarket?.updated,
    texts.card.locale
  )

  return (
    <article className="pokemon-card">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={texts.card.imageAlt(card.name)}
          className="pokemon-card-image"
          loading="lazy"
          onError={handleImageError}
        />
      ) : (
        <div className="pokemon-placeholder">
          {texts.card.noImage}
        </div>
      )}

      <h3>{card.name}</h3>

      <button
        type="button"
        className="card-details-toggle"
        aria-expanded={showDetails}
        aria-controls={detailsId}
        onClick={() => setShowDetails((current) => !current)}
      >
        {showDetails ? texts.card.hideInformation : texts.card.showInformation}
      </button>

      <div
        id={detailsId}
        className="pokemon-card-details"
        hidden={!showDetails}
      >
        <div className="pokemon-card-attributes">
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

        <div className="pokemon-card-pricing">
          <h4>{texts.card.marketPrices}</h4>

          <section className="pricing-source">
            <h5>TCGplayer — {tcgplayerCurrency}</h5>
            {tcgplayerPrices.length === 0 ? (
              <p>{texts.card.priceUnavailable}</p>
            ) : (
              <dl>
                {tcgplayerPrices.map((item) => (
                  <div key={item.variant}>
                    <dt>
                      {texts.card.priceVariant(item.variant)} — {texts.card.marketPrice}
                    </dt>
                    <dd>{item.price}</dd>
                  </div>
                ))}
              </dl>
            )}
            {tcgplayerUpdated && (
              <p className="pricing-updated">
                {texts.card.lastUpdated}: {tcgplayerUpdated}
              </p>
            )}
          </section>

          <section className="pricing-source">
            <h5>Cardmarket — {cardmarketCurrency}</h5>
            {cardmarketPrices.length === 0 ? (
              <p>{texts.card.priceUnavailable}</p>
            ) : (
              <dl>
                {cardmarketPrices.map((item) => (
                  <div key={item.key}>
                    <dt>{item.label}</dt>
                    <dd>{item.price}</dd>
                  </div>
                ))}
              </dl>
            )}
            {cardmarketUpdated && (
              <p className="pricing-updated">
                {texts.card.lastUpdated}: {cardmarketUpdated}
              </p>
            )}
          </section>

          <p className="pricing-notice">{texts.card.indicativePrices}</p>
        </div>
      </div>

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
