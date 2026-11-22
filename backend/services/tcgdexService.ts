
const API_URL = 'https://api.tcgdex.net/v2'
const CARDS_PER_PAGE = 12
const LAST_PAGE_CACHE_TTL_MS = 5 * 60 * 1000
const MAX_PAGE_PROBE = 131_072
const CARDCORPUS_URL = 'https://pokemon.cardcorpus.com/v1'
const CARDCORPUS_IMAGE_URL = 'https://img.cardcorpus.com/s1/480'
const EXTERNAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const FALLBACK_CACHE_TTL_MS = 30 * 60 * 1000
const CARD_DETAILS_CACHE_TTL_MS = 10 * 60 * 1000

type LastPageCacheEntry = {
  expiresAt: number
  request: Promise<number>
}

type CachedRequest = {
  expiresAt: number
  request: Promise<unknown>
}

type TcgCardForImage = {
  id: string
  name: string
  localId: string | number
  illustrator?: string
  image?: string
  set?: {
    id?: string
    name?: string
    cardCount?: {
      official?: number
      total?: number
    }
  }
}

type CardCorpusSet = {
  id: string
  name?: string
  englishName?: string
  code?: string
  printedCode?: string
  printedTotal?: number
  actualTotal?: number
  cardCount?: number
  released?: { date?: string }
}

type CardCorpusCard = {
  id: string
  name?: string
  englishName?: string
  credit?: string
  rarity?: string
  cardType?: string
  number?: {
    printed?: string
    short?: string
  }
  picture?: {
    front?: { image?: string }
  }
}

type CardCorpusSetIndex = {
  sets?: CardCorpusSet[]
}

type CardCorpusSetDetails = CardCorpusSet & {
  cards?: CardCorpusCard[]
}

type CardCorpusFallback = {
  image: string
  card: CardCorpusCard
  set: CardCorpusSet
}

export type FallbackCardImage = {
  image: string
  source: 'tcgdex' | 'cardcorpus'
}

const lastPageCache = new Map<string, LastPageCacheEntry>()
const externalJsonCache = new Map<string, CachedRequest>()
const fallbackImageCache = new Map<string, {
  expiresAt: number
  request: Promise<FallbackCardImage | null>
}>()
const cardDetailsCache = new Map<string, {
  expiresAt: number
  request: Promise<Record<string, unknown> | null>
}>()

function getSupportedLanguage(language: string) {
  return language === 'en' ? 'en' : 'es'
}

export async function getCardsFromTcgdex(
  search: string = '',
  page: number = 1,
  language: string = 'es',
  localId: string = '',
  exactLocalId: boolean = false,
  hp: string = ''
) {
  const supportedLanguage = getSupportedLanguage(language)
  const url = new URL(`${API_URL}/${supportedLanguage}/cards`)

  url.searchParams.set('pagination:page', String(page))
  url.searchParams.set(
    'pagination:itemsPerPage',
    String(exactLocalId ? 50 : CARDS_PER_PAGE)
  )

  if (search.trim()) {
    url.searchParams.set('name', `like:${search.trim()}`)
  }

  if (localId.trim()) {
    url.searchParams.set(
      'localId',
      exactLocalId ? `${localId.trim()}*` : `like:${localId.trim()}`
    )
  }

  if (hp.trim()) {
    url.searchParams.set('hp', `eq:${hp.trim()}`)
  }

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('Error al consultar TCGdex')
  }

  const cards = await response.json()

  if (!exactLocalId || !Array.isArray(cards)) return cards

  const expectedLocalId = localId.trim().toLocaleLowerCase()
  return cards.filter((card) =>
    String(card?.localId ?? '').toLocaleLowerCase() === expectedLocalId
  )
}

async function pageHasCards(
  search: string,
  page: number,
  language: string,
  localId: string
) {
  const cards = await getCardsFromTcgdex(
    search,
    page,
    language,
    localId
  )

  if (!Array.isArray(cards)) {
    throw new Error('Respuesta inválida de TCGdex')
  }

  return cards.length > 0
}

