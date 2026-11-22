import { useEffect, useId, useState } from 'react'
import { getAlternateCardImage, getCardImageUrls } from '../services/cardService'

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function formatMarketPrice(value, locale) {
  if (!isValidPrice(value)) return null

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)
  } catch {
    return `US$${value.toFixed(2)}`
  }
}

function formatPricingDate(value, locale) {
  if (typeof value !== 'string') return null

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date)
}

function selectTcgplayerMarketPrice(tcgplayer) {
  if (!isRecord(tcgplayer)) return null

  const variants = Object.entries(tcgplayer)
    .filter(([, value]) =>
      isRecord(value) && isValidPrice(value.marketPrice)
    )
    .map(([variant, value]) => ({
      variant,
      value: value.marketPrice
    }))
  const normalPrice = variants.find((item) => item.variant === 'normal')

  return normalPrice ?? variants[0] ?? null
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
  const [showMarketPrice, setShowMarketPrice] = useState(false)
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
  const tcgplayerCurrency = typeof tcgplayer?.unit === 'string'
    ? tcgplayer.unit.trim().toUpperCase()
    : 'USD'
  const selectedMarketPrice = tcgplayerCurrency === 'USD'
    ? selectTcgplayerMarketPrice(tcgplayer)
    : null
  const formattedMarketPrice = selectedMarketPrice
    ? formatMarketPrice(selectedMarketPrice.value, texts.card.locale)
    : null
  const tcgplayerUpdated = formatPricingDate(
    tcgplayer?.updated,
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

        <button
          type="button"
          className="market-price-toggle"
          aria-expanded={showMarketPrice}
          aria-controls={`${detailsId}-market-price`}
          onClick={() => setShowMarketPrice((current) => !current)}
        >
          {showMarketPrice
            ? texts.card.hideMarketPrice
            : texts.card.consultMarketPrice}
        </button>

        <div
          id={`${detailsId}-market-price`}
          className="pokemon-card-pricing"
          hidden={!showMarketPrice}
        >
          <h4>{texts.card.marketPrices}</h4>

          {formattedMarketPrice ? (
            <p className="market-price-line">
              <strong className="market-price-amount">
                {formattedMarketPrice}
              </strong>
              <span aria-hidden="true">·</span>
              <span>{texts.card.priceVariant(selectedMarketPrice.variant)}</span>
            </p>
          ) : (
            <p className="market-price-unavailable">
              {texts.card.priceUnavailable}
            </p>
          )}

          {tcgplayerUpdated && (
            <p className="pricing-updated">
              {texts.card.lastUpdated}: {tcgplayerUpdated}
            </p>
          )}

          <p className="pricing-source-note">{texts.card.priceSource}</p>
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
