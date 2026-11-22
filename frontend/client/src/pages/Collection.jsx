import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getCollection, addCardToCollection, updateCollectionQuantity, updateCardTradeStatus, deleteCollectionCard, getTransactions, createTransaction } from '../services/collectionService'
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
const PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
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

function extractTopCardName(text) {
  const candidates = String(text ?? '')
    .split(/\r?\n/)
    .map(cleanDetectedCardName)
    .filter((line) => {
      const letters = line.match(/\p{L}/gu) ?? []

      return line.length >= 2 &&
        line.length <= 50 &&
        letters.length >= 2 &&
        !isMetadataLine(line) &&
        !line.includes('/') &&
        !/^\d+$/u.test(line)
    })

  return selectBestDetectedName(candidates)
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
      const cleaned = cleanDetectedCardName(line)
      const letters = (cleaned.match(/\p{L}/gu) ?? []).length
      const valid = cleaned.length >= 2 &&
        cleaned.length <= 50 &&
        letters >= 2 &&
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
  const letters = name.match(/\p{L}/gu) ?? []
  const tokens = name.split(/\s+/).filter(Boolean)
  const shortUppercaseTokens = tokens.filter((token) =>
    token.length <= 3 && /^[A-Z]+$/.test(token)
  ).length

  return letters.length * 2 +
    (tokens.length === 1 ? 12 : 0) -
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
  const queries = [name, ...usefulWords]

  if (longestWord.length >= 4) queries.push(longestWord)
  if (longestWord.length >= 5) queries.push(longestWord.slice(0, 4))

  return [...new Set(queries.filter((query) => query.length >= 2))]
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
  { scale = 2.5, contrast = 1.35, binary = false } = {}
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
  let totalLuminance = 0

  for (let index = 0; index < grayscale.length; index += 1) {
    const offset = index * 4
    const value = Math.round(
      imageData.data[offset] * 0.299 +
      imageData.data[offset + 1] * 0.587 +
      imageData.data[offset + 2] * 0.114
    )
    const adjusted = Math.max(
      0,
      Math.min(255, Math.round((value - 128) * contrast + 128))
    )

    grayscale[index] = adjusted
    totalLuminance += adjusted
  }

  const threshold = totalLuminance / grayscale.length

  for (let index = 0; index < grayscale.length; index += 1) {
    const offset = index * 4
    const value = binary
      ? (grayscale[index] >= threshold ? 255 : 0)
      : grayscale[index]

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [busyTradeId, setBusyTradeId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [activeCollectionTab, setActiveCollectionTab] = useState('cards')
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
  const [transactions, setTransactions] = useState([])
  const [transactionsLoading, setTransactionsLoading] = useState(true)
  const [transactionsError, setTransactionsError] = useState(false)
  const [transactionCardDetails, setTransactionCardDetails] = useState({})
  const [transactionImageStates, setTransactionImageStates] = useState({})
  const [transactionCardId, setTransactionCardId] = useState('')
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
    let cancelled = false

    async function loadCollection() {
      setLoading(true)
      setError('')

      try {
        const result = await getCollection()

        if (!cancelled) {
          setCards(result)
        }

        const savedCards = await getCollection()

        const completeCards = await Promise.all(
          savedCards.map(async (item) => {
            try {
              const details = await getCardById(item.cardId, language)

              return {
                ...item,
                details
              }
            } catch {
              return {
                ...item,
                details: null
              }
            }
          })
        )

        if (!cancelled) {
          setCards(completeCards)
        }

      } catch (error) {
        if (!cancelled) {
          setCards([])
          setError(error.message)
        }
      } 
      
      finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadCollection()

    return () => {
      cancelled = true
    }
  }, [language])

  useEffect(() => {
    let cancelled = false

    async function loadSets() {
      setSetsLoading(true)
      setSetsError(false)
      setSetFeedback(null)

      try {
        const result = await getSets(language)
        const availableSets = Array.isArray(result) ? result : []

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
      try {
        const result = await getTransactions()

        if (!cancelled) {
          setTransactions(Array.isArray(result) ? result : [])
        }
      } catch {
        if (!cancelled) {
          setTransactions([])
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
  }, [])

  useEffect(() => {
    if (transactions.length === 0) return

    let cancelled = false

    async function loadTransactionCardDetails() {
      const cardIds = [
        ...new Set(transactions.map((transaction) => transaction.cardId))
      ]
      const entries = await Promise.all(
        cardIds.map(async (cardId) => {
          try {
            const details = await getCardById(cardId, language)
            return [cardId, details]
          } catch {
            return [cardId, null]
          }
        })
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

    await worker.setParameters(parameters)
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
        { x: 0.12, y: 0.025, width: 0.64, height: 0.095 },
        { x: 0.07, y: 0.055, width: 0.72, height: 0.105 }
      ]
      const nameCandidates = []

      for (const nameRegion of nameRegions) {
        const topText = await recognizePhotoRegion(
          worker,
          loadedImage.image,
          cardBounds,
          nameRegion,
          { scale: 8, contrast: 1.45 },
          {
            tessedit_pageseg_mode: '7',
            tessedit_char_whitelist: ''
          }
        )

        if (photoRunId.current !== runId) return null
        nameCandidates.push(extractTopCardName(topText))

        if (scoreDetectedName(nameCandidates.at(-1)) < 18) {
          const binaryTopText = await recognizePhotoRegion(
            worker,
            loadedImage.image,
            cardBounds,
            nameRegion,
            { scale: 8, contrast: 1.3, binary: true },
            {
              tessedit_pageseg_mode: '13',
              tessedit_char_whitelist: ''
            }
          )

          if (photoRunId.current !== runId) return null
          nameCandidates.push(extractTopCardName(binaryTopText))
        }
      }

      let name = selectBestDetectedName(nameCandidates)

      if (!name) {
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
        name = extractTopCardName(broadTopText)
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

      const numberData = selectBestCollectionNumber(numberCandidates)
      const visualFingerprint = createCardVisualFingerprint(
        loadedImage.image,
        cardBounds
      )

      return {
        name,
        number: numberData.number,
        total: numberData.total,
        hp: extractSpecializedHp(hpText),
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
      const nameQueries = getPhotoNameQueries(normalizedFields.name)
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
            scorePhotoCandidate(candidate, normalizedFields) >
              scorePhotoCandidate(current, normalizedFields)
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

      for (const nameQuery of nameQueries.slice(1)) {
        if (candidatesById.size >= 4) break

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
            scorePhotoCandidate(b, normalizedFields) -
            scorePhotoCandidate(a, normalizedFields)
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
        .map(({ card, visualSimilarity }) => ({
          card,
          evidence: getPhotoCandidateEvidence(
            card,
            normalizedFields,
            visualSimilarity
          )
        }))
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


async function handleDelete(item) {
  if (busyId !== null || busyTradeId !== null) return

  const cardName = item.details?.name || texts.collection.cardFallback(item.cardId)
  const confirmed = window.confirm(texts.collection.confirmDelete(cardName))

  if (!confirmed) return

  setBusyId(item.id)
  setActionError('')

  try {
    await deleteCollectionCard(item.id)

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

async function handleTransactionSubmit(event) {
  event.preventDefault()

  if (transactionSaving) return

  const quantity = Number(transactionQuantity)
  const unitPrice = Number(transactionUnitPrice)
  const normalizedNotes = transactionNotes.trim()

  if (!cards.some((card) => card.cardId === transactionCardId)) {
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
    const created = await createTransaction({
      cardId: transactionCardId,
      transactionType,
      quantity,
      unitPrice,
      transactionDate,
      notes: normalizedNotes || null
    })

    setTransactions((current) =>
      [...current, created].sort((first, second) =>
        second.transactionDate.localeCompare(first.transactionDate) ||
        second.id - first.id
      )
    )
    setTransactionCardId('')
    setTransactionType('purchase')
    setTransactionQuantity('1')
    setTransactionUnitPrice('0')
    setTransactionDate(getLocalDateValue())
    setTransactionNotes('')
    setTransactionMessage('success')
  } catch {
    setTransactionMessage('saveError')
  } finally {
    setTransactionSaving(false)
  }
}

  const totalCards = cards.reduce(
    (total, card) => total + card.quantity,
    0
  )
  const visibleCards = activeCollectionTab === 'trade'
    ? cards.filter((card) => card.forTrade)
    : cards
  const ownedCardIds = new Set(
    cards.map((card) => card.cardId)
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
  const filteredTransactions = transactionFilter === 'purchase'
    ? transactions.filter(
        (transaction) => transaction.transactionType === 'purchase'
      )
    : transactionFilter === 'sale'
      ? transactions.filter(
          (transaction) => transaction.transactionType === 'sale'
        )
      : transactions

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
        </div>
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
                      name: event.target.value
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

      {loading && <p role="status">{texts.collection.loading}</p>}

      {error && (
        <p role="alert">
          {texts.collection.serviceError(error, texts.collection.loadError)}
        </p>
      )}

      {view === 'collection' &&
        activeCollectionTab === 'cards' &&
        !loading &&
        !error &&
        cards.length === 0 && (
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
        visibleCards.length === 0 && (
        <p className="trade-filter-empty">
          {texts.collection.noTradeCards}
        </p>
      )}

      {view === 'collection' &&
        (activeCollectionTab === 'cards' || activeCollectionTab === 'trade') &&
        !loading &&
        !error &&
        cards.length > 0 && (
        <>
          <p>{texts.collection.total(totalCards, cards.length)}</p>

          {visibleCards.length === 0 ? (
            <p className="trade-filter-empty">{texts.collection.noTradeCards}</p>
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
                <PokemonCard
                  card={details}
                  texts={texts}
                  language={language}
                />

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
        </section>
      )}

      {view === 'history' && !loading && !error && (
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
              className="transaction-form"
              onSubmit={handleTransactionSubmit}
              aria-describedby="transaction-inventory-notice"
            >
              <h4>{texts.transactions.formTitle}</h4>

              {cards.length === 0 && (
                <p>{texts.transactions.noCardsForForm}</p>
              )}

              <label htmlFor="transaction-card">
                {texts.transactions.cardLabel}
              </label>
              <select
                id="transaction-card"
                value={transactionCardId}
                onChange={(event) => setTransactionCardId(event.target.value)}
                disabled={cards.length === 0 || transactionSaving}
                required
              >
                <option value="">{texts.transactions.cardPlaceholder}</option>
                {cards.map((card) => (
                  <option key={card.id} value={card.cardId}>
                    {card.details?.name || texts.collection.cardFallback(card.cardId)}
                  </option>
                ))}
              </select>

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
                disabled={transactionSaving || cards.length === 0}
              >
                {transactionSaving
                  ? texts.transactions.saving
                  : texts.transactions.register}
              </button>
            </form>

            <div className="transaction-history-list">
              <h4>{texts.transactions.historyTitle}</h4>

              {transactionsLoading && (
                <p role="status">{texts.transactions.loading}</p>
              )}

              {transactionsError && (
                <p role="alert">{texts.transactions.loadError}</p>
              )}

              {!transactionsLoading && !transactionsError && transactions.length === 0 && (
                <p>{texts.transactions.empty}</p>
              )}

              {!transactionsLoading && !transactionsError && transactions.length > 0 && (
                <>
                  <div
                    className="transaction-filters"
                    role="group"
                    aria-label={texts.transactions.filterLabel}
                  >
                    <button
                      type="button"
                      className={transactionFilter === 'all' ? 'is-active' : ''}
                      aria-pressed={transactionFilter === 'all'}
                      onClick={() => setTransactionFilter('all')}
                    >
                      {texts.transactions.all}
                    </button>
                    <button
                      type="button"
                      className={transactionFilter === 'purchase' ? 'is-active' : ''}
                      aria-pressed={transactionFilter === 'purchase'}
                      onClick={() => setTransactionFilter('purchase')}
                    >
                      {texts.transactions.purchases}
                    </button>
                    <button
                      type="button"
                      className={transactionFilter === 'sale' ? 'is-active' : ''}
                      aria-pressed={transactionFilter === 'sale'}
                      onClick={() => setTransactionFilter('sale')}
                    >
                      {texts.transactions.sales}
                    </button>
                  </div>

                  {filteredTransactions.length === 0 ? (
                    <p>{texts.transactions.noResults}</p>
                  ) : (
                    <div
                      className="transaction-list"
                      aria-label={texts.transactions.historyLabel}
                    >
                      {filteredTransactions.map((transaction) => {
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