async function findLastCardsPage(
  search: string,
  language: string,
  localId: string
) {
  if (!await pageHasCards(search, 1, language, localId)) {
    return 0
  }

  let lastKnownPage = 1
  let firstEmptyPage = 2

  while (
    firstEmptyPage <= MAX_PAGE_PROBE &&
    await pageHasCards(search, firstEmptyPage, language, localId)
  ) {
    lastKnownPage = firstEmptyPage
    firstEmptyPage *= 2
  }

  if (firstEmptyPage > MAX_PAGE_PROBE) {
    throw new Error('No se pudo determinar la última página')
  }

  while (lastKnownPage + 1 < firstEmptyPage) {
    const middlePage = Math.floor(
      (lastKnownPage + firstEmptyPage) / 2
    )

    if (await pageHasCards(search, middlePage, language, localId)) {
      lastKnownPage = middlePage
    } else {
      firstEmptyPage = middlePage
    }
  }

  return lastKnownPage
}

export async function getLastCardsPageFromTcgdex(
  search: string = '',
  language: string = 'es',
  localId: string = ''
) {
  const supportedLanguage = getSupportedLanguage(language)
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const normalizedLocalId = localId.trim().toLocaleLowerCase()
  const cacheKey = [
    supportedLanguage,
    normalizedSearch,
    normalizedLocalId
  ].join(':')
  const cached = lastPageCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.request
  }

  const request = findLastCardsPage(
    search,
    supportedLanguage,
    localId
  )

  lastPageCache.set(cacheKey, {
    expiresAt: Date.now() + LAST_PAGE_CACHE_TTL_MS,
    request
  })

  try {
    return await request
  } catch (error) {
    if (lastPageCache.get(cacheKey)?.request === request) {
      lastPageCache.delete(cacheKey)
    }
    throw error
  }
}

export async function getCardFromTcgdex(
  cardId: string,
  language: string = 'es'
) {
  const supportedLanguage = getSupportedLanguage(language)
  const url = `${API_URL}/${supportedLanguage}/cards/${encodeURIComponent(cardId)}`

  const response = await fetch(url)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error('Error al consultar los detalles de la carta')
  }

  return response.json()
}

export async function getSetsFromTcgdex(
  language: string = 'es',
  search: string = ''
) {
  const supportedLanguage = getSupportedLanguage(language)
  const url = new URL(`${API_URL}/${supportedLanguage}/sets`)

  if (search.trim()) {
    url.searchParams.set('name', `like:${search.trim()}`)
  }

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('Error al consultar las expansiones de TCGdex')
  }

  return response.json()
}

export async function getSetFromTcgdex(
  setId: string,
  language: string = 'es'
) {
  const supportedLanguage = getSupportedLanguage(language)
  const url = `${API_URL}/${supportedLanguage}/sets/${encodeURIComponent(setId)}`
  const response = await fetch(url)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error('Error al consultar los detalles de la expansión')
  }

  return response.json()
}

function normalizeExternalValue(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeExternalNumber(value: unknown) {
  const normalized = String(value ?? '')
    .toLocaleUpperCase()
    .replace(/[^A-Z0-9]/g, '')

  return /^\d+$/.test(normalized)
    ? String(Number(normalized))
    : normalized
}

function getReleaseYear(value: unknown) {
  return String(value ?? '').match(/^\d{4}/)?.[0] ?? ''
}

async function getCachedExternalJson<T>(url: string) {
  const cached = externalJsonCache.get(url)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.request as Promise<T>
  }

  const request = fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error('Error al consultar el proveedor de imágenes')
    }

    return response.json()
  })

  externalJsonCache.set(url, {
    expiresAt: Date.now() + EXTERNAL_CACHE_TTL_MS,
    request
  })

  try {
    return await request as T
  } catch (error) {
    if (externalJsonCache.get(url)?.request === request) {
      externalJsonCache.delete(url)
    }
    throw error
  }
}

