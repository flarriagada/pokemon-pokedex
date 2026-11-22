import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getCollectionPage, getCollectionSummary, addCardToCollection, updateCollectionQuantity, updateCardTradeStatus, deleteCollectionCard, getTransactions, createTransaction, getTags, createTag, deleteTag, assignTagToCard, removeTagFromCard } from '../services/collectionService'
import {
  getAlternateCardImage,
  getCards,
  getCardById,
  getCardImageUrls,
  getSets,
  getSetById
} from '../services/cardService'
import PokemonCard from '../components/PokemonCard'
import '../components/Catalog.css'

const PHOTO_MAX_BYTES = 8 * 1024 * 1024
const PHOTO_MAX_DIMENSION = 6000
const PHOTO_MAX_PIXELS = 20_000_000
const PHOTO_MIN_CARD_WIDTH = 150
const PHOTO_MIN_CARD_HEIGHT = 205
const VISUAL_MATCH_CONCURRENCY = 4
const COLLECTION_DETAILS_CONCURRENCY = 4
const ALL_MISSING_PAGE_SIZE = 18
const ALL_MISSING_MAX_SCAN_ROUNDS = 10
const TAG_EMOJIS = ['❤️', '⭐', '💰', '🃏', '🔥', '⚡', '💧', '🌿', '💎', '🏆']
const PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
])
const OCR_NAME_NOISE = new Set([
  'basic',
  'basico',
  'fase',
  'go',
  'pokemon',
  'promo',
  'stage',
  'tcg'
])
const visualFingerprintCache = new Map()

function normalizeMatchValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function cleanOcrLine(value) {
  return value
    .replace(/[|]/g, 'I')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanDetectedCardName(value) {
  return cleanOcrLine(String(value ?? ''))
    .replace(
      /^(?:(?:basic|básico|stage|fase)s*(?:\d+)?\s+(?:pokémon\s+)?|pokémon\s+(?:basic|básico)\s+)/i,
      ''
    )
    .replace(
      /\s+(?:\d{1,3}\s*(?:HP|PS|PV)|(?:HP|PS|PV)\s*\d{1,3})\b.*$/i,
      ''
    )
    .replace(/^(?:es|is)\s+(?=[A-ZÁÉÍÓÚÑ])/u, '')
    .replace(/^[^\p{L}\d]+|[^\p{L}\d'’&:.-]+$/gu, '')
    .trim()
}

function removeOcrNameNoise(value) {
  return String(value ?? '')
    .split(/\s+/)
    .filter((token) => !OCR_NAME_NOISE.has(normalizeMatchValue(token)))
    .join(' ')
    .trim()
}

function isUsableDetectedName(value) {
  const cleaned = removeOcrNameNoise(value)
  const normalized = normalizeMatchValue(cleaned)
  const letters = cleaned.match(/\p{L}/gu) ?? []

  return letters.length >= 3 &&
    !OCR_NAME_NOISE.has(normalized) &&
    !/^(?:hp|ps|pv)$/i.test(cleaned)
}

function getDetectedNameVariations(value) {
  const cleaned = removeOcrNameNoise(cleanDetectedCardName(value))
  if (!isUsableDetectedName(cleaned)) return []

  const withoutOcrPrefix = cleaned.replace(
    /^(?:[a-z]{1,2}[.\s]+){1,2}(?=\p{Lu})/u,
    ''
  )
  const joinedNames = withoutOcrPrefix.match(
    /^([\p{L}\d.'’:-]+(?:\s+[\p{L}\d.'’:-]+){0,2}\s*(?:&|and|y)\s*[\p{L}\d.'’:-]+)/iu
  )?.[1]
  const throughVariant = withoutOcrPrefix.match(
    /^(.+?\b(?:VSTAR|VMAX|V-UNION|GX|EX|V)\b)/i
  )?.[1]
  const withoutTrailingStats = withoutOcrPrefix.replace(
    /\s+(?:[A-Z]{2,5}\s+)?(?:HP|PS|PV|[uo0]{1,2})?\s*\d{1,3}\s*$/i,
    ''
  )

  return [...new Set([
    cleaned,
    withoutOcrPrefix,
    joinedNames,
    throughVariant,
    withoutTrailingStats
  ].filter((name) => name && isUsableDetectedName(name)))]
}

function normalizeCollectionToken(value) {
  let token = String(value ?? '')
    .toLocaleUpperCase()
    .replace(/[^A-Z0-9]/g, '')

  if (!/\d/.test(token)) return ''

  if (/^[0-9OIL]+$/.test(token)) {
    token = token
      .replaceAll('O', '0')
      .replace(/[IL]/g, '1')
  }

  return token
}

function normalizeCollectionComparison(value) {
  const token = normalizeCollectionToken(value)

  if (/^\d+$/.test(token)) {
    return String(Number(token))
  }

  return token
}

function extractCollectionNumber(lines) {
  const linesFromBottom = [...lines].reverse()

  for (const line of linesFromBottom) {
    if (/\b(?:HP|PS)\b/i.test(line)) continue

    const match = line.match(
      /(?:#\s*)?\b([a-z0-9]{1,10})\s*\/\s*([a-z0-9]{1,10})\b/i
    )
    const number = normalizeCollectionToken(match?.[1])
    const total = normalizeCollectionToken(match?.[2])

    if (number && total) return { number, total }
  }

  const labeledPattern = /(?:#|N[.º°O]?)\s*([a-z0-9]{1,10})\b/i
  for (const line of linesFromBottom) {
    if (/\b(?:HP|PS)\b/i.test(line)) continue

    const number = normalizeCollectionToken(line.match(labeledPattern)?.[1])
    if (number) return { number, total: '' }
  }

  const prefixedPattern = /\b((?:TG|GG|SVP|SWSH|SM|XY|RC|PR|DP|BW)\d{1,4}[a-z]?)\b/i
  for (const line of linesFromBottom) {
    const number = normalizeCollectionToken(
      line.match(prefixedPattern)?.[1]
    )
    if (number) return { number, total: '' }
  }

  return { number: '', total: '' }
}

function extractSpecializedCollectionNumber(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map(cleanOcrLine)
    .filter(Boolean)
  const standardResult = extractCollectionNumber(lines)

  if (standardResult.number && standardResult.total) {
    return standardResult
  }

  for (const line of lines) {
    const match = line.match(
      /\b([a-z0-9]{1,10})\s*[\\|:;]\s*([a-z0-9]{2,10})\b/i
    )
    const number = normalizeCollectionToken(match?.[1])
    const total = normalizeCollectionToken(match?.[2])

    if (number && total) return { number, total }
  }

  return standardResult
}

function selectBestCollectionNumber(values) {
  return values
    .filter((value) => value.number)
    .sort((first, second) => {
      const score = (value) =>
        (value.total ? 100 : 0) +
        (/[A-Z]/i.test(value.number) ? 30 : 0) +
        Math.min(value.number.length, 10)

      return score(second) - score(first)
    })[0] ?? { number: '', total: '' }
}

function extractTopCardNames(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .flatMap((line) => getDetectedNameVariations(line))
    .filter((line) => {
      const letters = line.match(/\p{L}/gu) ?? []

      return line.length >= 2 &&
        line.length <= 50 &&
        letters.length >= 2 &&
        isUsableDetectedName(line) &&
        !isMetadataLine(line) &&
        !line.includes('/') &&
        !/^\d+$/u.test(line)
    })
}

function getCollectionNumberQuery(value) {
  const cleaned = cleanOcrLine(String(value ?? ''))
  const extracted = extractCollectionNumber([cleaned])

  return extracted.number || normalizeCollectionToken(cleaned)
}

function isMetadataLine(line) {
  return /^(?:basic|básico|stage|fase|evolves from|evoluciona de|trainer|entrenador|energy|energía|ability|habilidad|weakness|debilidad|resistance|resistencia|retreat|retirada|illustrator|ilustrador|illus\.?|rule|regla)\b/i.test(line) ||
    /(?:©|nintendo|creatures|game freak)/i.test(line)
}

function extractOcrFields(text) {
  const lines = text
    .split(/\r?\n/)
    .map(cleanOcrLine)
    .filter(Boolean)
  const collectionNumber = extractCollectionNumber(lines)
  const hp = lines
    .map((line) => {
      const match = line.match(
        /\b(?:HP|PS)\s*[:.]?\s*(\d{2,3})\b|\b(\d{2,3})\s*(?:HP|PS)\b/i
      )
      const value = Number(match?.[1] ?? match?.[2])

      return Number.isInteger(value) && value >= 10 && value <= 999
        ? String(value)
        : ''
    })
    .find(Boolean) ?? ''
  const nameCandidates = lines
    .slice(0, 15)
    .map((line, index) => {
      const hasHp = /\b(?:\d{1,3}\s*(?:HP|PS)|(?:HP|PS)\s*\d{1,3})\b/i.test(line)
      const cleaned = removeOcrNameNoise(cleanDetectedCardName(line))
      const letters = (cleaned.match(/\p{L}/gu) ?? []).length
      const valid = cleaned.length >= 2 &&
        cleaned.length <= 50 &&
        letters >= 2 &&
        isUsableDetectedName(cleaned) &&
        !isMetadataLine(cleaned) &&
        !/^[\d\W_]+$/u.test(cleaned) &&
        !cleaned.includes('/')

      return {
        value: cleaned,
        score: valid ? 100 - index * 3 + (hasHp ? 30 : 0) : -1
      }
    })
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score)
  const name = nameCandidates[0]?.value ?? ''
  const explicitExpansion = lines
    .map((line) =>
      line.match(/^(?:set|expansion|expansión)\s*[:-]\s*(.+)$/i)?.[1] ?? ''
    )
    .find(Boolean)
  const illustrator = lines
    .map((line) =>
      line.match(
        /(?:illus(?:trator)?\.?|illustrator|ilustrador)\s*[:.]?\s*([\p{L}][\p{L}\s.'’-]{1,50})/iu
      )?.[1]?.trim() ?? ''
    )
    .find(Boolean) ?? ''

  return {
    name,
    number: collectionNumber.number,
    total: collectionNumber.total,
    hp,
    expansion: explicitExpansion ?? '',
    illustrator
  }
}

function extractSpecializedHp(text) {
  const standardHp = extractOcrFields(text).hp

  if (standardHp) return standardHp

  const value = Number(String(text ?? '').match(/\b([1-9]\d{1,2})\b/)?.[1])
  return Number.isInteger(value) && value >= 10 && value <= 999
    ? String(value)
    : ''
}

function scoreDetectedName(value) {
  const name = String(value ?? '').trim()
  if (!isUsableDetectedName(name)) return -100

  const letters = name.match(/\p{L}/gu) ?? []
  const tokens = name.split(/\s+/).filter(Boolean)
  const shortUppercaseTokens = tokens.filter((token) =>
    token.length <= 3 && /^[A-Z]+$/.test(token)
  ).length

  return letters.length * 2 +
    (tokens.length === 1 && letters.length >= 3 ? 12 : 0) -
    shortUppercaseTokens * 6 -
    (name.match(/\d/g) ?? []).length * 5
}

function selectBestDetectedName(values) {
  return values
    .filter(Boolean)
    .sort((first, second) =>
      scoreDetectedName(second) - scoreDetectedName(first)
    )[0] ?? ''
}

function getPhotoNameQueries(value) {
  const name = cleanDetectedCardName(value)
  const words = name.match(/[\p{L}'’-]+/gu) ?? []
  const usefulWords = words.filter((word) =>
    word.length >= 4 && !/^(?:basic|basico|stage|fase|pokemon)$/i.test(word)
  )
  const longestWord = [...usefulWords].sort(
    (first, second) => second.length - first.length
  )[0] ?? ''
  const joinedName = usefulWords.length >= 2
    ? `${usefulWords[0]} ${usefulWords[1]}`
    : ''
  const queries = [name, joinedName, ...usefulWords]

  if (longestWord.length >= 4) queries.push(longestWord)
  if (longestWord.length >= 5) queries.push(longestWord.slice(0, 4))

  return [...new Set(queries.filter((query) => query.length >= 2))]
}

function getPhotoNameAlternatives(fields) {
  return [...new Set([
    fields.name,
    ...(Array.isArray(fields.nameAlternatives) ? fields.nameAlternatives : [])
  ].flatMap((name) => getDetectedNameVariations(name)))]
}

function getBestPhotoFieldsForCard(card, fields) {
  const alternatives = getPhotoNameAlternatives(fields)
  if (alternatives.length === 0) return fields

  return alternatives
    .map((name) => ({ ...fields, name }))
    .sort(
      (first, second) =>
        scorePhotoCandidate(card, second) - scorePhotoCandidate(card, first)
    )[0]
}

function scorePhotoCandidate(card, fields) {
  const detectedName = normalizeMatchValue(fields.name)
  const candidateName = normalizeMatchValue(card.name)
  const detectedNumber = normalizeMatchValue(fields.number).replace(/\s/g, '')
  const candidateNumber = normalizeMatchValue(card.localId).replace(/\s/g, '')
  const detectedTotal = normalizeCollectionComparison(fields.total)
  const candidateTotal = normalizeCollectionComparison(
    card.set?.cardCount?.official
  )
  const detectedHp = fields.hp ? Number(fields.hp) : Number.NaN
  const candidateHp = Number(card.hp)
  const detectedExpansion = normalizeMatchValue(fields.expansion)
  const candidateExpansion = normalizeMatchValue(card.set?.name)
  const detectedIllustrator = normalizeMatchValue(fields.illustrator)
  const candidateIllustrator = normalizeMatchValue(card.illustrator)
  let score = 0

  if (detectedName && candidateName) {
    if (detectedName === candidateName) score += 160
    else if (
      candidateName.includes(detectedName) ||
      detectedName.includes(candidateName)
    ) score += 70
    else {
      const detectedTokens = new Set(detectedName.split(' '))
      const sharedTokens = candidateName
        .split(' ')
        .filter((token) => detectedTokens.has(token))
        .length

      score += sharedTokens * 15
      if (sharedTokens === 0) score -= 120
    }
  }

  if (detectedNumber && candidateNumber) {
    if (
      normalizeCollectionComparison(detectedNumber) ===
      normalizeCollectionComparison(candidateNumber)
    ) score += 320
    else score -= 240
  }

  if (detectedTotal && candidateTotal) {
    if (detectedTotal === candidateTotal) score += 260
    else score -= 180
  }

  if (Number.isInteger(detectedHp) && Number.isInteger(candidateHp)) {
    if (detectedHp === candidateHp) score += 120
    else score -= 70
  }

  if (detectedExpansion && candidateExpansion) {
    if (detectedExpansion === candidateExpansion) score += 180
    else if (
      candidateExpansion.includes(detectedExpansion) ||
      detectedExpansion.includes(candidateExpansion)
    ) score += 100
    else score -= 90
  }

  if (detectedIllustrator && candidateIllustrator) {
    if (detectedIllustrator === candidateIllustrator) score += 70
    else if (
      candidateIllustrator.includes(detectedIllustrator) ||
      detectedIllustrator.includes(candidateIllustrator)
    ) score += 35
  }

  return score
}

function getPhotoCandidateEvidence(card, fields, visualSimilarity = 0) {
  const detectedName = normalizeMatchValue(fields.name)
  const candidateName = normalizeMatchValue(card.name)
  const detectedNumber = normalizeCollectionComparison(fields.number)
  const candidateNumber = normalizeCollectionComparison(card.localId)
  const detectedTotal = normalizeCollectionComparison(fields.total)
  const candidateTotal = normalizeCollectionComparison(
    card.set?.cardCount?.official
  )
  const detectedHp = fields.hp ? Number(fields.hp) : Number.NaN
  const candidateHp = Number(card.hp)
  const nameExact = Boolean(
    detectedName && candidateName && detectedName === candidateName
  )
  const namePartial = Boolean(
    detectedName &&
    candidateName &&
    (
      candidateName.includes(detectedName) ||
      detectedName.includes(candidateName)
    )
  )
  const numberExact = Boolean(
    detectedNumber &&
    candidateNumber &&
    detectedNumber === candidateNumber
  )
  const totalExact = Boolean(
    detectedTotal && candidateTotal && detectedTotal === candidateTotal
  )
  const hpExact = Number.isInteger(detectedHp) &&
    Number.isInteger(candidateHp) &&
    detectedHp === candidateHp
  const nameMatches = nameExact || namePartial
  const visualStrong = visualSimilarity >= 0.72
  const visualUseful = visualSimilarity >= 0.58
  const reliable = (nameMatches && numberExact) ||
    (numberExact && totalExact) ||
    (nameExact && hpExact) ||
    (visualStrong && (nameMatches || numberExact))
  const plausible = nameMatches || numberExact || visualUseful
  const visualScore = visualUseful
    ? Math.round((visualSimilarity - 0.4) * 500)
    : 0

  return {
    score: scorePhotoCandidate(card, fields) + visualScore,
    nameExact,
    nameMatches,
    numberExact,
    totalExact,
    hpExact,
    visualSimilarity,
    visualStrong,
    reliable,
    plausible
  }
}

function findStrongestEdge(scores, start, end) {
  let bestIndex = start
  let bestScore = -1

  for (let index = start; index <= end; index += 1) {
    if (scores[index] > bestScore) {
      bestIndex = index
      bestScore = scores[index]
    }
  }

  return { index: bestIndex, score: bestScore }
}

function getCenteredCardBounds(image) {
  const cardRatio = 245 / 337
  let height = image.height * 0.8
  let width = height * cardRatio

  if (width > image.width * 0.9) {
    width = image.width * 0.9
    height = width / cardRatio
  }

  return {
    x: (image.width - width) / 2,
    y: (image.height - height) / 2,
    width,
    height
  }
}

function detectLikelyCardBounds(image) {
  const maxAnalysisSize = 520
  const analysisScale = Math.min(
    1,
    maxAnalysisSize / Math.max(image.width, image.height)
  )
  const width = Math.max(2, Math.round(image.width * analysisScale))
  const height = Math.max(2, Math.round(image.height * analysisScale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) {
    return getCenteredCardBounds(image)
  }

  context.drawImage(image, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const verticalScores = new Float64Array(width)
  const horizontalScores = new Float64Array(height)
  const luminanceAt = (x, y) => {
    const offset = (y * width + x) * 4
    return pixels[offset] * 0.299 +
      pixels[offset + 1] * 0.587 +
      pixels[offset + 2] * 0.114
  }

  for (let x = 1; x < width; x += 1) {
    for (let y = 0; y < height; y += 2) {
      verticalScores[x] += Math.abs(
        luminanceAt(x, y) - luminanceAt(x - 1, y)
      )
    }
  }

  for (let y = 1; y < height; y += 1) {
    for (let x = 0; x < width; x += 2) {
      horizontalScores[y] += Math.abs(
        luminanceAt(x, y) - luminanceAt(x, y - 1)
      )
    }
  }

  const left = findStrongestEdge(
    verticalScores,
    Math.floor(width * 0.03),
    Math.floor(width * 0.42)
  )
  const right = findStrongestEdge(
    verticalScores,
    Math.ceil(width * 0.58),
    Math.floor(width * 0.97)
  )
  const top = findStrongestEdge(
    horizontalScores,
    Math.floor(height * 0.03),
    Math.floor(height * 0.35)
  )
  const bottom = findStrongestEdge(
    horizontalScores,
    Math.ceil(height * 0.65),
    Math.floor(height * 0.97)
  )
  const detectedWidth = right.index - left.index
  const detectedHeight = bottom.index - top.index
  const detectedRatio = detectedWidth / detectedHeight
  const horizontalMean = verticalScores.reduce((sum, value) => sum + value, 0) /
    verticalScores.length
  const verticalMean = horizontalScores.reduce((sum, value) => sum + value, 0) /
    horizontalScores.length
  const centered = Math.abs((left.index + right.index) / 2 - width / 2) <
      width * 0.2 &&
    Math.abs((top.index + bottom.index) / 2 - height / 2) < height * 0.2
  const confidentEdges = left.score > horizontalMean * 1.1 &&
    right.score > horizontalMean * 1.1 &&
    top.score > verticalMean * 1.1 &&
    bottom.score > verticalMean * 1.1
  const plausibleCard = detectedWidth >= width * 0.45 &&
    detectedHeight >= height * 0.6 &&
    detectedRatio >= 0.62 &&
    detectedRatio <= 0.82 &&
    centered &&
    confidentEdges

  if (!plausibleCard) {
    return getCenteredCardBounds(image)
  }

  const paddingX = detectedWidth * 0.015
  const paddingY = detectedHeight * 0.015
  const scaleX = image.width / width
  const scaleY = image.height / height
  const x = Math.max(0, (left.index - paddingX) * scaleX)
  const y = Math.max(0, (top.index - paddingY) * scaleY)
  const rightEdge = Math.min(
    image.width,
    (right.index + paddingX) * scaleX
  )
  const bottomEdge = Math.min(
    image.height,
    (bottom.index + paddingY) * scaleY
  )

  return {
    x,
    y,
    width: rightEdge - x,
    height: bottomEdge - y
  }
}

function isCardTooSmallForOcr(cardBounds) {
  return cardBounds.width < PHOTO_MIN_CARD_WIDTH ||
    cardBounds.height < PHOTO_MIN_CARD_HEIGHT
}

function normalizePhotoCrop(cardBounds, image) {
  const left = cardBounds.x / image.width * 100
  const top = cardBounds.y / image.height * 100
  const right = (cardBounds.x + cardBounds.width) / image.width * 100
  const bottom = (cardBounds.y + cardBounds.height) / image.height * 100

  return {
    left: Math.max(0, Math.min(90, left)),
    top: Math.max(0, Math.min(90, top)),
    right: Math.max(10, Math.min(100, right)),
    bottom: Math.max(10, Math.min(100, bottom))
  }
}

function getPhotoCropBounds(image, crop) {
  if (!crop) return detectLikelyCardBounds(image)

  const x = image.width * crop.left / 100
  const y = image.height * crop.top / 100
  const right = image.width * crop.right / 100
  const bottom = image.height * crop.bottom / 100

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  }
}

function createProcessedPhotoRegion(
  image,
  cardBounds,
  region,
  {
    scale = 2.5,
    contrast = 1.35,
    binary = false,
    adaptive = false,
    sharpen = false,
    channel = 'luminance',
    invert = false
  } = {}
) {
  const sourceX = cardBounds.x + cardBounds.width * region.x
  const sourceY = cardBounds.y + cardBounds.height * region.y
  const sourceWidth = cardBounds.width * region.width
  const sourceHeight = cardBounds.height * region.height
  const outputScale = Math.min(
    scale,
    1800 / sourceWidth,
    900 / sourceHeight
  )
  const width = Math.max(1, Math.round(sourceWidth * outputScale))
  const height = Math.max(1, Math.round(sourceHeight * outputScale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) throw new Error('Canvas no disponible')

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height
  )
  const imageData = context.getImageData(0, 0, width, height)
  const grayscale = new Uint8Array(width * height)
  const histogram = new Uint32Array(256)

  for (let index = 0; index < grayscale.length; index += 1) {
    const offset = index * 4
    const red = imageData.data[offset]
    const green = imageData.data[offset + 1]
    const blue = imageData.data[offset + 2]
    let value

    if (channel === 'red') value = red
    else if (channel === 'green') value = green
    else if (channel === 'blue') value = blue
    else if (channel === 'max') value = Math.max(red, green, blue)
    else {
      value = Math.round(red * 0.299 + green * 0.587 + blue * 0.114)
    }
    const adjusted = Math.max(
      0,
      Math.min(255, Math.round((value - 128) * contrast + 128))
    )

    grayscale[index] = adjusted
    histogram[adjusted] += 1
  }

  if (sharpen && width > 2 && height > 2) {
    const source = grayscale.slice()

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x
        const value = source[index] * 5 -
          source[index - 1] -
          source[index + 1] -
          source[index - width] -
          source[index + width]

        grayscale[index] = Math.max(0, Math.min(255, value))
      }
    }
  }

  let threshold = 128

  if (binary) {
    let total = 0
    let weightedTotal = 0
    let backgroundWeight = 0
    let backgroundSum = 0
    let bestVariance = -1

    for (let value = 0; value < histogram.length; value += 1) {
      total += histogram[value]
      weightedTotal += value * histogram[value]
    }

    for (let value = 0; value < histogram.length; value += 1) {
      backgroundWeight += histogram[value]
      if (backgroundWeight === 0) continue

      const foregroundWeight = total - backgroundWeight
      if (foregroundWeight === 0) break

      backgroundSum += value * histogram[value]
      const backgroundMean = backgroundSum / backgroundWeight
      const foregroundMean =
        (weightedTotal - backgroundSum) / foregroundWeight
      const variance = backgroundWeight * foregroundWeight *
        (backgroundMean - foregroundMean) ** 2

      if (variance > bestVariance) {
        bestVariance = variance
        threshold = value
      }
    }
  }

  let integral = null
  if (adaptive) {
    integral = new Float64Array((width + 1) * (height + 1))

    for (let y = 1; y <= height; y += 1) {
      let rowSum = 0
      for (let x = 1; x <= width; x += 1) {
        rowSum += grayscale[(y - 1) * width + x - 1]
        integral[y * (width + 1) + x] =
          integral[(y - 1) * (width + 1) + x] + rowSum
      }
    }
  }

  const adaptiveRadius = Math.max(8, Math.round(Math.min(width, height) * 0.12))

  for (let index = 0; index < grayscale.length; index += 1) {
    const offset = index * 4
    let value = grayscale[index]

    if (adaptive && integral) {
      const x = index % width
      const y = Math.floor(index / width)
      const left = Math.max(0, x - adaptiveRadius)
      const right = Math.min(width - 1, x + adaptiveRadius)
      const top = Math.max(0, y - adaptiveRadius)
      const bottom = Math.min(height - 1, y + adaptiveRadius)
      const stride = width + 1
      const area = (right - left + 1) * (bottom - top + 1)
      const localSum = integral[(bottom + 1) * stride + right + 1] -
        integral[top * stride + right + 1] -
        integral[(bottom + 1) * stride + left] +
        integral[top * stride + left]
      const localMean = localSum / area

      value = value >= localMean - 8 ? 255 : 0
    } else if (binary) {
      value = value >= threshold ? 255 : 0
    }

    if (invert) value = 255 - value

    imageData.data[offset] = value
    imageData.data[offset + 1] = value
    imageData.data[offset + 2] = value
  }

  context.putImageData(imageData, 0, 0)
  return canvas
}

function createVisualSample(
  image,
  bounds,
  region,
  width,
  height
) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) return null

  context.drawImage(
    image,
    bounds.x + bounds.width * region.x,
    bounds.y + bounds.height * region.y,
    bounds.width * region.width,
    bounds.height * region.height,
    0,
    0,
    width,
    height
  )

  let pixels

  try {
    pixels = context.getImageData(0, 0, width, height).data
  } catch {
    return null
  }

  const grayscale = new Float32Array(width * height)
  const histogram = new Float32Array(64)
  let mean = 0

  for (let index = 0; index < grayscale.length; index += 1) {
    const offset = index * 4
    const red = pixels[offset]
    const green = pixels[offset + 1]
    const blue = pixels[offset + 2]
    const gray = red * 0.299 + green * 0.587 + blue * 0.114
    const bucket = Math.floor(red / 64) * 16 +
      Math.floor(green / 64) * 4 +
      Math.floor(blue / 64)

    grayscale[index] = gray
    histogram[bucket] += 1
    mean += gray
  }

  mean /= grayscale.length
  let variance = 0

  for (const value of grayscale) {
    variance += (value - mean) ** 2
  }

  const deviation = Math.max(1, Math.sqrt(variance / grayscale.length))

  for (let index = 0; index < grayscale.length; index += 1) {
    grayscale[index] = (grayscale[index] - mean) / deviation
  }

  let histogramLength = 0

  for (const value of histogram) histogramLength += value ** 2
  histogramLength = Math.max(1, Math.sqrt(histogramLength))

  for (let index = 0; index < histogram.length; index += 1) {
    histogram[index] /= histogramLength
  }

  return { grayscale, histogram }
}

function createCardVisualFingerprint(image, bounds) {
  const full = createVisualSample(
    image,
    bounds,
    { x: 0.055, y: 0.035, width: 0.89, height: 0.93 },
    20,
    28
  )
  const artwork = createVisualSample(
    image,
    bounds,
    { x: 0.08, y: 0.13, width: 0.84, height: 0.48 },
    20,
    14
  )

  return full && artwork ? { full, artwork } : null
}

function compareVisualSamples(first, second) {
  if (!first || !second) return 0

  let correlation = 0
  let histogramSimilarity = 0

  for (let index = 0; index < first.grayscale.length; index += 1) {
    correlation += first.grayscale[index] * second.grayscale[index]
  }

  correlation = Math.max(
    0,
    Math.min(1, correlation / first.grayscale.length)
  )

  for (let index = 0; index < first.histogram.length; index += 1) {
    histogramSimilarity += first.histogram[index] * second.histogram[index]
  }

  return correlation * 0.7 +
    Math.max(0, Math.min(1, histogramSimilarity)) * 0.3
}

function compareCardVisualFingerprints(first, second) {
  if (!first || !second) return 0

  return compareVisualSamples(first.artwork, second.artwork) * 0.7 +
    compareVisualSamples(first.full, second.full) * 0.3
}

async function getRemoteCardFingerprint(image) {
  const urls = getCardImageUrls(image)

  for (const url of urls) {
    if (visualFingerprintCache.has(url)) {
      try {
        return await visualFingerprintCache.get(url)
      } catch {
        continue
      }
    }

    const request = (async () => {
      const response = await fetch(url)

      if (!response.ok) throw new Error('Imagen de referencia no disponible')

      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)

      try {
        return createCardVisualFingerprint(bitmap, {
          x: 0,
          y: 0,
          width: bitmap.width,
          height: bitmap.height
        })
      } finally {
        bitmap.close()
      }
    })()

    visualFingerprintCache.set(url, request)

    try {
      return await request
    } catch {
      if (visualFingerprintCache.get(url) === request) {
        visualFingerprintCache.delete(url)
      }
    }
  }

  return null
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length) },
      () => worker()
    )
  )

  return results
}

async function scanMissingCatalogPage({
  search,
  preferredLanguage,
  cursors,
  exhausted,
  ownedIds,
  seenIds,
  pendingCards = []
}) {
  const nextCursors = { ...cursors }
  const nextExhausted = { ...exhausted }
  const cards = pendingCards.filter((card) => !ownedIds.has(card.id))
  const queuedIds = new Set([
    ...seenIds,
    ...cards.map((card) => card.id)
  ])
  const languages = preferredLanguage === 'en'
    ? ['en', 'es']
    : ['es', 'en']

  for (
    let round = 0;
    round < ALL_MISSING_MAX_SCAN_ROUNDS &&
      cards.length < ALL_MISSING_PAGE_SIZE &&
      languages.some((language) => !nextExhausted[language]);
    round += 1
  ) {
    const activeLanguages = languages.filter(
      (language) => !nextExhausted[language]
    )
    const settled = await Promise.allSettled(
      activeLanguages.map((language) =>
        getCards(search, nextCursors[language], language)
      )
    )
    let successfulRequests = 0

    settled.forEach((result, index) => {
      if (result.status !== 'fulfilled') return

      successfulRequests += 1
      const language = activeLanguages[index]
      const pageCards = Array.isArray(result.value) ? result.value : []
      nextCursors[language] += 1

      if (pageCards.length < 12) nextExhausted[language] = true

      for (const card of pageCards) {
        if (
          typeof card?.id !== 'string' ||
          ownedIds.has(card.id) ||
          queuedIds.has(card.id)
        ) {
          continue
        }

        queuedIds.add(card.id)
        cards.push({ ...card, sourceLanguage: language })
      }
    })

    if (successfulRequests === 0) {
      throw new Error('No se pudo consultar el catálogo')
    }
  }

  const pageCards = cards.slice(0, ALL_MISSING_PAGE_SIZE)
  const detailedCards = await mapWithConcurrency(
    pageCards,
    VISUAL_MATCH_CONCURRENCY,
    async (card) => {
      try {
        const details = await getCardById(card.id, card.sourceLanguage)
        return { ...card, ...details, sourceLanguage: card.sourceLanguage }
      } catch {
        return card
      }
    }
  )

  return {
    cards: detailedCards,
    pendingCards: cards.slice(ALL_MISSING_PAGE_SIZE),
    cursors: nextCursors,
    exhausted: nextExhausted
  }
}

async function loadPhotoImage(file) {
  if (typeof createImageBitmap === 'function') {
    let bitmap

    try {
      bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image'
      })
    } catch {
      bitmap = await createImageBitmap(file)
    }

    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close()
    }
  }

  const imageUrl = URL.createObjectURL(file)

  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = reject
      element.src = imageUrl
    })

    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => {}
    }
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

