import { serve } from '../relay/m3u8.js'
import { run } from '../resolve/run.js'
import { fetchLinks } from '../streamed/match.js'
import { serveStatic } from './static.js'

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function listStreams(source, id, origin) {
  const links = await fetchLinks(source, id)
  return Promise.all(
    links.map(async (link) => {
      const inputUrl = link.embedUrl || link.url || link.watchUrl || link.href || link.link
      if (!inputUrl) throw new Error('stream url not available')

      const resolved = await run({ url: inputUrl }, origin)
      if (!resolved.ok) throw new Error(resolved.error || 'resolve failed')

      return {
        id,
        streamNo: Number(link.streamNo),
        language: link.language || link.name || link.title || 'Unknown',
        hd: Boolean(link.hd ?? /hd|720|1080/i.test(String(link.language || ''))),
        streamUrl: resolved.relay,
        source: link.source || source,
        viewers: Number(link.viewers ?? 0),
      }
    }),
  )
}

export async function route(req, res) {
  if (!req.headers.host) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('missing host')
    return
  }

  const loc = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const { pathname, searchParams, origin } = loc

  try {
    if (pathname === '/api/hls' || pathname === '/api/m3u8-proxy' || pathname === '/api/segment-proxy') {
      await serve(res, searchParams, origin)
      return
    }

    const streamMatch = pathname.match(/^\/api\/stream\/([^/]+)\/([^/]+)\/?$/)
    if (streamMatch) {
      if (req.method !== 'GET') {
        json(res, 405, { error: 'GET required' })
        return
      }

      const [, source, id] = streamMatch
      json(res, 200, await listStreams(source, id, origin))
      return
    }

    if (pathname === '/api/stream') {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'POST required' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch {
        json(res, 400, { ok: false, error: 'invalid json' })
        return
      }
      json(res, 200, await run(body, origin))
      return
    }

    if (serveStatic(pathname, res)) return

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  } catch (err) {
    json(res, 500, { ok: false, error: String(err.message || err) })
  }
}