async function imageUrlWorks(url: string) {
  const response = await fetch(url)

  if (response.status === 429 || response.status === 503) {
    await response.body?.cancel()
    throw new Error('Proveedor de imágenes temporalmente no disponible')
  }

  const contentType = response.headers.get('content-type') ?? ''
  const works = response.ok && contentType.startsWith('image/')
  await response.body?.cancel()
  return works
}

async function getWorkingTcgdexImage(image: unknown) {
  if (typeof image !== 'string' || !image.trim()) return null

  const baseUrl = image.trim().replace(/\/+$/, '')

  for (const suffix of ['low.webp', 'low.png']) {
    if (await imageUrlWorks(`${baseUrl}/${suffix}`)) return baseUrl
  }

  return null
}

function scoreCardCorpusSet(
  set: CardCorpusSet,
  cards: TcgCardForImage[],
  releaseYears: Set<string>
) {
  const tcgSetNames = new Set(
    cards
      .map((card) => normalizeExternalValue(card.set?.name))
      .filter(Boolean)
  )
  const tcgSetIds = new Set(
    cards
      .map((card) => normalizeExternalValue(card.set?.id))
      .filter(Boolean)
  )
  const officialTotals = new Set(
    cards.flatMap((card) => [
      card.set?.cardCount?.official,
      card.set?.cardCount?.total
    ]).filter((total): total is number =>
      typeof total === 'number' && Number.isInteger(total) && total > 0
    )
  )
  const setNames = [set.name, set.englishName]
    .map(normalizeExternalValue)
    .filter(Boolean)
  const setCodes = [set.code, set.printedCode, set.id.split('/').at(-1)]
    .map(normalizeExternalValue)
    .filter(Boolean)
  const totals = [set.printedTotal, set.actualTotal, set.cardCount]
    .filter((total): total is number => Number.isInteger(total))
  let score = 0

  if (setNames.some((name) => tcgSetNames.has(name))) score += 130
  if (setCodes.some((code) => tcgSetIds.has(code))) score += 110
  if (totals.some((total) => officialTotals.has(total))) score += 90

  const releaseYear = getReleaseYear(set.released?.date)
  if (releaseYear && releaseYears.has(releaseYear)) score += 30

  return score
}

async function getTcgdexReleaseYears(cards: TcgCardForImage[]) {
  const setRequests = cards
    .filter((card) => card.set?.id)
    .map(async (card) => {
      const languages = ['es', 'en']
      const results = await Promise.allSettled(
        languages.map((language) =>
          getSetFromTcgdex(String(card.set?.id), language)
        )
      )

      return results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => getReleaseYear(result.value?.releaseDate))
        .filter(Boolean)
    })
  const years = await Promise.all(setRequests)

  return new Set(years.flat())
}