function getImageDimensions(imageUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.onload = () => resolve({
      width: image.naturalWidth,
      height: image.naturalHeight
    })
    image.onerror = reject
    image.src = imageUrl
  })
}

function getLocalDateValue() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function isValidDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const date = new Date(`${value}T00:00:00.000Z`)

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
}

function formatClp(value, language, currency) {
  const locale = language === 'en' ? 'en-US' : 'es-CL'
  const formattedValue = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0
  }).format(value)

  return `${formattedValue} ${currency}`
}

function formatTransactionDate(value, language) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const locale = language === 'en' ? 'en-US' : 'es-CL'

  return date.toLocaleDateString(locale)
}

function Collection({ texts, language, view = 'collection' }) {
  const [cards, setCards] = useState([])
  const [collectionPage, setCollectionPage] = useState(1)
  const [collectionTotalPages, setCollectionTotalPages] = useState(0)
  const [collectionTotal, setCollectionTotal] = useState(0)
  const [collectionOverallTotal, setCollectionOverallTotal] = useState(null)
  const [collectionTotalQuantity, setCollectionTotalQuantity] = useState(0)
  const [collectionSummaryIds, setCollectionSummaryIds] = useState([])
  const [collectionRefresh, setCollectionRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [busyTradeId, setBusyTradeId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [activeCollectionTab, setActiveCollectionTab] = useState('cards')
  const [tags, setTags] = useState([])
  const [cardTagIds, setCardTagIds] = useState({})
  const [tagsLoading, setTagsLoading] = useState(true)
  const [tagsError, setTagsError] = useState(false)
  const [manageTagsOpen, setManageTagsOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagEmoji, setNewTagEmoji] = useState('')
  const [tagBusyKey, setTagBusyKey] = useState('')
  const [tagMessage, setTagMessage] = useState('')
  const [editingTagsCardId, setEditingTagsCardId] = useState(null)
  const [collectionSearch, setCollectionSearch] = useState('')
  const [collectionSort, setCollectionSort] = useState('name-asc')
  const [collectionTagFilter, setCollectionTagFilter] = useState('all')
  const [collectionRarityFilter, setCollectionRarityFilter] = useState('all')
  const [collectionSetFilter, setCollectionSetFilter] = useState('all')
  const [addCardPanelOpen, setAddCardPanelOpen] = useState(false)
  const [addCardSearch, setAddCardSearch] = useState('')
  const [addCardResults, setAddCardResults] = useState([])
  const [addCardResultsLanguage, setAddCardResultsLanguage] = useState(language)
  const [addCardSearching, setAddCardSearching] = useState(false)
  const [addCardHasSearched, setAddCardHasSearched] = useState(false)
  const [addCardSearchError, setAddCardSearchError] = useState(false)
  const [addingCardId, setAddingCardId] = useState(null)
  const [addCardMessage, setAddCardMessage] = useState(null)
  const [sets, setSets] = useState([])
  const [setsLoading, setSetsLoading] = useState(true)
  const [setsError, setSetsError] = useState(false)
  const [selectedSetId, setSelectedSetId] = useState('')
  const [setDetails, setSetDetails] = useState(null)
  const [setDetailsLoading, setSetDetailsLoading] = useState(false)
  const [setDetailsError, setSetDetailsError] = useState('')
  const [setFilter, setSetFilter] = useState('all')
  const [addingMissingCardId, setAddingMissingCardId] = useState(null)
  const [setFeedback, setSetFeedback] = useState(null)
  const [missingMode, setMissingMode] = useState('all')
  const [allMissingSearchInput, setAllMissingSearchInput] = useState('')
  const [allMissingSearch, setAllMissingSearch] = useState('')
  const [allMissingPages, setAllMissingPages] = useState([])
  const [allMissingPending, setAllMissingPending] = useState([])
  const [allMissingPageIndex, setAllMissingPageIndex] = useState(0)
  const [allMissingCursors, setAllMissingCursors] = useState({ es: 1, en: 1 })
  const [allMissingExhausted, setAllMissingExhausted] = useState({
    es: false,
    en: false
  })
  const [allMissingLoading, setAllMissingLoading] = useState(false)
  const [allMissingError, setAllMissingError] = useState(false)
  const [transactions, setTransactions] = useState([])
  const [transactionsLoading, setTransactionsLoading] = useState(true)
  const [transactionsError, setTransactionsError] = useState(false)
  const [transactionsPage, setTransactionsPage] = useState(1)
  const [transactionsTotalPages, setTransactionsTotalPages] = useState(0)
  const [transactionsTotal, setTransactionsTotal] = useState(0)
  const [transactionsRefresh, setTransactionsRefresh] = useState(0)
  const [transactionCardDetails, setTransactionCardDetails] = useState({})
  const [transactionImageStates, setTransactionImageStates] = useState({})
  const [transactionCardId, setTransactionCardId] = useState('')
  const [transactionSelectedCard, setTransactionSelectedCard] = useState(null)
  const [transactionCardSearch, setTransactionCardSearch] = useState('')
  const [transactionActiveSearch, setTransactionActiveSearch] = useState('')
  const [transactionSearchResults, setTransactionSearchResults] = useState([])
  const [transactionSearchPage, setTransactionSearchPage] = useState(1)
  const [transactionSearchHasMore, setTransactionSearchHasMore] = useState(false)
  const [transactionSearchRefresh, setTransactionSearchRefresh] = useState(0)
  const [transactionSearching, setTransactionSearching] = useState(false)
  const [transactionSearchError, setTransactionSearchError] = useState(false)
  const [transactionHasSearched, setTransactionHasSearched] = useState(false)
  const [transactionType, setTransactionType] = useState('purchase')
  const [transactionQuantity, setTransactionQuantity] = useState('1')
  const [transactionUnitPrice, setTransactionUnitPrice] = useState('0')
  const [transactionDate, setTransactionDate] = useState(getLocalDateValue)
  const [transactionNotes, setTransactionNotes] = useState('')
  const [transactionSaving, setTransactionSaving] = useState(false)
  const [transactionMessage, setTransactionMessage] = useState('')
  const [transactionFilter, setTransactionFilter] = useState('all')
  const [photoPanelOpen, setPhotoPanelOpen] = useState(false)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('')
  const [photoCrop, setPhotoCrop] = useState(null)
  const [showPhotoCrop, setShowPhotoCrop] = useState(false)
  const [photoPhase, setPhotoPhase] = useState('idle')
  const [photoStep, setPhotoStep] = useState('idle')
  const [photoProgress, setPhotoProgress] = useState(0)
  const [photoError, setPhotoError] = useState('')
  const [photoFields, setPhotoFields] = useState({
    name: '',
    nameAlternatives: [],
    number: '',
    total: '',
    hp: '',
    expansion: '',
    illustrator: ''
  })
  const [photoResults, setPhotoResults] = useState([])
  const [photoImageStates, setPhotoImageStates] = useState({})
  const [selectedPhotoCardId, setSelectedPhotoCardId] = useState('')
  const [photoHasAnalyzed, setPhotoHasAnalyzed] = useState(false)
  const [showPhotoCorrections, setShowPhotoCorrections] = useState(false)
  const [showOtherPhotoMatches, setShowOtherPhotoMatches] = useState(false)
  const [photoQuantity, setPhotoQuantity] = useState('1')
  const [photoAdding, setPhotoAdding] = useState(false)
  const [photoMessage, setPhotoMessage] = useState('')
  const imageLanguage = useRef(language)
  const ocrWorker = useRef(null)
  const ocrWorkerRequest = useRef(null)
  const photoRunId = useRef(0)
  const photoPreviewUrlRef = useRef('')
  const photoPanelOpenRef = useRef(false)
  const automaticPhotoCrop = useRef(null)
  const allMissingRunId = useRef(0)
  const collectionLoadId = useRef(0)
  const collectionRequest = useRef(null)
  const collectionSummaryRequest = useRef(null)
  const collectionRevision = useRef(0)
  const ownedIdsSignature = [...collectionSummaryIds]
    .sort()
    .join('|')

  useEffect(() => {
    imageLanguage.current = language
  }, [language])

  useEffect(() => () => {
    photoRunId.current += 1
    photoPanelOpenRef.current = false

    if (photoPreviewUrlRef.current) {
      URL.revokeObjectURL(photoPreviewUrlRef.current)
      photoPreviewUrlRef.current = ''
    }

    const worker = ocrWorker.current
    ocrWorker.current = null
    ocrWorkerRequest.current = null

    if (worker) {
      void worker.terminate()
    }
  }, [])


  useEffect(() => {
    if (view !== 'collection') return

    const loadId = collectionLoadId.current + 1
    const revision = collectionRevision.current
    collectionLoadId.current = loadId
    let cancelled = false
    const query = {
      page: collectionPage,
      pageSize: 24,
      language,
      search: collectionSearch,
      rarity: collectionRarityFilter === 'all' ? '' : collectionRarityFilter,
      setId: collectionSetFilter === 'all' ? '' : collectionSetFilter,
      trade: activeCollectionTab === 'trade' ? 'true' : 'all',
      tag: collectionTagFilter,
      sort: collectionSort
    }
    const requestKey = JSON.stringify(query)

    async function loadCollection() {
      setLoading(true)
      setError('')

      try {
        const pending = collectionRequest.current?.key === requestKey
          ? collectionRequest.current.promise
          : getCollectionPage(query)
        collectionRequest.current = { key: requestKey, promise: pending }
        let savedCards

        try {
          savedCards = await pending
        } finally {
          if (collectionRequest.current?.promise === pending) {
            collectionRequest.current = null
          }
        }

        if (cancelled || collectionLoadId.current !== loadId) return

        if (collectionRevision.current === revision) {
          const pageCards = Array.isArray(savedCards?.cards)
            ? savedCards.cards
            : []
          setCards(pageCards)
          setCardTagIds((current) => {
            const next = { ...current }
            for (const item of pageCards) {
              next[String(item.id)] = Array.isArray(item.tagIds)
                ? item.tagIds
                : []
            }
            return next
          })
          setCollectionTotal(
            Number.isSafeInteger(savedCards?.total) ? savedCards.total : 0
          )
          setCollectionTotalPages(
            Number.isSafeInteger(savedCards?.totalPages)
              ? savedCards.totalPages
              : 0
          )
          if (Number.isSafeInteger(savedCards?.page)) {
            setCollectionPage(savedCards.page)
          }
        }
        setLoading(false)

        await mapWithConcurrency(
          Array.isArray(savedCards?.cards) ? savedCards.cards : [],
          COLLECTION_DETAILS_CONCURRENCY,
          async (item) => {
            if (item.details) return

            let details

            try {
              details = await getCardById(item.cardId, language)
            } catch {
              details = null
            }

            if (
              cancelled ||
              collectionLoadId.current !== loadId ||
              collectionRevision.current !== revision
            ) return

            setCards((current) => current.map((card) =>
              card.id === item.id && card.cardId === item.cardId
                ? { ...card, details }
                : card
            ))
          }
        )
      } catch (error) {
        if (!cancelled && collectionLoadId.current === loadId) {
          if (collectionRevision.current === revision) setCards([])
          setError(error.message)
        }
      } finally {
        if (!cancelled && collectionLoadId.current === loadId) {
          setLoading(false)
        }
      }
    }

    loadCollection()

    return () => {
      cancelled = true
      if (collectionLoadId.current === loadId) {
        collectionLoadId.current += 1
      }
    }
  }, [
    activeCollectionTab,
    collectionPage,
    collectionRarityFilter,
    collectionSearch,
    collectionSetFilter,
    collectionSort,
    collectionTagFilter,
    language,
    collectionRefresh,
    view
  ])

  useEffect(() => {
    if (view !== 'collection') return

    let cancelled = false

    async function loadCollectionSummary() {
      try {
        const pending = collectionSummaryRequest.current?.key === collectionRefresh
          ? collectionSummaryRequest.current.promise
          : getCollectionSummary()
        collectionSummaryRequest.current = {
          key: collectionRefresh,
          promise: pending
        }
        let result

        try {
          result = await pending
        } finally {
          if (collectionSummaryRequest.current?.promise === pending) {
            collectionSummaryRequest.current = null
          }
        }

        if (cancelled) return

        const summaryCards = Array.isArray(result.cards) ? result.cards : []
        setCollectionSummaryIds(summaryCards.map((card) => card.cardId))
        setCollectionOverallTotal(summaryCards.length)
        setCollectionTotalQuantity(
          Number.isSafeInteger(result.totalQuantity)
            ? result.totalQuantity
            : summaryCards.reduce(
                (total, card) => total + Number(card.quantity ?? 0),
                0
              )
        )
      } catch {
        if (!cancelled) {
          setCollectionSummaryIds([])
          setCollectionOverallTotal(0)
        }
      }
    }

    void loadCollectionSummary()

    return () => {
      cancelled = true
    }
  }, [collectionRefresh, view])

  useEffect(() => {
    let cancelled = false

    async function loadTags() {
      setTagsLoading(true)
      setTagsError(false)

      try {
        const result = await getTags({ includeAssignments: false })

        if (cancelled) return

        setTags(Array.isArray(result.tags) ? result.tags : [])
        const assignments = Array.isArray(result.assignments)
          ? result.assignments
          : []
        const nextCardTagIds = {}

        for (const assignment of assignments) {
          const key = String(assignment.userCardId)
          nextCardTagIds[key] = [
            ...(nextCardTagIds[key] ?? []),
            assignment.tagId
          ]
        }

        setCardTagIds(nextCardTagIds)
      } catch {
        if (!cancelled) {
          setTags([])
          setCardTagIds({})
          setTagsError(true)
        }
      } finally {
        if (!cancelled) setTagsLoading(false)
      }
    }

    void loadTags()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (missingMode !== 'all') return

    const runId = allMissingRunId.current + 1
    allMissingRunId.current = runId

    async function loadInitialMissingPage() {
      setAllMissingPages([])
      setAllMissingPending([])
      setAllMissingPageIndex(0)
      setAllMissingCursors({ es: 1, en: 1 })
      setAllMissingExhausted({ es: false, en: false })
      setAllMissingLoading(true)
      setAllMissingError(false)

      try {
        const result = await scanMissingCatalogPage({
          search: allMissingSearch,
          preferredLanguage: language,
          cursors: { es: 1, en: 1 },
          exhausted: { es: false, en: false },
          ownedIds: new Set(ownedIdsSignature.split('|').filter(Boolean)),
          seenIds: new Set(),
          pendingCards: []
        })

        if (allMissingRunId.current !== runId) return

        setAllMissingPages(result.cards.length > 0 ? [result.cards] : [])
        setAllMissingPending(result.pendingCards)
        setAllMissingCursors(result.cursors)
        setAllMissingExhausted(result.exhausted)
      } catch {
        if (allMissingRunId.current === runId) setAllMissingError(true)
      } finally {
        if (allMissingRunId.current === runId) setAllMissingLoading(false)
      }
    }

    void loadInitialMissingPage()

    return () => {
      allMissingRunId.current += 1
    }
  }, [allMissingSearch, language, missingMode, ownedIdsSignature])

  useEffect(() => {
    let cancelled = false

    async function loadSets() {
      setSetsLoading(true)
      setSetsError(false)
      setSetFeedback(null)

      try {
        const result = await getSets(language)
        const availableSets = (Array.isArray(result) ? result : [])
          .sort((first, second) =>
            new Intl.Collator(language, {
              sensitivity: 'base',
              numeric: true
            }).compare(first.name, second.name)
          )

        if (!cancelled) {
          setSets(availableSets)
          setSelectedSetId((current) =>
            availableSets.some((set) => set.id === current)
              ? current
              : ''
          )
        }
      } catch {
        if (!cancelled) {
          setSets([])
          setSelectedSetId('')
          setSetsError(true)
        }
      } finally {
        if (!cancelled) {
          setSetsLoading(false)
        }
      }
    }

    loadSets()

    return () => {
      cancelled = true
    }
  }, [language])

  useEffect(() => {
    if (!selectedSetId) {
      return
    }

    let cancelled = false

    async function loadSetDetails() {
      setSetDetails(null)
      setSetDetailsLoading(true)
      setSetDetailsError('')
      setSetFeedback(null)

      try {
        const result = await getSetById(selectedSetId, language)

        if (!cancelled) {
          if (result) {
            setSetDetails(result)
          } else {
            setSetDetailsError('notFound')
          }
        }
      } catch {
        if (!cancelled) {
          setSetDetailsError('loadError')
        }
      } finally {
        if (!cancelled) {
          setSetDetailsLoading(false)
        }
      }
    }

    loadSetDetails()

    return () => {
      cancelled = true
    }
  }, [selectedSetId, language])

  useEffect(() => {
    let cancelled = false

    async function loadTransactions() {
      setTransactionsLoading(true)
      setTransactionsError(false)

      try {
        const result = await getTransactions(
          transactionsPage,
          transactionFilter
        )

        if (!cancelled) {
          setTransactions(
            Array.isArray(result.transactions) ? result.transactions : []
          )
          setTransactionsPage(
            Number.isSafeInteger(result.page) ? result.page : 1
          )
          setTransactionsTotalPages(
            Number.isSafeInteger(result.totalPages) ? result.totalPages : 0
          )
          setTransactionsTotal(
            Number.isSafeInteger(result.total) ? result.total : 0
          )
        }
      } catch {
        if (!cancelled) {
          setTransactions([])
          setTransactionsTotalPages(0)
          setTransactionsTotal(0)
          setTransactionsError(true)
        }
      } finally {
        if (!cancelled) {
          setTransactionsLoading(false)
        }
      }
    }

    loadTransactions()

    return () => {
      cancelled = true
    }
  }, [transactionFilter, transactionsPage, transactionsRefresh])

  useEffect(() => {
    if (transactions.length === 0) return

    let cancelled = false

    async function loadTransactionCardDetails() {
      const cardIds = [
        ...new Set(transactions.map((transaction) => transaction.cardId))
      ]
      const entries = await mapWithConcurrency(
        cardIds,
        VISUAL_MATCH_CONCURRENCY,
        async (cardId) => {
          try {
            const details = await getCardById(cardId, language)
            return [cardId, details]
          } catch {
            return [cardId, null]
          }
        }
      )

      if (!cancelled) {
        setTransactionCardDetails(Object.fromEntries(entries))
      }
    }

    loadTransactionCardDetails()

    return () => {
      cancelled = true
    }
  }, [transactions, language])

  useEffect(() => {
    if (!transactionActiveSearch) return

    let cancelled = false

    async function loadTransactionSearchPage() {
      setTransactionSearching(true)
      setTransactionSearchError(false)
      setTransactionHasSearched(true)
      setTransactionMessage('')

      try {
        const languages = language === 'en' ? ['en', 'es'] : ['es', 'en']
        const cardRequests = await Promise.allSettled(
          languages.map((candidateLanguage) =>
            getCards(
              transactionActiveSearch,
              transactionSearchPage,
              candidateLanguage
            )
          )
        )
        const fulfilledCards = cardRequests.filter(
          (result) => result.status === 'fulfilled'
        )

        if (fulfilledCards.length === 0) {
          throw new Error('Catálogo no disponible')
        }

        const cardsById = new Map()

        cardRequests.forEach((result, index) => {
          if (result.status !== 'fulfilled') return

          for (const card of Array.isArray(result.value) ? result.value : []) {
            if (!cardsById.has(card.id)) {
              cardsById.set(card.id, {
                ...card,
                sourceLanguage: languages[index]
              })
            }
          }
        })

        if (cancelled) return

        setTransactionSearchResults([...cardsById.values()])
        setTransactionSearchHasMore(
          fulfilledCards.some((result) =>
            Array.isArray(result.value) && result.value.length >= 12
          )
        )
      } catch {
        if (!cancelled) {
          setTransactionSearchResults([])
          setTransactionSearchHasMore(false)
          setTransactionSearchError(true)
        }
      } finally {
        if (!cancelled) setTransactionSearching(false)
      }
    }

    void loadTransactionSearchPage()

    return () => {
      cancelled = true
    }
  }, [
    language,
    transactionActiveSearch,
    transactionSearchPage,
    transactionSearchRefresh
  ])

  useEffect(() => {
    if (transactions.length === 0) return

    let cancelled = false
    const cardIds = [
      ...new Set(transactions.map((transaction) => transaction.cardId))
    ]
    const detailsReady = cardIds.every((cardId) =>
      Object.prototype.hasOwnProperty.call(transactionCardDetails, cardId) ||
      cards.some((card) => card.cardId === cardId && card.details)
    )

    if (!detailsReady) return

    const cardsById = Object.fromEntries(
      cardIds.map((cardId) => {
        const collectionCard = cards.find((card) => card.cardId === cardId)
        const details = transactionCardDetails[cardId] ?? collectionCard?.details

        return [cardId, details]
      })
    )
    cardIds
      .filter((cardId) =>
        getCardImageUrls(cardsById[cardId]?.image).length === 0
      )
      .forEach(async (cardId) => {
        try {
          const alternateImage = await getAlternateCardImage(cardId, language)

          if (cancelled) return

          const urls = getCardImageUrls(alternateImage)
          setTransactionImageStates((current) => ({
            ...current,
            [cardId]: {
              language,
              urls,
              index: 0,
              source: 'alternate',
              unavailable: urls.length === 0
            }
          }))
        } catch {
          if (cancelled) return

          setTransactionImageStates((current) => ({
            ...current,
            [cardId]: {
              language,
              urls: [],
              index: 0,
              source: 'alternate',
              unavailable: true
            }
          }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [cards, language, transactionCardDetails, transactions])

  useEffect(() => {
    if (photoResults.length === 0) return

    let cancelled = false

    photoResults
      .filter((card) => getCardImageUrls(card.image).length === 0)
      .forEach(async (card) => {
        try {
          const alternateImage = await getAlternateCardImage(
            card.id,
            card.sourceLanguage
          )

          if (cancelled) return

          const urls = getCardImageUrls(alternateImage)
          setPhotoImageStates((current) => ({
            ...current,
            [card.id]: {
              language: card.sourceLanguage,
              urls,
              index: 0,
              source: 'alternate',
              unavailable: urls.length === 0
            }
          }))
        } catch {
          if (cancelled) return

          setPhotoImageStates((current) => ({
            ...current,
            [card.id]: {
              language: card.sourceLanguage,
              urls: [],
              index: 0,
              source: 'alternate',
              unavailable: true
            }
          }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [photoResults])

  useEffect(() => {
    if (transactionSearchResults.length === 0) return

    let cancelled = false

    transactionSearchResults
      .filter((card) => getCardImageUrls(card.image).length === 0)
      .forEach(async (card) => {
        try {
          const alternateImage = await getAlternateCardImage(card.id, language)
          if (cancelled) return

          const urls = getCardImageUrls(alternateImage)
          setTransactionImageStates((current) => ({
            ...current,
            [card.id]: {
              language,
              urls,
              index: 0,
              source: 'alternate',
              unavailable: urls.length === 0
            }
          }))
        } catch {
          if (cancelled) return

          setTransactionImageStates((current) => ({
            ...current,
            [card.id]: {
              language,
              urls: [],
              index: 0,
              source: 'alternate',
              unavailable: true
            }
          }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [language, transactionSearchResults])

  async function handlePhotoImageError(card) {
    const fallbackState = {
      language: card.sourceLanguage,
      urls: getCardImageUrls(card.image),
      index: 0,
      source: 'original',
      unavailable: false
    }
    const savedState = photoImageStates[card.id]
    const currentState = savedState?.language === card.sourceLanguage
      ? savedState
      : fallbackState
    const nextIndex = currentState.index + 1

    if (nextIndex < currentState.urls.length) {
      setPhotoImageStates((current) => ({
        ...current,
        [card.id]: {
          ...currentState,
          index: nextIndex
        }
      }))
      return
    }

    if (currentState.source !== 'original') {
      setPhotoImageStates((current) => ({
        ...current,
        [card.id]: {
          ...currentState,
          unavailable: true
        }
      }))
      return
    }

    setPhotoImageStates((current) => ({
      ...current,
      [card.id]: {
        language: card.sourceLanguage,
        urls: [],
        index: 0,
        source: 'alternate-loading',
        unavailable: false
      }
    }))

    try {
      const alternateImage = await getAlternateCardImage(
        card.id,
        card.sourceLanguage
      )
      const urls = getCardImageUrls(alternateImage)

      setPhotoImageStates((current) => ({
        ...current,
        [card.id]: {
          language: card.sourceLanguage,
          urls,
          index: 0,
          source: 'alternate',
          unavailable: urls.length === 0
        }
      }))
    } catch {
      setPhotoImageStates((current) => ({
        ...current,
        [card.id]: {
          language: card.sourceLanguage,
          urls: [],
          index: 0,
          source: 'alternate',
          unavailable: true
        }
      }))
    }
  }

  async function handleTransactionImageError(cardId, image) {
    const fallbackState = {
      language,
      urls: getCardImageUrls(image),
      index: 0,
      source: 'original',
      unavailable: false
    }
    const savedState = transactionImageStates[cardId]
    const currentState = savedState?.language === language
      ? savedState
      : fallbackState
    const nextIndex = currentState.index + 1

    if (nextIndex < currentState.urls.length) {
      setTransactionImageStates((current) => ({
        ...current,
        [cardId]: {
          ...currentState,
          index: nextIndex
        }
      }))
      return
    }

    if (currentState.source !== 'original') {
      setTransactionImageStates((current) => ({
        ...current,
        [cardId]: {
          ...currentState,
          unavailable: true
        }
      }))
      return
    }

    const requestLanguage = language
    setTransactionImageStates((current) => ({
      ...current,
      [cardId]: {
        language: requestLanguage,
        urls: [],
        index: 0,
        source: 'alternate-loading',
        unavailable: false
      }
    }))

    try {
      const alternateImage = await getAlternateCardImage(
        cardId,
        requestLanguage
      )

      if (imageLanguage.current !== requestLanguage) return

      const urls = getCardImageUrls(alternateImage)
      setTransactionImageStates((current) => ({
        ...current,
        [cardId]: {
          language: requestLanguage,
          urls,
          index: 0,
          source: 'alternate',
          unavailable: urls.length === 0
        }
      }))
    } catch {
      if (imageLanguage.current !== requestLanguage) return

      setTransactionImageStates((current) => ({
        ...current,
        [cardId]: {
          language: requestLanguage,
          urls: [],
          index: 0,
          source: 'alternate',
          unavailable: true
        }
      }))
    }
  }

  function releasePhotoWorker() {
    const worker = ocrWorker.current
    ocrWorker.current = null
    ocrWorkerRequest.current = null

    if (worker) {
      void worker.terminate()
    }
  }

  function resetPhotoResults() {
    setPhotoFields({
      name: '',
      nameAlternatives: [],
      number: '',
      total: '',
      hp: '',
      expansion: '',
      illustrator: ''
    })
    setPhotoResults([])
    setPhotoImageStates({})
    setSelectedPhotoCardId('')
    setPhotoHasAnalyzed(false)
    setShowPhotoCorrections(false)
    setShowOtherPhotoMatches(false)
    setPhotoQuantity('1')
    setPhotoMessage('')
  }

  function handleOpenPhotoPanel() {
    photoPanelOpenRef.current = true
    setPhotoPanelOpen(true)
    setPhotoError('')
  }

  function handleClosePhotoPanel() {
    photoRunId.current += 1
    photoPanelOpenRef.current = false
    setPhotoPanelOpen(false)
    setPhotoFile(null)
    setPhotoPreviewUrl('')
    setPhotoCrop(null)
    setShowPhotoCrop(false)
    automaticPhotoCrop.current = null
    setPhotoPhase('idle')
    setPhotoStep('idle')
    setPhotoProgress(0)
    setPhotoError('')
    resetPhotoResults()

    if (photoPreviewUrlRef.current) {
      URL.revokeObjectURL(photoPreviewUrlRef.current)
      photoPreviewUrlRef.current = ''
    }

    releasePhotoWorker()
  }

  async function handlePhotoFileChange(event) {
    const file = event.target.files?.[0] ?? null
    photoRunId.current += 1
    const runId = photoRunId.current
    setPhotoError('')
    setPhotoPhase('idle')
    setPhotoStep('idle')
    setPhotoProgress(0)
    resetPhotoResults()

    if (photoPreviewUrlRef.current) {
      URL.revokeObjectURL(photoPreviewUrlRef.current)
      photoPreviewUrlRef.current = ''
    }

    setPhotoFile(null)
    setPhotoPreviewUrl('')
    setPhotoCrop(null)
    setShowPhotoCrop(false)
    automaticPhotoCrop.current = null

    if (!file) return

    if (!PHOTO_TYPES.has(file.type)) {
      setPhotoError('invalidType')
      event.target.value = ''
      return
    }

    if (file.size > PHOTO_MAX_BYTES) {
      setPhotoError('fileTooLarge')
      event.target.value = ''
      return
    }

    const previewUrl = URL.createObjectURL(file)

    let detectedCrop

    try {
      const dimensions = await getImageDimensions(previewUrl)

      if (photoRunId.current !== runId) {
        URL.revokeObjectURL(previewUrl)
        return
      }

      const tooLarge = dimensions.width > PHOTO_MAX_DIMENSION ||
        dimensions.height > PHOTO_MAX_DIMENSION ||
        dimensions.width * dimensions.height > PHOTO_MAX_PIXELS

      if (tooLarge) {
        URL.revokeObjectURL(previewUrl)
        setPhotoError('dimensionsTooLarge')
        event.target.value = ''
        return
      }

      const loadedImage = await loadPhotoImage(file)

      try {
        if (photoRunId.current !== runId) {
          URL.revokeObjectURL(previewUrl)
          return
        }

        detectedCrop = normalizePhotoCrop(
          detectLikelyCardBounds(loadedImage.image),
          loadedImage.image
        )
      } finally {
        loadedImage.close()
      }
    } catch {
      URL.revokeObjectURL(previewUrl)

      if (photoRunId.current !== runId) return

      setPhotoError('invalidImage')
      event.target.value = ''
      return
    }

    if (photoRunId.current !== runId) {
      URL.revokeObjectURL(previewUrl)
      return
    }

    photoPreviewUrlRef.current = previewUrl
    automaticPhotoCrop.current = detectedCrop
    setPhotoFile(file)
    setPhotoPreviewUrl(previewUrl)
    setPhotoCrop(detectedCrop)
  }

  function handlePhotoCropChange(edge, value) {
    const numericValue = Number(value)

    if (!Number.isFinite(numericValue)) return

    photoRunId.current += 1
    setPhotoError('')
    setPhotoPhase('idle')
    setPhotoStep('idle')
    resetPhotoResults()
    setPhotoCrop((current) => {
      if (!current) return current

      const next = { ...current }

      if (edge === 'left') {
        next.left = Math.min(numericValue, current.right - 10)
      } else if (edge === 'right') {
        next.right = Math.max(numericValue, current.left + 10)
      } else if (edge === 'top') {
        next.top = Math.min(numericValue, current.bottom - 10)
      } else if (edge === 'bottom') {
        next.bottom = Math.max(numericValue, current.top + 10)
      }

      return next
    })
  }

  function handleResetPhotoCrop() {
    if (!automaticPhotoCrop.current) return

    photoRunId.current += 1
    setPhotoError('')
    setPhotoPhase('idle')
    setPhotoStep('idle')
    resetPhotoResults()
    setPhotoCrop({ ...automaticPhotoCrop.current })
  }

  async function getPhotoOcrWorker() {
    if (ocrWorker.current) return ocrWorker.current
    if (ocrWorkerRequest.current) return ocrWorkerRequest.current

    const request = (async () => {
      const { createWorker } = await import('tesseract.js')

      return createWorker(['eng', 'spa'], 1, {
        logger: (message) => {
          if (
            photoPanelOpenRef.current &&
            typeof message.progress === 'number'
          ) {
            setPhotoProgress(
              Math.max(0, Math.min(100, Math.round(message.progress * 100)))
            )
          }
        }
      })
    })()

    ocrWorkerRequest.current = request

    try {
      const worker = await request

      if (ocrWorkerRequest.current !== request) {
        await worker.terminate()
        throw new Error('OCR cancelado')
      }

      ocrWorker.current = worker
      ocrWorkerRequest.current = null
      return worker
    } catch (error) {
      if (ocrWorkerRequest.current === request) {
        ocrWorkerRequest.current = null
      }
      throw error
    }
  }

  async function recognizePhotoRegion(
    worker,
    image,
    cardBounds,
    region,
    processing,
    parameters
  ) {
    const canvas = createProcessedPhotoRegion(
      image,
      cardBounds,
      region,
      processing
    )

    await worker.setParameters({
      user_defined_dpi: '300',
      preserve_interword_spaces: '1',
      ...parameters
    })
    const result = await worker.recognize(canvas)
    return result.data.text ?? ''
  }

  async function readPhotoFields(worker, file, runId, crop) {
    setPhotoStep('identifying')
    const loadedImage = await loadPhotoImage(file)

    try {
      const cardBounds = getPhotoCropBounds(loadedImage.image, crop)

      if (isCardTooSmallForOcr(cardBounds)) {
        throw new Error('photoTooDistant')
      }

      const nameRegions = [
        { x: 0.1, y: 0.02, width: 0.74, height: 0.105 },
        { x: 0.055, y: 0.045, width: 0.86, height: 0.115 }
      ]
      const nameCandidates = []

      for (const nameRegion of nameRegions) {
        const topText = await recognizePhotoRegion(
          worker,
          loadedImage.image,
          cardBounds,
          nameRegion,
          { scale: 8, contrast: 1.5, sharpen: true },
          {
            tessedit_pageseg_mode: '7',
            tessedit_char_whitelist: ''
          }
        )

        if (photoRunId.current !== runId) return null
        const regionCandidates = extractTopCardNames(topText)
        nameCandidates.push(...regionCandidates)

        if (
          regionCandidates.length === 0 ||
          Math.max(...regionCandidates.map(scoreDetectedName)) < 28
        ) {
          const binaryTopText = await recognizePhotoRegion(
            worker,
            loadedImage.image,
            cardBounds,
            nameRegion,
            { scale: 8, contrast: 1.15, adaptive: true, sharpen: true },
            {
              tessedit_pageseg_mode: '7',
              tessedit_char_whitelist: ''
            }
          )

          if (photoRunId.current !== runId) return null
          nameCandidates.push(...extractTopCardNames(binaryTopText))
        }
      }

      let name = selectBestDetectedName(nameCandidates)

      if (scoreDetectedName(name) < 24) {
        const foilNameRegion = {
          x: 0.08,
          y: 0.018,
          width: 0.66,
          height: 0.12
        }
        const foilProcessingOptions = [
          { channel: 'red', invert: false },
          { channel: 'green', invert: false },
          { channel: 'blue', invert: false },
          { channel: 'max', invert: true }
        ]

        for (const processing of foilProcessingOptions) {
          const foilText = await recognizePhotoRegion(
            worker,
            loadedImage.image,
            cardBounds,
            foilNameRegion,
            {
              scale: 8,
              contrast: 1.15,
              adaptive: true,
              sharpen: true,
              ...processing
            },
            {
              tessedit_pageseg_mode: '7',
              tessedit_char_whitelist: ''
            }
          )

          if (photoRunId.current !== runId) return null
          nameCandidates.push(...extractTopCardNames(foilText))
        }

        name = selectBestDetectedName(nameCandidates)
      }

      if (scoreDetectedName(name) < 18) {
        const broadTopText = await recognizePhotoRegion(
          worker,
          loadedImage.image,
          cardBounds,
          { x: 0.03, y: 0.015, width: 0.94, height: 0.18 },
          { scale: 6, contrast: 1.35 },
          {
            tessedit_pageseg_mode: '11',
            tessedit_char_whitelist: ''
          }
        )

        if (photoRunId.current !== runId) return null
        nameCandidates.push(...extractTopCardNames(broadTopText))
        name = selectBestDetectedName(nameCandidates)
      }

      const hpText = await recognizePhotoRegion(
        worker,
        loadedImage.image,
        cardBounds,
        { x: 0.67, y: 0.02, width: 0.3, height: 0.105 },
        { scale: 8, contrast: 1.45 },
        {
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: '0123456789HPhppsPSPVpv '
        }
      )

      if (photoRunId.current !== runId) return null

      const numberParameters = {
        tessedit_pageseg_mode: '7',
        tessedit_char_whitelist:
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/\\|:;.- '
      }
      const numberRegions = [
        { x: 0.02, y: 0.865, width: 0.62, height: 0.125 },
        { x: 0.54, y: 0.865, width: 0.44, height: 0.125 },
        { x: 0.02, y: 0.84, width: 0.96, height: 0.15 }
      ]
      const numberCandidates = []

      for (const numberRegion of numberRegions) {
        const numberText = await recognizePhotoRegion(
          worker,
          loadedImage.image,
          cardBounds,
          numberRegion,
          { scale: 8, contrast: 1.5 },
          numberParameters
        )

        if (photoRunId.current !== runId) return null
        let numberData = extractSpecializedCollectionNumber(numberText)

        if (!numberData.number) {
          const binaryNumberText = await recognizePhotoRegion(
            worker,
            loadedImage.image,
            cardBounds,
            numberRegion,
            { scale: 8, contrast: 1.35, binary: true },
            numberParameters
          )

          if (photoRunId.current !== runId) return null
          numberData = extractSpecializedCollectionNumber(binaryNumberText)
        }

        if (numberData.number) numberCandidates.push(numberData)
        if (numberData.number && numberData.total) break
      }

      let numberData = selectBestCollectionNumber(numberCandidates)
      let hp = extractSpecializedHp(hpText)

      if (scoreDetectedName(name) < 18) {
        const fullCardText = await recognizePhotoRegion(
          worker,
          loadedImage.image,
          cardBounds,
          { x: 0.015, y: 0.01, width: 0.97, height: 0.98 },
          { scale: 3, contrast: 1.35, sharpen: true },
          {
            tessedit_pageseg_mode: '11',
            tessedit_char_whitelist: ''
          }
        )

        if (photoRunId.current !== runId) return null

        const fullCardFields = extractOcrFields(fullCardText)
        nameCandidates.push(
          ...getDetectedNameVariations(fullCardFields.name)
        )
        name = selectBestDetectedName(nameCandidates)
        hp ||= fullCardFields.hp
        numberData = selectBestCollectionNumber([
          ...numberCandidates,
          {
            number: fullCardFields.number,
            total: fullCardFields.total
          }
        ])
      }

      if (scoreDetectedName(name) < 18) name = ''

      const visualFingerprint = createCardVisualFingerprint(
        loadedImage.image,
        cardBounds
      )

      return {
        name,
        nameAlternatives: [...new Set(nameCandidates)]
          .filter((candidate) => scoreDetectedName(candidate) >= 18)
          .sort((first, second) =>
            scoreDetectedName(second) - scoreDetectedName(first)
          )
          .slice(0, 8),
        number: numberData.number,
        total: numberData.total,
        hp,
        expansion: '',
        illustrator: '',
        visualFingerprint
      }
    } finally {
      loadedImage.close()
      await worker.setParameters({
        tessedit_pageseg_mode: '3',
        tessedit_char_whitelist: ''
      })
    }

  }

  async function fetchPhotoCards(
    name,
    number,
    exactLocalId = false,
    hp = ''
  ) {
    const settled = await Promise.allSettled(
      ['es', 'en'].map(async (candidateLanguage) => {
        const result = await getCards(
          name,
          1,
          candidateLanguage,
          number,
          exactLocalId,
          hp
        )

        return (Array.isArray(result) ? result : []).map((card) => ({
          ...card,
          sourceLanguage: candidateLanguage
        }))
      })
    )
    const fulfilled = settled.filter((result) => result.status === 'fulfilled')

    if (fulfilled.length === 0) {
      throw new Error('No se pudo consultar TCGdex')
    }

    return fulfilled.flatMap((result) => result.value)
  }

  async function fetchExpansionPhotoCards(fields) {
    if (!fields.expansion.trim()) return []

    const settledSets = await Promise.allSettled(
      ['es', 'en'].map(async (candidateLanguage) => ({
        candidateLanguage,
        sets: await getSets(candidateLanguage, fields.expansion.trim())
      }))
    )
    const setMatches = settledSets
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) =>
        (Array.isArray(result.value.sets) ? result.value.sets : [])
          .slice(0, 3)
          .map((set) => ({
            set,
            sourceLanguage: result.value.candidateLanguage
          }))
      )
    const detailedSets = await Promise.allSettled(
      setMatches.map(async ({ set, sourceLanguage }) => ({
        set,
        sourceLanguage,
        details: await getSetById(set.id, sourceLanguage)
      }))
    )
    const normalizedName = normalizeMatchValue(fields.name)
    const normalizedNumber = normalizeCollectionComparison(fields.number)

    return detailedSets
      .filter((result) => result.status === 'fulfilled' && result.value.details)
      .flatMap((result) => {
        const { set, sourceLanguage, details } = result.value
        const setCards = Array.isArray(details.cards) ? details.cards : []

        return setCards
          .filter((card) => {
            const nameMatches = !normalizedName ||
              normalizeMatchValue(card.name).includes(normalizedName) ||
              normalizedName.includes(normalizeMatchValue(card.name))
            const numberMatches = !normalizedNumber ||
              normalizeCollectionComparison(card.localId) === normalizedNumber

            return nameMatches && numberMatches
          })
          .slice(0, 12)
          .map((card) => ({
            ...card,
            set: { id: set.id, name: set.name },
            sourceLanguage
          }))
      })
  }

  async function searchPhotoCandidates(fields, runId) {
    const numberFromField = extractCollectionNumber([
      cleanOcrLine(String(fields.number ?? ''))
    ])
    const normalizedFields = {
      name: cleanDetectedCardName(fields.name),
      nameAlternatives: Array.isArray(fields.nameAlternatives)
        ? fields.nameAlternatives
            .flatMap((name) => getDetectedNameVariations(name))
            .slice(0, 8)
        : [],
      number: numberFromField.number || getCollectionNumberQuery(fields.number),
      total: fields.total.trim() || numberFromField.total,
      hp: fields.hp.trim(),
      expansion: fields.expansion.trim(),
      illustrator: fields.illustrator.trim()
    }

    if (
      normalizedFields.name.length < 2 &&
      !normalizedFields.number
    ) {
      if (photoRunId.current === runId) {
        setPhotoResults([])
        setPhotoError('insufficientData')
        setPhotoPhase('idle')
        setPhotoStep('idle')
        setPhotoHasAnalyzed(true)
      }
      return
    }

    setPhotoPhase('searching')
    setPhotoStep('searching')
    setPhotoError('')
    setPhotoMessage('')
    setSelectedPhotoCardId('')
    setShowOtherPhotoMatches(false)

    try {
      const candidatesById = new Map()
      const nameQueries = [...new Set(
        getPhotoNameAlternatives(normalizedFields)
          .flatMap((name) => getPhotoNameQueries(name))
      )].slice(0, 10)
      const requests = new Map()
      const requestCards = (name, number, exactLocalId = false) => {
        const key = [
          name,
          number,
          exactLocalId
        ].join(':')

        if (!requests.has(key)) {
          requests.set(
            key,
            fetchPhotoCards(
              name,
              number,
              exactLocalId
            )
          )
        }

        return requests.get(key)
      }
      const addCandidates = (candidates) => {
        for (const candidate of candidates) {
          const current = candidatesById.get(candidate.id)

          if (
            !current ||
            scorePhotoCandidate(
              candidate,
              getBestPhotoFieldsForCard(candidate, normalizedFields)
            ) > scorePhotoCandidate(
              current,
              getBestPhotoFieldsForCard(current, normalizedFields)
            )
          ) {
            candidatesById.set(candidate.id, candidate)
          }
        }
      }
      const primaryCandidates = normalizedFields.number
        ? await requestCards(
            nameQueries[0] ?? normalizedFields.name,
            normalizedFields.number,
            true
          )
        : await requestCards(nameQueries[0] ?? normalizedFields.name, '')
      addCandidates(primaryCandidates)

      for (const [index, nameQuery] of nameQueries.slice(1).entries()) {
        if (index >= 5 || (index >= 2 && candidatesById.size >= 12)) break

        addCandidates(await requestCards(
          nameQuery,
          normalizedFields.number,
          Boolean(normalizedFields.number)
        ))
      }

      const comparableNumber = normalizeCollectionComparison(
        normalizedFields.number
      )

      if (
        candidatesById.size < 4 &&
        comparableNumber &&
        comparableNumber !== normalizedFields.number
      ) {
        addCandidates(await requestCards(
          normalizedFields.name,
          comparableNumber,
          true
        ))
      }

      if (
        candidatesById.size < 4 &&
        normalizedFields.name &&
        normalizedFields.number
      ) {
        const [nameCandidates, numberCandidates] = await Promise.all([
          requestCards(normalizedFields.name, ''),
          requestCards('', normalizedFields.number, true)
        ])
        addCandidates(nameCandidates)
        addCandidates(numberCandidates)
      }

      if (candidatesById.size === 0 && normalizedFields.number) {
        addCandidates(await requestCards(
          normalizedFields.name,
          normalizedFields.number
        ))
      }

      if (candidatesById.size < 6 && normalizedFields.expansion) {
        addCandidates(await fetchExpansionPhotoCards(normalizedFields))
      }

      const basicCandidates = [...candidatesById.values()]
        .sort(
          (a, b) =>
            scorePhotoCandidate(
              b,
              getBestPhotoFieldsForCard(b, normalizedFields)
            ) - scorePhotoCandidate(
              a,
              getBestPhotoFieldsForCard(a, normalizedFields)
            )
        )
        .slice(0, 16)
      const detailedCandidates = await Promise.all(
        basicCandidates.map(async (candidate) => {
          try {
            const details = await getCardById(
              candidate.id,
              candidate.sourceLanguage
            )

            return {
              ...candidate,
              ...details,
              set: details?.set ?? candidate.set,
              sourceLanguage: candidate.sourceLanguage
            }
          } catch {
            return candidate
          }
        })
      )
      const candidatesWithVisual = await mapWithConcurrency(
        detailedCandidates,
        VISUAL_MATCH_CONCURRENCY,
        async (card) => {
          if (!fields.visualFingerprint) {
            return { card, visualSimilarity: 0 }
          }

          try {
            const candidateFingerprint = await getRemoteCardFingerprint(
              card.image
            )

            return {
              card,
              visualSimilarity: compareCardVisualFingerprints(
                fields.visualFingerprint,
                candidateFingerprint
              )
            }
          } catch {
            return { card, visualSimilarity: 0 }
          }
        }
      )

      if (photoRunId.current !== runId) return

      const rankedCandidates = candidatesWithVisual
        .map(({ card, visualSimilarity }) => {
          const candidateFields = getBestPhotoFieldsForCard(
            card,
            normalizedFields
          )

          return {
            card,
            evidence: getPhotoCandidateEvidence(
              card,
              candidateFields,
              visualSimilarity
            )
          }
        })
        .filter((candidate) => candidate.evidence.plausible)
        .sort((a, b) => b.evidence.score - a.evidence.score)
        .slice(0, 8)
      const sortedCandidates = rankedCandidates.map(({ card }) => card)
      const strongestCandidate = rankedCandidates[0]
      const secondCandidate = rankedCandidates[1]
      const scoreDifference = strongestCandidate
        ? strongestCandidate.evidence.score -
          (secondCandidate?.evidence.score ?? Number.NEGATIVE_INFINITY)
        : 0
      const hasReliableMatch = Boolean(
        strongestCandidate?.evidence.reliable &&
        (
          strongestCandidate.evidence.numberExact &&
          strongestCandidate.evidence.totalExact ||
          !secondCandidate ||
          scoreDifference >= 80
        )
      )

      if (photoRunId.current !== runId) return

      setPhotoResults(sortedCandidates)
      setPhotoImageStates({})
      if (hasReliableMatch && strongestCandidate?.card.name) {
        setPhotoFields((current) => ({
          ...current,
          name: strongestCandidate.card.name
        }))
      }
      setPhotoError(sortedCandidates.length === 0 ? 'noMatches' : '')
      setPhotoPhase('idle')
      setPhotoStep(
        sortedCandidates.length === 0
          ? 'idle'
          : hasReliableMatch
            ? 'found'
            : 'review'
      )
      setShowOtherPhotoMatches(
        !hasReliableMatch && sortedCandidates.length > 1
      )
      setPhotoHasAnalyzed(true)
    } catch {
      if (photoRunId.current !== runId) return

      setPhotoResults([])
      setPhotoError('searchError')
      setPhotoPhase('idle')
      setPhotoStep('idle')
      setPhotoHasAnalyzed(true)
    }
  }

  async function handleIdentifyPhoto() {
    if (!photoFile || photoPhase !== 'idle') return

    const runId = photoRunId.current + 1
    photoRunId.current = runId
    setPhotoPhase('ocr')
    setPhotoStep('reading')
    setPhotoProgress(0)
    setPhotoError('')
    setPhotoMessage('')
    setPhotoResults([])
    setSelectedPhotoCardId('')
    setPhotoHasAnalyzed(false)
    setShowPhotoCorrections(false)
    setShowOtherPhotoMatches(false)

    try {
      const worker = await getPhotoOcrWorker()

      if (photoRunId.current !== runId) return

      const fields = await readPhotoFields(
        worker,
        photoFile,
        runId,
        photoCrop
      )

      if (photoRunId.current !== runId || !fields) return

      setPhotoFields(fields)
      await searchPhotoCandidates(fields, runId)
    } catch (error) {
      if (photoRunId.current !== runId) return

      const errorKey = error instanceof Error &&
          error.message === 'photoTooDistant'
        ? 'photoTooDistant'
        : 'ocrError'

      if (errorKey === 'ocrError') releasePhotoWorker()
      setPhotoError(errorKey)
      setPhotoPhase('idle')
      setPhotoStep('idle')
      setPhotoHasAnalyzed(true)
    }
  }

  function handleRepeatPhotoSearch(event) {
    event.preventDefault()

    if (photoPhase !== 'idle') return

    const runId = photoRunId.current + 1
    photoRunId.current = runId
    setShowOtherPhotoMatches(false)
    void searchPhotoCandidates(photoFields, runId)
  }

  async function handleAddPhotoCard() {
    if (photoAdding) return

    const selectedCard = photoResults.find(
      (card) => card.id === selectedPhotoCardId
    )
    const quantity = Number(photoQuantity)

    if (!selectedCard) {
      setPhotoError('selectResult')
      return
    }

    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      setPhotoError('invalidQuantity')
      return
    }

    if (!window.confirm(
      texts.photoIdentification.confirmAdd(selectedCard.name, quantity)
    )) {
      return
    }

    setPhotoAdding(true)
    setPhotoError('')
    setPhotoMessage('')

    try {
      const savedCard = await addCardToCollection(selectedCard.id, quantity)

      collectionRevision.current += 1
      setCollectionRefresh((current) => current + 1)
      setCards((current) => {
        const existingCard = current.find(
          (item) => item.cardId === selectedCard.id
        )

        if (existingCard) {
          return current.map((item) =>
            item.cardId === selectedCard.id
              ? { ...item, quantity: savedCard.quantity }
              : item
          )
        }

        return [
          {
            ...savedCard,
            forTrade: false,
            details: selectedCard
          },
          ...current
        ]
      })

      setPhotoMessage({
        name: selectedCard.name,
        quantity: savedCard.quantity
      })
    } catch {
      setPhotoError('addError')
    } finally {
      setPhotoAdding(false)
    }
  }

async function handleQuantityChange(item, newQuantity) {
  if (busyId !== null || busyTradeId !== null || newQuantity < 1) return

  setBusyId(item.id)
  setActionError('')

  try {
    const updated = await updateCollectionQuantity(
      item.id,
      newQuantity
    )

    collectionRevision.current += 1
    setCollectionTotalQuantity((current) =>
      Math.max(0, current + updated.quantity - item.quantity)
    )
    setCards((current) =>
      current.map((card) =>
        card.id === item.id
          ? { ...card, quantity: updated.quantity }
          : card
      )
    )
  } catch {
    setActionError('updateError')
  } finally {
    setBusyId(null)
  }
}

async function handleCreateTag(event) {
  event.preventDefault()

  const text = newTagName.trim().replace(/\s+/g, ' ')
  const name = [newTagEmoji, text].filter(Boolean).join(' ')
  if (!name || tagBusyKey) return

  setTagBusyKey('create')
  setTagMessage('')

  try {
    const created = await createTag(name)
    setTags((current) => [...current, created].sort((first, second) =>
      first.name.localeCompare(second.name, language, { sensitivity: 'base' })
    ))
    setNewTagName('')
    setNewTagEmoji('')
    setTagMessage('created')
  } catch (error) {
    setTagMessage(error.status === 409 ? 'duplicate' : 'createError')
  } finally {
    setTagBusyKey('')
  }
}

async function handleDeleteTag(tag) {
  if (tagBusyKey) return
  if (!window.confirm(texts.tags.confirmDelete(tag.name))) return

  setTagBusyKey(`delete:${tag.id}`)
  setTagMessage('')

  try {
    await deleteTag(tag.id)
    setTags((current) => current.filter((item) => item.id !== tag.id))
    setCollectionTagFilter((current) =>
      current === String(tag.id) ? 'all' : current
    )
    setCardTagIds((current) => Object.fromEntries(
      Object.entries(current).map(([cardId, tagIds]) => [
        cardId,
        tagIds.filter((tagId) => tagId !== tag.id)
      ])
    ))
    setTagMessage('deleted')
  } catch {
    setTagMessage('deleteError')
  } finally {
    setTagBusyKey('')
  }
}

async function handleCardTagChange(item, tagId, checked) {
  const busyKey = `card:${item.id}:${tagId}`
  if (tagBusyKey) return

  setTagBusyKey(busyKey)
  setTagMessage('')

  try {
    if (checked) {
      await assignTagToCard(item.id, tagId)
    } else {
      await removeTagFromCard(item.id, tagId)
    }

    setCardTagIds((current) => {
      const key = String(item.id)
      const currentIds = current[key] ?? []
      const nextIds = checked
        ? [...new Set([...currentIds, tagId])]
        : currentIds.filter((currentTagId) => currentTagId !== tagId)

      return { ...current, [key]: nextIds }
    })
  } catch {
    setTagMessage('assignmentError')
  } finally {
    setTagBusyKey('')
  }
}


async function handleDelete(item) {
  if (busyId !== null || busyTradeId !== null) return

  const cardName = item.details?.name || texts.collection.cardFallback(item.cardId)
  const confirmed = window.confirm(texts.collection.confirmDelete(cardName))

  if (!confirmed) return

  setBusyId(item.id)
  setActionError('')

  try {
    await deleteCollectionCard(item.id)

    collectionRevision.current += 1
    setCollectionRefresh((current) => current + 1)
    setCards((current) =>
      current.filter((card) => card.id !== item.id)
    )
  } catch {
    setActionError('deleteError')
  } finally {
    setBusyId(null)
  }
}

async function handleTradeChange(item, forTrade) {
  if (busyTradeId !== null || busyId !== null) return

  setBusyTradeId(item.id)
  setActionError('')

  try {
    const updated = await updateCardTradeStatus(item.id, forTrade)

    collectionRevision.current += 1
    setCards((current) =>
      current.map((card) =>
        card.id === item.id
          ? { ...card, forTrade: updated.forTrade }
          : card
      )
    )
  } catch {
    setActionError('tradeUpdateError')
  } finally {
    setBusyTradeId(null)
  }
}

async function handleDirectCardSearch(event) {
  event.preventDefault()

  const query = addCardSearch.trim()
  if (!query || addCardSearching) return

  setAddCardSearching(true)
  setAddCardHasSearched(true)
  setAddCardSearchError(false)
  setAddCardMessage(null)

  try {
    const results = await getCards(query, 1, language)
    const limitedResults = (Array.isArray(results) ? results : []).slice(0, 8)
    const completeResults = await Promise.all(
      limitedResults.map(async (card) => {
        try {
          return await getCardById(card.id, language) ?? card
        } catch {
          return card
        }
      })
    )

    setAddCardResults(completeResults)
    setAddCardResultsLanguage(language)
  } catch {
    setAddCardResults([])
    setAddCardSearchError(true)
  } finally {
    setAddCardSearching(false)
  }
}

async function handleAddDirectCard(card) {
  if (addingCardId !== null) return

  setAddingCardId(card.id)
  setAddCardMessage(null)

  try {
    const savedCard = await addCardToCollection(card.id, 1)

    collectionRevision.current += 1
    setCollectionRefresh((current) => current + 1)
    setCards((current) => {
      const existingCard = current.find((item) => item.cardId === card.id)

      if (existingCard) {
        return current.map((item) =>
          item.cardId === card.id
            ? { ...item, quantity: savedCard.quantity, details: card }
            : item
        )
      }

      return [
        { ...savedCard, forTrade: false, details: card },
        ...current
      ]
    })
    setAddCardMessage({
      type: 'success',
      name: card.name || card.id,
      quantity: savedCard.quantity
    })
  } catch {
    setAddCardMessage({ type: 'error' })
  } finally {
    setAddingCardId(null)
  }
}

async function handleAddMissingCard(card) {
  if (addingMissingCardId !== null) return

  setAddingMissingCardId(card.id)
  setSetFeedback(null)

  try {
    const savedCard = await addCardToCollection(card.id, 1)

    collectionRevision.current += 1
    setCollectionRefresh((current) => current + 1)
    setCards((current) => {
      const existingCard = current.find(
        (item) => item.cardId === card.id
      )

      if (existingCard) {
        return current.map((item) =>
          item.cardId === card.id
            ? { ...item, quantity: savedCard.quantity }
            : item
        )
      }

      return [
        {
          ...savedCard,
          forTrade: false,
          details: card
        },
        ...current
      ]
    })

    setSetFeedback({
      type: 'success',
      name: card.name,
      quantity: savedCard.quantity
    })
  } catch {
    setSetFeedback({ type: 'error' })
  } finally {
    setAddingMissingCardId(null)
  }
}

async function loadAllMissingPage(reset = false) {
  if (allMissingLoading && !reset) return

  const runId = allMissingRunId.current + 1
  allMissingRunId.current = runId
  const startingPages = reset ? [] : allMissingPages
  const startingPending = reset ? [] : allMissingPending
  const startingCursors = reset ? { es: 1, en: 1 } : allMissingCursors
  const startingExhausted = reset
    ? { es: false, en: false }
    : allMissingExhausted
  const seenIds = new Set(
    startingPages.flatMap((page) => page.map((card) => card.id))
  )
  const ownedIds = new Set(cards.map((card) => card.cardId))

  setAllMissingLoading(true)
  setAllMissingError(false)

  if (reset) {
    setAllMissingPages([])
    setAllMissingPending([])
    setAllMissingPageIndex(0)
    setAllMissingCursors({ es: 1, en: 1 })
    setAllMissingExhausted({ es: false, en: false })
  }

  try {
    const result = await scanMissingCatalogPage({
      search: allMissingSearch,
      preferredLanguage: language,
      cursors: startingCursors,
      exhausted: startingExhausted,
      ownedIds,
      seenIds,
      pendingCards: startingPending
    })

    if (allMissingRunId.current !== runId) return

    const nextPages = result.cards.length > 0
      ? [...startingPages, result.cards]
      : startingPages

    setAllMissingPages(nextPages)
    setAllMissingPending(result.pendingCards)
    setAllMissingPageIndex(Math.max(0, nextPages.length - 1))
    setAllMissingCursors(result.cursors)
    setAllMissingExhausted(result.exhausted)
  } catch {
    if (allMissingRunId.current === runId) setAllMissingError(true)
  } finally {
    if (allMissingRunId.current === runId) setAllMissingLoading(false)
  }
}

function handleAllMissingSearch(event) {
  event.preventDefault()
  const query = allMissingSearchInput.trim()

  if (query === allMissingSearch) {
    void loadAllMissingPage(true)
  } else {
    setAllMissingSearch(query)
  }
}

function handleTransactionCardSearch(event) {
  event.preventDefault()

  const query = transactionCardSearch.trim()
  if (!query || transactionSearching) return

  setTransactionSearchPage(1)

  if (query === transactionActiveSearch) {
    setTransactionSearchRefresh((current) => current + 1)
  } else {
    setTransactionActiveSearch(query)
  }
}

async function handleTransactionSubmit(event) {
  event.preventDefault()

  if (transactionSaving) return

  const quantity = Number(transactionQuantity)
  const unitPrice = Number(transactionUnitPrice)
  const normalizedNotes = transactionNotes.trim()

  if (
    !transactionSelectedCard ||
    transactionSelectedCard.id !== transactionCardId
  ) {
    setTransactionMessage('cardRequired')
    return
  }

  if (transactionType !== 'purchase' && transactionType !== 'sale') {
    setTransactionMessage('typeInvalid')
    return
  }

  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    setTransactionMessage('quantityInvalid')
    return
  }

  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
    setTransactionMessage('unitPriceInvalid')
    return
  }

  if (!Number.isSafeInteger(quantity * unitPrice)) {
    setTransactionMessage('totalInvalid')
    return
  }

  if (!isValidDateValue(transactionDate)) {
    setTransactionMessage('dateInvalid')
    return
  }

  if (normalizedNotes.length > 250) {
    setTransactionMessage('notesTooLong')
    return
  }

  setTransactionSaving(true)
  setTransactionMessage('')

  try {
    await createTransaction({
      cardId: transactionCardId,
      transactionType,
      quantity,
      unitPrice,
      transactionDate,
      notes: normalizedNotes || null
    })

    setTransactionCardDetails((current) => ({
      ...current,
      [transactionCardId]: transactionSelectedCard
    }))
    setTransactionsPage(1)
    setTransactionsRefresh((current) => current + 1)
    setTransactionCardId('')
    setTransactionSelectedCard(null)
    setTransactionCardSearch('')
    setTransactionActiveSearch('')
    setTransactionSearchResults([])
    setTransactionSearchPage(1)
    setTransactionSearchHasMore(false)
    setTransactionHasSearched(false)
    setTransactionType('purchase')
    setTransactionQuantity('1')
    setTransactionUnitPrice('0')
    setTransactionDate(getLocalDateValue())
    setTransactionNotes('')
    setTransactionMessage('success')
  } catch (error) {
    setTransactionMessage(
      error.status === 404
        ? 'cardNotFound'
        : error.status === 502
          ? 'catalogUnavailable'
          : 'saveError'
    )
  } finally {
    setTransactionSaving(false)
  }
}

  const totalCards = collectionTotalQuantity
  const collectionHasCards = collectionOverallTotal === null
    ? collectionTotal > 0
    : collectionOverallTotal > 0
  const collectionCollator = new Intl.Collator(language, {
    sensitivity: 'base',
    numeric: true
  })
  const collectionRarities = [...new Set(
    cards.map((card) => card.details?.rarity).filter(Boolean)
  )].sort(collectionCollator.compare)
  const collectionSetOptions = [...new Map(
    cards
      .filter((card) => card.details?.set?.name)
      .map((card) => {
        const set = card.details.set
        const value = set.id || set.name
        return [value, { value, name: set.name }]
      })
  ).values()].sort((first, second) =>
    collectionCollator.compare(first.name, second.name)
  )
  const filteredCollectionCards = cards
  const visibleCards = filteredCollectionCards
  const currentAllMissingCards = allMissingPages[allMissingPageIndex] ?? []
  const canLoadMoreMissing = allMissingPageIndex < allMissingPages.length - 1 ||
    allMissingPending.length > 0 ||
    !allMissingExhausted.es ||
    !allMissingExhausted.en
  const ownedCardIds = new Set(
    collectionSummaryIds
  )
  const officialSetCards = Array.isArray(setDetails?.cards)
    ? setDetails.cards.filter(
        (card) => typeof card?.id === 'string'
      )
    : []
  const ownedSetCards = officialSetCards.filter(
    (card) => ownedCardIds.has(card.id)
  )
  const missingSetCards = officialSetCards.filter(
    (card) => !ownedCardIds.has(card.id)
  )
  const completionPercentage = officialSetCards.length > 0
    ? Math.round(
        (ownedSetCards.length / officialSetCards.length) * 100
      )
    : 0
  const filteredSetCards = setFilter === 'owned'
    ? ownedSetCards
    : setFilter === 'missing'
      ? missingSetCards
      : officialSetCards
  const previewQuantity = Number(transactionQuantity)
  const previewUnitPrice = Number(transactionUnitPrice)
  const transactionPreviewTotal =
    Number.isSafeInteger(previewQuantity) &&
    Number.isSafeInteger(previewUnitPrice) &&
    previewQuantity > 0 &&
    previewUnitPrice >= 0 &&
    Number.isSafeInteger(previewQuantity * previewUnitPrice)
      ? previewQuantity * previewUnitPrice
      : 0
  return (
    <section className={view === 'history' ? 'history-page' : 'collection'}>
      <h2>
        {view === 'history'
          ? texts.transactions.title
          : texts.collection.title}
      </h2>

      {view === 'collection' && (
        <div
          className="collection-tabs"
          role="tablist"
          aria-label={texts.collection.tabsLabel}
        >
          {[
            ['cards', texts.collection.myCardsTab],
            ['missing', texts.collection.missingTab],
            ['trade', texts.collection.tradeTab]
          ].map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              className={activeCollectionTab === tab ? 'is-active' : ''}
              aria-selected={activeCollectionTab === tab}
              onClick={() => {
                setActiveCollectionTab(tab)
                setCollectionPage(1)
                if (tab !== 'cards') {
                  setAddCardPanelOpen(false)
                  handleClosePhotoPanel()
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {view === 'collection' && activeCollectionTab === 'cards' && (
        <div className="collection-actions">
          <button
            type="button"
            aria-expanded={addCardPanelOpen}
            onClick={() => {
              setAddCardPanelOpen((current) => !current)
              setAddCardMessage(null)
            }}
          >
            {addCardPanelOpen
              ? texts.collection.closeAddCard
              : texts.collection.addCard}
          </button>
          <button
            type="button"
            aria-expanded={photoPanelOpen}
            onClick={photoPanelOpen
              ? handleClosePhotoPanel
              : handleOpenPhotoPanel}
          >
            {photoPanelOpen
              ? texts.photoIdentification.close
              : texts.photoIdentification.open}
          </button>
          <button
            type="button"
            aria-expanded={manageTagsOpen}
            onClick={() => {
              setManageTagsOpen((current) => !current)
              setTagMessage('')
            }}
          >
            {manageTagsOpen ? texts.tags.close : texts.tags.manage}
          </button>
        </div>
      )}

      {view === 'collection' &&
        activeCollectionTab === 'cards' &&
        manageTagsOpen && (
        <section className="tag-manager" aria-labelledby="tag-manager-title">
          <h3 id="tag-manager-title">{texts.tags.title}</h3>

          <form onSubmit={handleCreateTag}>
            <span className="tag-emoji-label">{texts.tags.chooseEmoji}</span>
            <div
              className="tag-emoji-picker"
              role="group"
              aria-label={texts.tags.chooseEmoji}
            >
              {TAG_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={newTagEmoji === emoji ? 'is-selected' : ''}
                  aria-pressed={newTagEmoji === emoji}
                  aria-label={texts.tags.emojiOption(emoji)}
                  disabled={Boolean(tagBusyKey)}
                  onClick={() => setNewTagEmoji((current) =>
                    current === emoji ? '' : emoji
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <label htmlFor="new-tag-name">{texts.tags.nameLabel}</label>
            <div>
              <input
                id="new-tag-name"
                value={newTagName}
                maxLength="36"
                placeholder={texts.tags.namePlaceholder}
                disabled={Boolean(tagBusyKey)}
                onChange={(event) => setNewTagName(event.target.value)}
              />
              <button type="submit" disabled={!newTagName.trim() || Boolean(tagBusyKey)}>
                {tagBusyKey === 'create' ? texts.tags.creating : texts.tags.create}
              </button>
            </div>
          </form>

          {tagsLoading && <p role="status">{texts.tags.loading}</p>}
          {tagsError && <p role="alert">{texts.tags.loadError}</p>}
          {!tagsLoading && !tagsError && tags.length === 0 && (
            <p>{texts.tags.empty}</p>
          )}
          {tags.length > 0 && (
            <ul className="tag-manager-list">
              {tags.map((tag) => (
                <li key={tag.id}>
                  <span className="tag-chip">{tag.name}</span>
                  <button
                    type="button"
                    disabled={Boolean(tagBusyKey)}
                    onClick={() => handleDeleteTag(tag)}
                  >
                    {tagBusyKey === `delete:${tag.id}`
                      ? texts.tags.deleting
                      : texts.tags.delete}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {tagMessage && (
            <p role={tagMessage.endsWith('Error') || tagMessage === 'duplicate' ? 'alert' : 'status'}>
              {texts.tags[tagMessage]}
            </p>
          )}
        </section>
      )}

      {view === 'collection' &&
        activeCollectionTab === 'cards' &&
        !manageTagsOpen &&
        tagMessage && (
        <p role={tagMessage.endsWith('Error') || tagMessage === 'duplicate' ? 'alert' : 'status'}>
          {texts.tags[tagMessage]}
        </p>
      )}

      {view === 'collection' &&
        activeCollectionTab === 'cards' &&
        addCardPanelOpen && (
        <section
          className="direct-card-add"
          aria-labelledby="direct-card-add-title"
        >
          <h3 id="direct-card-add-title">
            {texts.collection.addCardTitle}
          </h3>
          <form onSubmit={handleDirectCardSearch}>
            <label htmlFor="direct-card-search">
              {texts.collection.searchCardLabel}
            </label>
            <div>
              <input
                id="direct-card-search"
                type="search"
                value={addCardSearch}
                placeholder={texts.collection.searchCardPlaceholder}
                onChange={(event) => {
                  setAddCardSearch(event.target.value)
                  setAddCardHasSearched(false)
                }}
                disabled={addCardSearching}
                required
              />
              <button type="submit" disabled={addCardSearching}>
                {addCardSearching
                  ? texts.collection.searchingCards
                  : texts.collection.searchCard}
              </button>
            </div>
          </form>

          {addCardSearchError && (
            <p role="alert">{texts.collection.searchCardsError}</p>
          )}

          {addCardMessage && (
            <p role={addCardMessage.type === 'error' ? 'alert' : 'status'}>
              {addCardMessage.type === 'error'
                ? texts.collection.addCardError
                : texts.collection.cardAdded(
                    addCardMessage.name,
                    addCardMessage.quantity
                  )}
            </p>
          )}

          {!addCardSearching &&
            !addCardSearchError &&
            addCardHasSearched &&
            addCardResults.length === 0 && (
            <p>{texts.collection.noSearchResults}</p>
          )}

          {addCardResultsLanguage === language &&
            addCardResults.length > 0 && (
            <div className="pokemon-grid direct-card-results">
              {addCardResults.map((card) => (
                <PokemonCard
                  key={card.id}
                  card={card}
                  onAdd={handleAddDirectCard}
                  adding={addingCardId === card.id}
                  texts={texts}
                  language={language}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {view === 'collection' &&
        activeCollectionTab === 'cards' &&
        photoPanelOpen && (
        <div className="photo-identification">
          <section
            className="photo-identification-panel"
            aria-labelledby="photo-identification-title"
          >
            <div className="photo-identification-heading">
              <div>
                <h3 id="photo-identification-title">
                  {texts.photoIdentification.title}
                </h3>
                <p>{texts.photoIdentification.description}</p>
              </div>
              <button type="button" onClick={handleClosePhotoPanel}>
                {texts.photoIdentification.close}
              </button>
            </div>

            <label htmlFor="card-photo">
              {texts.photoIdentification.fileLabel}
            </label>
            <input
              id="card-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={photoPhase !== 'idle'}
              onChange={handlePhotoFileChange}
            />
            <small>{texts.photoIdentification.fileHelp}</small>

            {photoPreviewUrl && (
              <>
                <div className="photo-preview-frame">
                  <img
                    src={photoPreviewUrl}
                    alt={texts.photoIdentification.previewAlt}
                    className="photo-identification-preview"
                  />
                  {photoCrop && (
                    <span
                      className="photo-crop-outline"
                      aria-hidden="true"
                      style={{
                        left: `${photoCrop.left}%`,
                        top: `${photoCrop.top}%`,
                        width: `${photoCrop.right - photoCrop.left}%`,
                        height: `${photoCrop.bottom - photoCrop.top}%`
                      }}
                    />
                  )}
                </div>

                <button
                  type="button"
                  className="photo-secondary-button photo-crop-toggle"
                  aria-expanded={showPhotoCrop}
                  onClick={() => setShowPhotoCrop((current) => !current)}
                >
                  {showPhotoCrop
                    ? texts.photoIdentification.hideFraming
                    : texts.photoIdentification.adjustFraming}
                </button>

                {showPhotoCrop && photoCrop && (
                  <div className="photo-crop-controls">
                    <p>{texts.photoIdentification.framingHelp}</p>

                    {[
                      ['left', texts.photoIdentification.cropLeft, 0, 80],
                      ['right', texts.photoIdentification.cropRight, 20, 100],
                      ['top', texts.photoIdentification.cropTop, 0, 80],
                      ['bottom', texts.photoIdentification.cropBottom, 20, 100]
                    ].map(([edge, label, min, max]) => (
                      <label key={edge}>
                        <span>{label}</span>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step="1"
                          value={photoCrop[edge]}
                          disabled={photoPhase !== 'idle'}
                          onChange={(event) =>
                            handlePhotoCropChange(edge, event.target.value)
                          }
                        />
                      </label>
                    ))}

                    <button
                      type="button"
                      className="photo-secondary-button"
                      disabled={photoPhase !== 'idle'}
                      onClick={handleResetPhotoCrop}
                    >
                      {texts.photoIdentification.resetFraming}
                    </button>
                  </div>
                )}

              </>
            )}

            <button
              type="button"
              className="photo-identification-action"
              disabled={!photoFile || photoPhase !== 'idle'}
              onClick={handleIdentifyPhoto}
            >
              {texts.photoIdentification.identify}
            </button>

            {photoPhase === 'ocr' && (
              <div className="photo-identification-progress" role="status">
                <progress value={photoProgress} max="100" />
                <span>
                  {photoStep === 'identifying'
                    ? texts.photoIdentification.identifyingDetails
                    : texts.photoIdentification.readingPhoto(photoProgress)}
                </span>
              </div>
            )}

            {photoPhase === 'searching' && (
              <p role="status">{texts.photoIdentification.searching}</p>
            )}

            {photoStep === 'found' && photoResults.length > 0 && (
              <p role="status" className="photo-match-status">
                {texts.photoIdentification.matchFound}
              </p>
            )}

            {photoStep === 'review' && photoResults.length > 0 && (
              <p role="status">
                {texts.photoIdentification.reviewCandidates}
              </p>
            )}

            {photoHasAnalyzed && photoPhase === 'idle' && (
              <div className="photo-secondary-actions">
                <button
                  type="button"
                  className="photo-secondary-button"
                  aria-expanded={showPhotoCorrections}
                  onClick={() =>
                    setShowPhotoCorrections((current) => !current)
                  }
                >
                  {showPhotoCorrections
                    ? texts.photoIdentification.hideCorrections
                    : texts.photoIdentification.correctData}
                </button>
              </div>
            )}

            {photoFile && showPhotoCorrections && (
              <form
                className="photo-detected-fields"
                onSubmit={handleRepeatPhotoSearch}
              >
                <h4>{texts.photoIdentification.detectedFields}</h4>

                <label htmlFor="photo-card-name">
                  {texts.photoIdentification.nameLabel}
                </label>
                <input
                  id="photo-card-name"
                  type="text"
                  value={photoFields.name}
                  maxLength={80}
                  disabled={photoPhase !== 'idle'}
                  onChange={(event) =>
                    setPhotoFields((current) => ({
                      ...current,
                      name: event.target.value,
                      nameAlternatives: []
                    }))
                  }
                />

                <label htmlFor="photo-card-number">
                  {texts.photoIdentification.numberLabel}
                </label>
                <input
                  id="photo-card-number"
                  type="text"
                  value={photoFields.number}
                  maxLength={30}
                  disabled={photoPhase !== 'idle'}
                  onChange={(event) =>
                    setPhotoFields((current) => ({
                      ...current,
                      number: event.target.value
                    }))
                  }
                />

                <label htmlFor="photo-card-total">
                  {texts.photoIdentification.totalLabel}
                </label>
                <input
                  id="photo-card-total"
                  type="text"
                  value={photoFields.total}
                  maxLength={30}
                  disabled={photoPhase !== 'idle'}
                  onChange={(event) =>
                    setPhotoFields((current) => ({
                      ...current,
                      total: event.target.value
                    }))
                  }
                />

                <label htmlFor="photo-card-hp">
                  {texts.photoIdentification.hpLabel}
                </label>
                <input
                  id="photo-card-hp"
                  type="text"
                  inputMode="numeric"
                  value={photoFields.hp}
                  maxLength={3}
                  disabled={photoPhase !== 'idle'}
                  onChange={(event) =>
                    setPhotoFields((current) => ({
                      ...current,
                      hp: event.target.value
                    }))
                  }
                />

                <label htmlFor="photo-card-expansion">
                  {texts.photoIdentification.expansionLabel}
                </label>
                <input
                  id="photo-card-expansion"
                  type="text"
                  value={photoFields.expansion}
                  maxLength={80}
                  disabled={photoPhase !== 'idle'}
                  onChange={(event) =>
                    setPhotoFields((current) => ({
                      ...current,
                      expansion: event.target.value
                    }))
                  }
                />

                <button type="submit" disabled={photoPhase !== 'idle'}>
                  {texts.photoIdentification.searchAgain}
                </button>
              </form>
            )}

            {photoError && (
              <p role="alert">{texts.photoIdentification[photoError]}</p>
            )}

            {photoResults.length > 0 && (
              <div className="photo-results">
                <h4>
                  {showOtherPhotoMatches
                    ? texts.photoIdentification.results
                    : texts.photoIdentification.bestMatch}
                </h4>
                <div className="photo-results-grid">
                  {(showOtherPhotoMatches
                    ? photoResults
                    : photoResults.slice(0, 1)
                  ).map((card) => {
                    const savedImageState = photoImageStates[card.id]
                    const imageState =
                      savedImageState?.language === card.sourceLanguage
                        ? savedImageState
                        : null
                    const imageUrl = imageState
                      ? imageState.urls[imageState.index] ?? null
                      : getCardImageUrls(card.image)[0] ?? null
                    const selected = selectedPhotoCardId === card.id

                    return (
                      <label
                        key={card.id}
                        className={`photo-result${selected ? ' is-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="photo-card-result"
                          value={card.id}
                          checked={selected}
                          onChange={() => setSelectedPhotoCardId(card.id)}
                        />

                        {imageUrl && !imageState?.unavailable ? (
                          <img
                            src={imageUrl}
                            alt={texts.card.imageAlt(card.name)}
                            loading="lazy"
                            onError={() => handlePhotoImageError(card)}
                          />
                        ) : (
                          <div className="photo-result-placeholder">
                            {texts.card.noImage}
                          </div>
                        )}

                        <strong>{card.name}</strong>
                        <span>
                          {texts.photoIdentification.resultExpansion(
                            card.set?.name || texts.card.unavailable
                          )}
                        </span>
                        <span>
                          {texts.photoIdentification.resultNumber(
                            card.localId || texts.card.unavailable,
                            card.set?.cardCount?.official
                          )}
                        </span>
                        {card.hp && (
                          <span>
                            {texts.photoIdentification.resultHp(card.hp)}
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>

                {photoResults.length > 1 && (
                  <button
                    type="button"
                    className="photo-secondary-button photo-other-matches"
                    aria-expanded={showOtherPhotoMatches}
                    onClick={() =>
                      setShowOtherPhotoMatches((current) => !current)
                    }
                  >
                    {showOtherPhotoMatches
                      ? texts.photoIdentification.hideOtherMatches
                      : texts.photoIdentification.viewOtherMatches}
                  </button>
                )}

                <div className="photo-confirmation">
                  <label htmlFor="photo-card-quantity">
                    {texts.photoIdentification.quantityLabel}
                  </label>
                  <input
                    id="photo-card-quantity"
                    type="number"
                    min="1"
                    max="99"
                    step="1"
                    value={photoQuantity}
                    disabled={photoAdding}
                    onChange={(event) => setPhotoQuantity(event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={!selectedPhotoCardId || photoAdding}
                    onClick={handleAddPhotoCard}
                  >
                    {photoAdding
                      ? texts.photoIdentification.adding
                      : texts.photoIdentification.confirm}
                  </button>
                </div>
              </div>
            )}

            {photoMessage && (
              <p role="status">
                {texts.photoIdentification.added(
                  photoMessage.name,
                  photoMessage.quantity
                )}
              </p>
            )}

            {(
              photoError === 'noMatches' ||
              photoError === 'insufficientData' ||
              photoError === 'photoTooDistant'
            ) && (
              <Link to="/catalog">{texts.photoIdentification.manualSearch}</Link>
            )}
          </section>
        </div>
      )}

      {view === 'collection' && actionError && (
        <p role="alert">{texts.collection[actionError]}</p>
      )}

      {view === 'collection' && loading && (
        <p role="status">{texts.collection.loading}</p>
      )}

      {view === 'collection' && error && (
        <p role="alert">
          {texts.collection.serviceError(error, texts.collection.loadError)}
        </p>
      )}

      {view === 'collection' &&
        activeCollectionTab === 'cards' &&
        !loading &&
        !error &&
        !collectionHasCards && (
        <div className="empty-collection">
          <h3>{texts.collection.emptyTitle}</h3>
          <p>{texts.collection.emptyText}</p>
          <Link to="/catalog">{texts.collection.explore}</Link>
        </div>
      )}

      {view === 'collection' &&
        activeCollectionTab === 'trade' &&
        !loading &&
        !error &&
        collectionTotal === 0 && (
        <p className="trade-filter-empty">
          {texts.collection.noTradeCards}
        </p>
      )}

      {view === 'collection' &&
        (activeCollectionTab === 'cards' || activeCollectionTab === 'trade') &&
        !loading &&
        !error &&
        collectionHasCards &&
        (activeCollectionTab === 'cards' || collectionTotal > 0) && (
        <>
          {activeCollectionTab === 'cards' && (
            <div className="collection-toolbar">
              <label>
                <span>{texts.collectionFilters.search}</span>
                <input
                  type="search"
                  value={collectionSearch}
                  placeholder={texts.collectionFilters.searchPlaceholder}
                  onChange={(event) => {
                    setCollectionPage(1)
                    setCollectionSearch(event.target.value)
                  }}
                />
              </label>

              <label>
                <span>{texts.collectionFilters.sort}</span>
                <select
                  value={collectionSort}
                  onChange={(event) => {
                    setCollectionPage(1)
                    setCollectionSort(event.target.value)
                  }}
                >
                  <option value="name-asc">{texts.collectionFilters.nameAsc}</option>
                  <option value="name-desc">{texts.collectionFilters.nameDesc}</option>
                  <option value="quantity-desc">{texts.collectionFilters.quantityDesc}</option>
                  <option value="quantity-asc">{texts.collectionFilters.quantityAsc}</option>
                  <option value="rarity">{texts.collectionFilters.rarity}</option>
                  <option value="set">{texts.collectionFilters.expansion}</option>
                </select>
              </label>

              <label>
                <span>{texts.collectionFilters.tag}</span>
                <select
                  value={collectionTagFilter}
                  onChange={(event) => {
                    setCollectionPage(1)
                    setCollectionTagFilter(event.target.value)
                  }}
                >
                  <option value="all">{texts.collectionFilters.allTags}</option>
                  <option value="none">{texts.collectionFilters.withoutTags}</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>{tag.name}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>{texts.collectionFilters.rarity}</span>
                <select
                  value={collectionRarityFilter}
                  onChange={(event) => {
                    setCollectionPage(1)
                    setCollectionRarityFilter(event.target.value)
                  }}
                >
                  <option value="all">{texts.collectionFilters.allRarities}</option>
                  {collectionRarities.map((rarity) => (
                    <option key={rarity} value={rarity}>{rarity}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>{texts.collectionFilters.expansion}</span>
                <select
                  value={collectionSetFilter}
                  onChange={(event) => {
                    setCollectionPage(1)
                    setCollectionSetFilter(event.target.value)
                  }}
                >
                  <option value="all">{texts.collectionFilters.allExpansions}</option>
                  {collectionSetOptions.map((set) => (
                    <option key={set.value} value={set.value}>{set.name}</option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => {
                  setCollectionPage(1)
                  setCollectionSearch('')
                  setCollectionSort('name-asc')
                  setCollectionTagFilter('all')
                  setCollectionRarityFilter('all')
                  setCollectionSetFilter('all')
                }}
              >
                {texts.collectionFilters.reset}
              </button>
            </div>
          )}

          <p>{texts.collection.total(totalCards, collectionTotal)}</p>

          {visibleCards.length === 0 ? (
            <p className="trade-filter-empty">
              {activeCollectionTab === 'trade'
                ? texts.collection.noTradeCards
                : texts.collectionFilters.noResults}
            </p>
          ) : (
          <div className="collection-grid">
            {visibleCards.map((item) => {
              const details = item.details ?? {
                id: item.cardId,
                name: texts.collection.cardFallback(item.cardId),
                localId: '—',
                image: null
              }

              return (
              <article
                key={item.id}
                className={`collection-item${item.forTrade ? ' collection-item--for-trade' : ''}`}
              >
                {(cardTagIds[String(item.id)] ?? []).length > 0 && (
                  <div className="card-tag-chips" aria-label={texts.tags.assigned}>
                    {(cardTagIds[String(item.id)] ?? []).map((tagId) => {
                      const tag = tags.find((entry) => entry.id === tagId)
                      return tag ? <span key={tag.id}>{tag.name}</span> : null
                    })}
                  </div>
                )}

                <PokemonCard
                  card={details}
                  texts={texts}
                  language={language}
                />

                {activeCollectionTab === 'cards' && (
                  <div className="card-tag-editor">
                    <button
                      type="button"
                      className="tag-editor-toggle"
                      aria-expanded={editingTagsCardId === item.id}
                      onClick={() => setEditingTagsCardId((current) =>
                        current === item.id ? null : item.id
                      )}
                    >
                      {editingTagsCardId === item.id
                        ? texts.tags.hideEditor
                        : texts.tags.edit}
                    </button>

                    {editingTagsCardId === item.id && (
                      <div className="tag-checkboxes">
                        {tags.length === 0 ? (
                          <span>{texts.tags.noTags}</span>
                        ) : tags.map((tag) => (
                          <label key={tag.id}>
                            <input
                              type="checkbox"
                              checked={(cardTagIds[String(item.id)] ?? []).includes(tag.id)}
                              disabled={Boolean(tagBusyKey)}
                              onChange={(event) => handleCardTagChange(
                                item,
                                tag.id,
                                event.target.checked
                              )}
                            />
                            <span>{tag.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="trade-control">
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(item.forTrade)}
                      disabled={busyTradeId !== null || busyId !== null}
                      onChange={(event) =>
                        handleTradeChange(item, event.target.checked)
                      }
                    />
                    <span>{texts.collection.tradeAvailable}</span>
                  </label>
                </div>

                <div className="quantity-controls">
                  <button
                    type="button"
                    aria-label={texts.collection.decrease(details.name)}
                    disabled={busyId !== null || busyTradeId !== null || item.quantity <= 1}
                    onClick={() =>
                      handleQuantityChange(item, item.quantity - 1)
                    }
                  >
                    −
                  </button>

                  <span>{texts.collection.quantity(item.quantity)}</span>

                  <button
                    type="button"
                    aria-label={texts.collection.increase(details.name)}
                    disabled={busyId !== null || busyTradeId !== null}
                    onClick={() =>
                      handleQuantityChange(item, item.quantity + 1)
                    }
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  className="delete-card-button"
                  disabled={busyId !== null || busyTradeId !== null}
                  onClick={() => handleDelete(item)}
                >
                  {busyId === item.id ? texts.collection.saving : texts.collection.delete}
                </button>
              </article>
              )
            })}
           </div>
           )}

          {collectionTotalPages > 1 && (
            <nav
              className="transaction-pagination"
              aria-label={texts.collection.paginationLabel}
            >
              <button
                type="button"
                disabled={loading || collectionPage <= 1}
                onClick={() => setCollectionPage((current) =>
                  Math.max(1, current - 1)
                )}
              >
                {texts.collection.previous}
              </button>
              <span>
                {texts.collection.pageOf(
                  collectionPage,
                  collectionTotalPages
                )}
              </span>
              <button
                type="button"
                disabled={loading || collectionPage >= collectionTotalPages}
                onClick={() => setCollectionPage((current) =>
                  Math.min(collectionTotalPages, current + 1)
                )}
              >
                {texts.collection.next}
              </button>
            </nav>
          )}
         </>
       )}

       {view === 'collection' &&
        activeCollectionTab === 'missing' &&
        !loading &&
        !error && (
        <section
          className="set-completion"
          aria-labelledby="set-completion-title"
        >
          <h3 id="set-completion-title">{texts.setCompletion.title}</h3>
          <p>{texts.setCompletion.description}</p>

          <div className="missing-mode-tabs" role="tablist" aria-label={texts.setCompletion.modeLabel}>
            <button
              type="button"
              role="tab"
              className={missingMode === 'all' ? 'is-active' : ''}
              aria-selected={missingMode === 'all'}
              onClick={() => setMissingMode('all')}
            >
              {texts.setCompletion.allMissingMode}
            </button>
            <button
              type="button"
              role="tab"
              className={missingMode === 'set' ? 'is-active' : ''}
              aria-selected={missingMode === 'set'}
              onClick={() => setMissingMode('set')}
            >
              {texts.setCompletion.bySetMode}
            </button>
          </div>

          {missingMode === 'all' && (
            <div className="all-missing-cards">
              <form className="all-missing-search" onSubmit={handleAllMissingSearch}>
                <label htmlFor="all-missing-search">
                  {texts.setCompletion.searchCardLabel}
                </label>
                <div>
                  <input
                    id="all-missing-search"
                    type="search"
                    value={allMissingSearchInput}
                    placeholder={texts.setCompletion.searchCardPlaceholder}
                    disabled={allMissingLoading}
                    onChange={(event) => setAllMissingSearchInput(event.target.value)}
                  />
                  <button type="submit" disabled={allMissingLoading}>
                    {texts.setCompletion.search}
                  </button>
                  {(allMissingSearch || allMissingSearchInput) && (
                    <button
                      type="button"
                      disabled={allMissingLoading}
                      onClick={() => {
                        setAllMissingSearchInput('')
                        setAllMissingSearch('')
                      }}
                    >
                      {texts.setCompletion.clearSearch}
                    </button>
                  )}
                </div>
              </form>

              <p>{texts.setCompletion.allMissingHelp}</p>
              {allMissingLoading && currentAllMissingCards.length === 0 && (
                <p role="status">{texts.setCompletion.loadingMissing}</p>
              )}
              {allMissingError && (
                <p role="alert">{texts.setCompletion.loadMissingError}</p>
              )}
              {setFeedback && (
                <p role={setFeedback.type === 'error' ? 'alert' : 'status'}>
                  {setFeedback.type === 'error'
                    ? texts.setCompletion.addError
                    : texts.setCompletion.added(
                        setFeedback.name,
                        setFeedback.quantity
                      )}
                </p>
              )}

              {!allMissingLoading &&
                !allMissingError &&
                currentAllMissingCards.length === 0 && (
                <p>{texts.setCompletion.noMissingResults}</p>
              )}

              {currentAllMissingCards.length > 0 && (
                <div className="pokemon-grid set-card-grid">
                  {currentAllMissingCards.map((card) => (
                    <div key={card.id} className="set-card-item set-card-item--missing">
                      <PokemonCard
                        card={{
                          ...card,
                          name: card.name || card.id,
                          localId: card.localId || '—'
                        }}
                        onAdd={handleAddMissingCard}
                        adding={addingMissingCardId === card.id}
                        texts={texts}
                        language={card.sourceLanguage ?? language}
                      />
                    </div>
                  ))}
                </div>
              )}

              <nav className="missing-pagination" aria-label={texts.setCompletion.paginationLabel}>
                <button
                  type="button"
                  disabled={allMissingPageIndex === 0 || allMissingLoading}
                  onClick={() => setAllMissingPageIndex((current) => current - 1)}
                >
                  {texts.setCompletion.previous}
                </button>
                <span>{texts.setCompletion.page(allMissingPageIndex + 1)}</span>
                <button
                  type="button"
                  disabled={!canLoadMoreMissing || allMissingLoading}
                  onClick={() => {
                    if (allMissingPageIndex < allMissingPages.length - 1) {
                      setAllMissingPageIndex((current) => current + 1)
                    } else {
                      void loadAllMissingPage(false)
                    }
                  }}
                >
                  {allMissingLoading
                    ? texts.setCompletion.loadingMore
                    : texts.setCompletion.next}
                </button>
              </nav>
            </div>
          )}

          {missingMode === 'set' && (
            <>

          {setsLoading && (
            <p role="status">{texts.setCompletion.loadingSets}</p>
          )}

          {setsError && (
            <p role="alert">{texts.setCompletion.loadSetsError}</p>
          )}

          {!setsLoading && !setsError && (
            <div className="set-selector">
              <label htmlFor="collection-set">
                {texts.setCompletion.selectLabel}
              </label>
              <select
                id="collection-set"
                value={selectedSetId}
                onChange={(event) => {
                  setSelectedSetId(event.target.value)
                  setSetDetails(null)
                  setSetDetailsError('')
                  setSetFilter('all')
                  setSetFeedback(null)
                }}
              >
                <option value="">{texts.setCompletion.selectPlaceholder}</option>
                {sets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!setsLoading && !setsError && !selectedSetId && (
            <p>{texts.setCompletion.selectPrompt}</p>
          )}

          {selectedSetId && setDetailsLoading && (
            <p role="status">{texts.setCompletion.loadingSet}</p>
          )}

          {selectedSetId && setDetailsError && (
            <p role="alert">
              {setDetailsError === 'notFound'
                ? texts.setCompletion.setNotFound
                : texts.setCompletion.loadSetError}
            </p>
          )}

          {selectedSetId && setDetails && !setDetailsLoading && !setDetailsError && (
            <div className="set-details">
              <h4>{setDetails.name}</h4>

              {cards.length === 0 && officialSetCards.length > 0 && (
                <p>{texts.setCompletion.emptyCollection}</p>
              )}

              {officialSetCards.length === 0 ? (
                <p>{texts.setCompletion.emptySet}</p>
              ) : (
                <>
                  <div className="set-progress-summary">
                    <progress
                      value={ownedSetCards.length}
                      max={officialSetCards.length}
                      aria-label={texts.setCompletion.progressLabel(
                        setDetails.name,
                        completionPercentage
                      )}
                    />

                    <div className="set-progress-stats">
                      <span>{texts.setCompletion.totalCards(officialSetCards.length)}</span>
                      <span>{texts.setCompletion.ownedCards(ownedSetCards.length)}</span>
                      <span>{texts.setCompletion.missingCards(missingSetCards.length)}</span>
                      <strong>{texts.setCompletion.completion(completionPercentage)}</strong>
                    </div>
                  </div>

                  <div
                    className="set-filters"
                    role="group"
                    aria-label={texts.setCompletion.filterLabel}
                  >
                    <button
                      type="button"
                      className={setFilter === 'all' ? 'is-active' : ''}
                      aria-pressed={setFilter === 'all'}
                      onClick={() => setSetFilter('all')}
                    >
                      {texts.setCompletion.all}
                    </button>
                    <button
                      type="button"
                      className={setFilter === 'owned' ? 'is-active' : ''}
                      aria-pressed={setFilter === 'owned'}
                      onClick={() => setSetFilter('owned')}
                    >
                      {texts.setCompletion.owned}
                    </button>
                    <button
                      type="button"
                      className={setFilter === 'missing' ? 'is-active' : ''}
                      aria-pressed={setFilter === 'missing'}
                      onClick={() => setSetFilter('missing')}
                    >
                      {texts.setCompletion.missing}
                    </button>
                  </div>

                  {setFeedback && (
                    <p role={setFeedback.type === 'error' ? 'alert' : 'status'}>
                      {setFeedback.type === 'error'
                        ? texts.setCompletion.addError
                        : texts.setCompletion.added(
                            setFeedback.name,
                            setFeedback.quantity
                          )}
                    </p>
                  )}

                  {filteredSetCards.length === 0 ? (
                    <p>{texts.setCompletion.noFilterResults}</p>
                  ) : (
                    <div className="pokemon-grid set-card-grid">
                      {filteredSetCards.map((card) => {
                        const isOwned = ownedCardIds.has(card.id)
                        const displayCard = {
                          ...card,
                          name: card.name || card.id,
                          localId: card.localId || '—'
                        }

                        return (
                          <div
                            key={card.id}
                            className={`set-card-item ${isOwned ? 'set-card-item--owned' : 'set-card-item--missing'}`}
                          >
                            <p className="set-card-status">
                              {isOwned
                                ? texts.setCompletion.ownedStatus
                                : texts.setCompletion.missingStatus}
                            </p>
                            <PokemonCard
                              card={displayCard}
                              onAdd={isOwned ? undefined : handleAddMissingCard}
                              adding={addingMissingCardId === card.id}
                              texts={texts}
                              language={language}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
            </>
          )}
        </section>
      )}

      {view === 'history' && !transactionsLoading && !transactionsError && (
        <section className="transaction-history transaction-history--page">
          <div className="transaction-history-content">
            <p>{texts.transactions.description}</p>
            <p
              id="transaction-inventory-notice"
              className="transaction-inventory-notice"
            >
              {texts.transactions.inventoryNotice}
            </p>

            <form
              className="transaction-card-search"
              onSubmit={handleTransactionCardSearch}
            >
              <label htmlFor="transaction-card-search">
                {texts.transactions.searchCardLabel}
              </label>
              <div>
                <input
                  id="transaction-card-search"
                  type="search"
                  value={transactionCardSearch}
                  placeholder={texts.transactions.searchCardPlaceholder}
                  disabled={transactionSearching || transactionSaving}
                  onChange={(event) => {
                    const value = event.target.value
                    setTransactionCardSearch(value)
                    setTransactionHasSearched(false)

                    if (value.trim() !== transactionActiveSearch) {
                      setTransactionActiveSearch('')
                      setTransactionSearchResults([])
                      setTransactionSearchPage(1)
                      setTransactionSearchHasMore(false)
                      setTransactionSearchError(false)
                    }
                  }}
                  required
                />
                <button type="submit" disabled={transactionSearching || transactionSaving}>
                  {transactionSearching
                    ? texts.transactions.searchingCards
                    : texts.transactions.searchCard}
                </button>
              </div>
            </form>

            {transactionSearchError && (
              <p role="alert">{texts.transactions.catalogUnavailable}</p>
            )}
            {!transactionSearching &&
              !transactionSearchError &&
              transactionHasSearched &&
              transactionSearchResults.length === 0 && (
              <p>{texts.transactions.noCardResults}</p>
            )}

            {transactionSearchResults.length > 0 && (
              <div className="transaction-card-results">
                {transactionSearchResults.map((card) => {
                  const imageState = transactionImageStates[card.id]
                  const imageUrl = imageState
                    ? imageState.urls[imageState.index] ?? null
                    : getCardImageUrls(card.image)[0] ?? null
                  const selected = transactionCardId === card.id

                  return (
                    <button
                      key={card.id}
                      type="button"
                      className={selected ? 'is-selected' : ''}
                      onClick={() => {
                        setTransactionCardId(card.id)
                        setTransactionSelectedCard(card)
                        setTransactionMessage('')
                      }}
                    >
                      {imageUrl && !imageState?.unavailable ? (
                        <img
                          src={imageUrl}
                          alt={texts.card.imageAlt(card.name)}
                          loading="lazy"
                          onError={() => handleTransactionImageError(
                            card.id,
                            card.image
                          )}
                        />
                      ) : (
                        <span className="transaction-card-placeholder">
                          {texts.card.noImage}
                        </span>
                      )}
                      <span>
                        <strong>{card.name}</strong>
                        <small>{card.set?.name || texts.card.unavailable}</small>
                        <small>{texts.transactions.cardNumber(card.localId || '—')}</small>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {transactionHasSearched &&
              !transactionSearchError &&
              (transactionSearchPage > 1 || transactionSearchHasMore) && (
              <nav
                className="transaction-pagination"
                aria-label={texts.transactions.searchPaginationLabel}
              >
                <button
                  type="button"
                  disabled={transactionSearching || transactionSearchPage <= 1}
                  onClick={() => setTransactionSearchPage((current) =>
                    Math.max(1, current - 1)
                  )}
                >
                  {texts.transactions.previous}
                </button>
                <span>{texts.transactions.page(transactionSearchPage)}</span>
                <button
                  type="button"
                  disabled={
                    transactionSearching ||
                    !transactionSearchHasMore
                  }
                  onClick={() => setTransactionSearchPage((current) =>
                    current + 1
                  )}
                >
                  {texts.transactions.next}
                </button>
              </nav>
            )}

            <form
              className="transaction-form"
              onSubmit={handleTransactionSubmit}
              aria-describedby="transaction-inventory-notice"
            >
              <h4>{texts.transactions.formTitle}</h4>

              <span className="transaction-selected-label">
                {texts.transactions.cardLabel}
              </span>
              <div className="transaction-selected-card">
                {transactionSelectedCard
                  ? texts.transactions.selectedCard(
                      transactionSelectedCard.name,
                      transactionSelectedCard.set?.name || texts.card.unavailable,
                      transactionSelectedCard.localId || '—'
                    )
                  : texts.transactions.cardPlaceholder}
              </div>

              <label htmlFor="transaction-type">
                {texts.transactions.typeLabel}
              </label>
              <select
                id="transaction-type"
                value={transactionType}
                onChange={(event) => setTransactionType(event.target.value)}
                disabled={transactionSaving}
              >
                <option value="purchase">{texts.transactions.purchase}</option>
                <option value="sale">{texts.transactions.sale}</option>
              </select>

              <label htmlFor="transaction-quantity">
                {texts.transactions.quantityLabel}
              </label>
              <input
                id="transaction-quantity"
                type="number"
                min="1"
                step="1"
                value={transactionQuantity}
                onChange={(event) => setTransactionQuantity(event.target.value)}
                disabled={transactionSaving}
                required
              />

              <label htmlFor="transaction-unit-price">
                {texts.transactions.unitPriceLabel}
              </label>
              <input
                id="transaction-unit-price"
                type="number"
                min="0"
                step="1"
                value={transactionUnitPrice}
                onChange={(event) => setTransactionUnitPrice(event.target.value)}
                disabled={transactionSaving}
                required
              />

              <label htmlFor="transaction-date">
                {texts.transactions.dateLabel}
              </label>
              <input
                id="transaction-date"
                type="date"
                value={transactionDate}
                onChange={(event) => setTransactionDate(event.target.value)}
                disabled={transactionSaving}
                required
              />

              <label htmlFor="transaction-notes">
                {texts.transactions.notesLabel}
              </label>
              <textarea
                id="transaction-notes"
                value={transactionNotes}
                onChange={(event) => setTransactionNotes(event.target.value)}
                placeholder={texts.transactions.notesPlaceholder}
                maxLength={250}
                rows={3}
                disabled={transactionSaving}
              />

              <p className="transaction-total-preview">
                {texts.transactions.totalPreview(
                  formatClp(
                    transactionPreviewTotal,
                    language,
                    texts.transactions.currency
                  )
                )}
              </p>

              {transactionMessage && (
                <p role={transactionMessage === 'success' ? 'status' : 'alert'}>
                  {texts.transactions[transactionMessage]}
                </p>
              )}

              <button
                type="submit"
                disabled={transactionSaving || !transactionSelectedCard}
              >
                {transactionSaving
                  ? texts.transactions.saving
                  : texts.transactions.register}
              </button>
            </form>

            <div className="transaction-history-list">
              <h4>{texts.transactions.historyTitle}</h4>

              <div
                className="transaction-filters"
                role="group"
                aria-label={texts.transactions.filterLabel}
              >
                {[
                  ['all', texts.transactions.all],
                  ['purchase', texts.transactions.purchases],
                  ['sale', texts.transactions.sales]
                ].map(([filter, label]) => (
                  <button
                    key={filter}
                    type="button"
                    className={transactionFilter === filter ? 'is-active' : ''}
                    aria-pressed={transactionFilter === filter}
                    onClick={() => {
                      setTransactionFilter(filter)
                      setTransactionsPage(1)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {transactionsLoading && (
                <p role="status">{texts.transactions.loading}</p>
              )}

              {transactionsError && (
                <p role="alert">{texts.transactions.loadError}</p>
              )}

              {!transactionsLoading && !transactionsError && transactionsTotal === 0 && (
                <p>
                  {transactionFilter === 'all'
                    ? texts.transactions.empty
                    : texts.transactions.noResults}
                </p>
              )}

              {!transactionsLoading && !transactionsError && transactions.length > 0 && (
                <>
                  <p>{texts.transactions.historyCount(transactionsTotal)}</p>
                  <div
                    className="transaction-list"
                    aria-label={texts.transactions.historyLabel}
                  >
                    {transactions.map((transaction) => {
                        const collectionCard = cards.find(
                          (card) => card.cardId === transaction.cardId
                        )
                        const details = transactionCardDetails[transaction.cardId] ??
                          collectionCard?.details
                        const cardName = details?.name || transaction.cardId
                        const savedImageState =
                          transactionImageStates[transaction.cardId]
                        const imageState = savedImageState?.language === language
                          ? savedImageState
                          : null
                        const imageUrl = imageState
                          ? imageState.urls[imageState.index] ?? null
                          : getCardImageUrls(details?.image)[0] ?? null
                        const totalPrice = transaction.totalPrice ??
                          transaction.quantity * transaction.unitPrice

                        return (
                          <article
                            key={transaction.id}
                            className={`transaction-item transaction-item--${transaction.transactionType}`}
                          >
                            {imageUrl && !imageState?.unavailable ? (
                              <img
                                src={imageUrl}
                                alt={texts.transactions.cardImageAlt(cardName)}
                                loading="lazy"
                                onError={() =>
                                  handleTransactionImageError(
                                    transaction.cardId,
                                    details?.image
                                  )
                                }
                              />
                            ) : (
                              <div className="transaction-image-placeholder">
                                {texts.card.noImage}
                              </div>
                            )}

                            <div className="transaction-item-content">
                              <div className="transaction-item-heading">
                                <strong>{cardName}</strong>
                                <span>
                                  {transaction.transactionType === 'purchase'
                                    ? texts.transactions.purchase
                                    : texts.transactions.sale}
                                </span>
                              </div>
                              <p>{texts.transactions.quantity(transaction.quantity)}</p>
                              <p>
                                {texts.transactions.unitPrice(
                                  formatClp(
                                    transaction.unitPrice,
                                    language,
                                    texts.transactions.currency
                                  )
                                )}
                              </p>
                              <p>
                                <strong>
                                  {texts.transactions.total(
                                    formatClp(
                                      totalPrice,
                                      language,
                                      texts.transactions.currency
                                    )
                                  )}
                                </strong>
                              </p>
                              <p>
                                {texts.transactions.date(
                                  formatTransactionDate(
                                    transaction.transactionDate,
                                    language
                                  )
                                )}
                              </p>
                              {transaction.notes && (
                                <p>{texts.transactions.notes(transaction.notes)}</p>
                              )}
                            </div>
                          </article>
                        )
                    })}
                  </div>

                  {transactionsTotalPages > 1 && (
                    <nav
                      className="transaction-pagination"
                      aria-label={texts.transactions.historyPaginationLabel}
                    >
                      <button
                        type="button"
                        disabled={transactionsLoading || transactionsPage <= 1}
                        onClick={() => setTransactionsPage((current) =>
                          Math.max(1, current - 1)
                        )}
                      >
                        {texts.transactions.previous}
                      </button>
                      <span>
                        {texts.transactions.pageOf(
                          transactionsPage,
                          transactionsTotalPages
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={
                          transactionsLoading ||
                          transactionsPage >= transactionsTotalPages
                        }
                        onClick={() => setTransactionsPage((current) =>
                          Math.min(transactionsTotalPages, current + 1)
                        )}
                      >
                        {texts.transactions.next}
                      </button>
                    </nav>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      )}
    </section>
  )
}
export default Collection
