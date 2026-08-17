import { embedOrigin, streamedOrigin } from '../env.js'
import { fetchJson } from './api.js'
import { fetchLinks, pickLink } from './match.js'
import { makeSlot } from '../resolve/slot.js'

const watchRe = /^\/watch\/([^/]+)\/([^/]+)\/(\d+)\/?$/

async function loadMatch(matchId) {
  const sports = await fetchJson('/api/sports')
  if (!Array.isArray(sports)) throw new Error('streamed.pk /api/sports invalid response')

  for (const sport of sports) {
    if (!sport?.id) continue

    for (const endpoint of [`/api/matches/${encodeURIComponent(sport.id)}`, `/api/matches/${encodeURIComponent(sport.id)}/popular`]) {
      const list = await fetchJson(endpoint)
      if (!Array.isArray(list)) continue
      const match = list.find((item) => item.id === matchId)
      if (match) return match
    }
  }

  throw new Error(`match not found: ${matchId}`)
}

async function loadLinks(matchId, source, stream) {
  const match = await loadMatch(matchId)
  const sources = match.sources ?? []
  const candidates = [source, ...sources.map((item) => item.source)].filter(Boolean)
  let lastError = null

  for (const candidate of candidates) {
    try {
      const src = candidate === source ? pickSource(match, candidate) : sources.find((item) => item.source === candidate)
      if (!src?.source || !src?.id) continue

      const link = pickLink(await fetchLinks(src.source, src.id), stream)
      return { match, link }
    } catch (err) {
      lastError = err
    }
  }

  throw lastError || new Error(`source ${source} not found`)
}

function pickSource(match, name) {
  const sources = match.sources ?? []
  if (!sources.length) throw new Error('match has no stream sources')
  const picked = sources.find((item) => item.source === name)
  if (!picked) throw new Error(`source ${name} not found`)
  return picked
}

function watchLink(matchId, source, stream) {
  return `${streamedOrigin}/watch/${matchId}/${source}/${Number(stream)}`
}

export function parseWatchPath(pathname) {
  const m = pathname.match(watchRe)
  if (!m) return null
  return { matchId: m[1], source: m[2], stream: m[3] }
}

export async function loadWatch(matchId, source, stream) {
  const { match, link } = await loadLinks(matchId, source, stream)
  return {
    matchId: match.id,
    title: match.title,
    watchUrl: watchLink(match.id, link.source, link.streamNo),
    embedUrl: link.embedUrl,
    slot: makeSlot(embedOrigin, link.source, link.id, link.streamNo),
  }
}
