import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve as serveProxy } from './relay/m3u8.js'
import { run } from './resolve/run.js'
import { fetchJson } from './streamed/api.js'
import { fetchLinks } from './streamed/match.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()

const LOGO_TEXT = fs.readFileSync(path.join(__dirname, '../public/assets/title.txt'), 'utf8')

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`
}

async function upstreamGet(pathname) {
  return fetchJson(pathname)
}

async function findMatchById(matchId) {
  const sports = await upstreamGet('/api/sports')
  if (!Array.isArray(sports)) return null

  for (const sport of sports) {
    if (!sport?.id) continue

    for (const endpoint of [`/api/matches/${encodeURIComponent(sport.id)}`, `/api/matches/${encodeURIComponent(sport.id)}/popular`]) {
      const list = await upstreamGet(endpoint)
      if (!Array.isArray(list)) continue

      const match = list.find((item) => item.id === matchId)
      if (match) return match
    }
  }

  return null
}

async function fetchStreamsForMatch(source, id, match) {
  const candidates = []
  if (source) candidates.push(source)

  for (const item of match?.sources || []) {
    if (item?.source && !candidates.includes(item.source)) candidates.push(item.source)
  }

  let lastError = null
  for (const candidate of candidates) {
    try {
      const links = await fetchLinks(candidate, id)
      if (Array.isArray(links) && links.length > 0) return { links, sourceUsed: candidate }
    } catch (err) {
      lastError = err
    }
  }

  throw lastError || new Error('no streams returned for source')
}

export function buildStreamEntry(link, resolved, sourceUsed, id) {
  const embedUrl = link.embedUrl || link.watchUrl || link.url || link.href || link.link || null
  return {
    id,
    streamNo: Number(link.streamNo),
    language: link.language || link.name || link.title || 'Unknown',
    hd: Boolean(link.hd ?? /hd|720|1080/i.test(String(link.language || ''))),
    embedUrl,
    streamUrl: resolved?.ok ? resolved.relay : null,
    source: link.source || sourceUsed,
    viewers: Number(link.viewers ?? 0),
  }
}

function shapeCard(item) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    startAt: item.startAt,
    sources: item.sources || [],
  }
}

app.get('/', (req, res) => {
  res.type('text/plain; charset=utf-8').send(`${LOGO_TEXT}\n\ndeveloped_by: FamilyTV\ngithub: https://github.com/family-tv\ndocs: https://family.tv/docs\ndmca: https://family.tv/docs/misc/dmca`)
})

app.get('/api', (req, res) => {
  res.json({
    name: 'family-tv-api',
    description: 'FamilyTV - Movie and TV show streaming',
    endpoints: {
      sports: '/api/sports',
      matches_by_category: '/api/matches/:category',
      popular_matches: '/api/matches/:category/popular',
      stream_resolver: '/api/stream/:source/:id',
      proxy_m3u8: '/api/m3u8-proxy?url={url}',
      images: [
        '/api/images/badge/:badge',
        '/api/images/poster/:badge1/:badge2',
        '/api/images/proxy/:url',
      ],
    },
  })
})

app.get('/api/sports', async (req, res) => {
  try {
    const data = await upstreamGet('/api/sports')
    res.json(data)
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message })
  }
})

app.get('/api/matches/:category', async (req, res) => {
  try {
    const data = await upstreamGet(`/api/matches/${req.params.category}`)
    res.json((Array.isArray(data) ? data : []).map(shapeCard))
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message })
  }
})

app.get('/api/matches/:category/popular', async (req, res) => {
  try {
    const data = await upstreamGet(`/api/matches/${req.params.category}/popular`)
    res.json((Array.isArray(data) ? data : []).map(shapeCard))
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message })
  }
})

app.get('/api/stream/:source/:id', async (req, res) => {
  try {
    const match = await findMatchById(req.params.id)
    const { links, sourceUsed } = await fetchStreamsForMatch(req.params.source, req.params.id, match)
    const base = getBaseUrl(req)

    const enriched = await Promise.all(
      links.map(async (link) => {
        const inputUrl = link.embedUrl || link.watchUrl || link.url || link.href || link.link
        const resolved = inputUrl ? await run({ url: inputUrl }, base) : null
        return buildStreamEntry(link, resolved, sourceUsed, req.params.id)
      }),
    )

    res.json(enriched)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.post('/api/stream', async (req, res) => {
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const data = await run(body, getBaseUrl(req))
    res.json(data)
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

app.get('/api/m3u8-proxy', async (req, res) => {
  const target = typeof req.query.url === 'string' ? req.query.url : ''
  if (!target) {
    res.status(400).end()
    return
  }

  const params = new URLSearchParams()
  params.set('url', target)
  if (typeof req.query.referer === 'string' && req.query.referer) params.set('referer', req.query.referer)

  await serveProxy(res, params, getBaseUrl(req))
})

app.get('/api/hls', async (req, res) => {
  const target = typeof req.query.url === 'string' ? req.query.url : ''
  if (!target) {
    res.status(400).end()
    return
  }

  const params = new URLSearchParams()
  params.set('url', target)
  if (typeof req.query.referer === 'string' && req.query.referer) params.set('referer', req.query.referer)
  if (typeof req.query.embed === 'string' && req.query.embed) params.set('embed', req.query.embed)
  if (typeof req.query.embedOrigin === 'string' && req.query.embedOrigin) params.set('embedOrigin', req.query.embedOrigin)

  await serveProxy(res, params, getBaseUrl(req))
})

app.get('/api/segment-proxy', async (req, res) => {
  const target = typeof req.query.url === 'string' ? req.query.url : ''
  if (!target) {
    res.status(400).end()
    return
  }

  const params = new URLSearchParams()
  params.set('url', target)
  if (typeof req.query.referer === 'string' && req.query.referer) params.set('referer', req.query.referer)

  await serveProxy(res, params, getBaseUrl(req))
})

app.get('/api/images/badge/:badge', async (req, res) => {
  try {
    const upstream = await fetch(`https://streamed.pk/api/images/badge/${encodeURIComponent(req.params.badge)}`)
    if (!upstream.ok) throw new Error(`image upstream ${upstream.status}`)
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/octet-stream')
    for await (const chunk of upstream.body) res.write(chunk)
    res.end()
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.get('/api/images/poster/:badge1/:badge2', async (req, res) => {
  try {
    const upstream = await fetch(`https://streamed.pk/api/images/poster/${encodeURIComponent(req.params.badge1)}/${encodeURIComponent(req.params.badge2)}`)
    if (!upstream.ok) throw new Error(`image upstream ${upstream.status}`)
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/octet-stream')
    for await (const chunk of upstream.body) res.write(chunk)
    res.end()
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.get(/^\/api\/images\/proxy\/(.+)$/, async (req, res) => {
  try {
    const target = decodeURIComponent(req.params[0])
    const upstream = await fetch(target)
    if (!upstream.ok) throw new Error(`image upstream ${upstream.status}`)
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/octet-stream')
    for await (const chunk of upstream.body) res.write(chunk)
    res.end()
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.use(express.static(path.join(__dirname, '../public')))

app.use((req, res) => {
  res.status(404).type('text/plain').send('not found')
})

export default app