async function getCardCorpusFallback(
  cards: TcgCardForImage[],
  language: string
): Promise<CardCorpusFallback | null> {
  const releaseYears = await getTcgdexReleaseYears(cards)
  const catalogs = language === 'en'
    ? ['english', 'spanish']
    : ['spanish', 'english']
  const cardNames = new Set(
    cards.map((card) => normalizeExternalValue(card.name)).filter(Boolean)
  )
  const localIds = new Set(
    cards.map((card) => normalizeExternalNumber(card.localId)).filter(Boolean)
  )
  const illustrators = new Set(
    cards
      .map((card) => normalizeExternalValue(card.illustrator))
      .filter(Boolean)
  )

  for (const catalog of catalogs) {
    const index = await getCachedExternalJson<CardCorpusSetIndex>(
      `${CARDCORPUS_URL}/sets/${catalog}.json`
    )
    const rankedSets = (Array.isArray(index.sets) ? index.sets : [])
      .map((set) => ({
        set,
        score: scoreCardCorpusSet(set, cards, releaseYears)
      }))
      .filter((item) => item.score >= 130)
      .sort((first, second) => second.score - first.score)

    if (
      rankedSets.length === 0 ||
      (
        rankedSets.length > 1 &&
        rankedSets[0].score === rankedSets[1].score
      )
    ) {
      continue
    }

    const selectedSet = rankedSets[0].set
    const details = await getCachedExternalJson<CardCorpusSetDetails>(
      `${CARDCORPUS_URL}/sets/${selectedSet.id}.json`
    )
    const matchingCards = (Array.isArray(details.cards) ? details.cards : [])
      .filter((card) => {
        const number = normalizeExternalNumber(
          card.number?.short ?? card.id
        )
        const names = [card.name, card.englishName]
          .map(normalizeExternalValue)
          .filter(Boolean)
        const illustrator = normalizeExternalValue(card.credit)

        return localIds.has(number) &&
          names.some((name) => cardNames.has(name)) &&
          (
            !illustrator ||
            illustrators.size === 0 ||
            illustrators.has(illustrator)
          )
      })

    if (matchingCards.length !== 1) continue

    const matchedCard = matchingCards[0]
    const imageId = matchedCard.picture?.front?.image
    if (typeof imageId !== 'string' || !imageId.trim()) continue

    const imageUrl = `${CARDCORPUS_IMAGE_URL}/${imageId.trim()}.avif`
    if (await imageUrlWorks(imageUrl)) {
      return {
        image: imageUrl,
        card: matchedCard,
        set: selectedSet
      }
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasValue(value: unknown) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return Boolean(value.trim())
  if (Array.isArray(value)) return value.length > 0
  return true
}

function complementMissingValues(
  primary: unknown,
  fallback: unknown
): unknown {
  if (!hasValue(primary)) return fallback

  if (isRecord(primary) && isRecord(fallback)) {
    const result: Record<string, unknown> = { ...primary }

    for (const [key, value] of Object.entries(fallback)) {
      result[key] = complementMissingValues(result[key], value)
    }

    return result
  }

  return primary
}

function needsCardComplement(card: Record<string, unknown>) {
  const set = isRecord(card.set) ? card.set : null
  const types = Array.isArray(card.types) ? card.types : []

  return !hasValue(card.name) ||
    !hasValue(card.localId) ||
    (!hasValue(card.category) && types.length === 0) ||
    !hasValue(card.rarity) ||
    !hasValue(set?.name) ||
    !hasValue(card.image)
}

function getCardCorpusCategory(cardType: unknown) {
  const normalized = String(cardType ?? '').trim().toLocaleLowerCase()

  return {
    pokemon: 'Pokemon',
    trainer: 'Trainer',
    energy: 'Energy'
  }[normalized] ?? String(cardType ?? '').trim()
}

function mapCardCorpusDetails(
  cardId: string,
  fallback: CardCorpusFallback
) {
  const officialTotal = fallback.set.printedTotal
  const total = fallback.set.actualTotal ?? fallback.set.cardCount

  return {
    id: cardId,
    name: fallback.card.name ?? fallback.card.englishName,
    localId: fallback.card.number?.short ?? fallback.card.id,
    category: getCardCorpusCategory(fallback.card.cardType),
    rarity: fallback.card.rarity,
    illustrator: fallback.card.credit,
    image: fallback.image,
    set: {
      name: fallback.set.name ?? fallback.set.englishName,
      cardCount: {
        official: officialTotal,
        total
      }
    }
  }
}

async function findComplementedCardDetails(
  cardId: string,
  language: string
): Promise<Record<string, unknown> | null> {
  const currentLanguage = getSupportedLanguage(language)
  const alternateLanguage = currentLanguage === 'es' ? 'en' : 'es'
  let currentCard: Record<string, unknown> | null = null
  let alternateCard: Record<string, unknown> | null = null
  let currentError: unknown = null
  let alternateError: unknown = null

  try {
    currentCard = await getCardFromTcgdex(cardId, currentLanguage)
  } catch (error) {
    currentError = error
  }

  if (!currentCard || needsCardComplement(currentCard)) {
    try {
      alternateCard = await getCardFromTcgdex(cardId, alternateLanguage)
    } catch (error) {
      alternateError = error
    }
  }

  if (!currentCard && !alternateCard) {
    if (currentError || alternateError) {
      throw currentError ?? alternateError
    }

    return null
  }

  let details = complementMissingValues(
    currentCard,
    alternateCard
  ) as Record<string, unknown>

  if (needsCardComplement(details)) {
    const matchingCards = [currentCard, alternateCard]
      .filter((card): card is Record<string, unknown> => Boolean(card))
      .map((card) => card as TcgCardForImage)

    try {
      const externalFallback = await getCardCorpusFallback(
        matchingCards,
        currentLanguage
      )

      if (externalFallback) {
        details = complementMissingValues(
          details,
          mapCardCorpusDetails(cardId, externalFallback)
        ) as Record<string, unknown>
      }
    } catch {
      // Los datos válidos de TCGdex siguen siendo utilizables si falla el respaldo.
    }
  }

  return details
}

export async function getComplementedCardFromProviders(
  cardId: string,
  language: string = 'es'
) {
  const supportedLanguage = getSupportedLanguage(language)
  const cacheKey = `${supportedLanguage}:${cardId}`
  const cached = cardDetailsCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) return cached.request

  const request = findComplementedCardDetails(cardId, supportedLanguage)
  cardDetailsCache.set(cacheKey, {
    expiresAt: Date.now() + CARD_DETAILS_CACHE_TTL_MS,
    request
  })

  try {
    return await request
  } catch (error) {
    if (cardDetailsCache.get(cacheKey)?.request === request) {
      cardDetailsCache.delete(cacheKey)
    }
    throw error
  }
}

async function findFallbackCardImage(
  cardId: string,
  language: string
): Promise<FallbackCardImage | null> {
  const currentLanguage = getSupportedLanguage(language)
  const alternateLanguage = currentLanguage === 'es' ? 'en' : 'es'
  const results = await Promise.allSettled([
    getCardFromTcgdex(cardId, currentLanguage),
    getCardFromTcgdex(cardId, alternateLanguage)
  ])
  const currentCard = results[0].status === 'fulfilled'
    ? results[0].value as TcgCardForImage | null
    : null
  const alternateCard = results[1].status === 'fulfilled'
    ? results[1].value as TcgCardForImage | null
    : null

  if (!currentCard && !alternateCard) {
    throw new Error('No se pudieron obtener los datos de la carta')
  }

  let temporaryImageError: unknown = null
  let alternateImage: string | null = null

  try {
    alternateImage = await getWorkingTcgdexImage(alternateCard?.image)
  } catch (error) {
    temporaryImageError = error
  }

  if (alternateImage) {
    return { image: alternateImage, source: 'tcgdex' }
  }

  const cards = [currentCard, alternateCard]
    .filter((card): card is TcgCardForImage => Boolean(card))
  const externalFallback = await getCardCorpusFallback(cards, currentLanguage)

  if (externalFallback) {
    return { image: externalFallback.image, source: 'cardcorpus' }
  }

  if (temporaryImageError) throw temporaryImageError
  return null
}

export async function getFallbackCardImage(
  cardId: string,
  language: string = 'es'
) {
  const supportedLanguage = getSupportedLanguage(language)
  const cacheKey = `${supportedLanguage}:${cardId}`
  const cached = fallbackImageCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) return cached.request

  const request = findFallbackCardImage(cardId, supportedLanguage)
  fallbackImageCache.set(cacheKey, {
    expiresAt: Date.now() + FALLBACK_CACHE_TTL_MS,
    request
  })

  try {
    return await request
  } catch (error) {
    if (fallbackImageCache.get(cacheKey)?.request === request) {
      fallbackImageCache.delete(cacheKey)
    }
    throw error
  }
}

