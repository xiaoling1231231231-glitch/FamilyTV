import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { buildStreamEntry } from '../src/app.js'

function makeJsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
}

test('root responds with plain text logo', async () => {
  const { default: app } = await import('../src/app.js')
  const server = createServer(app)
  await once(server.listen(0, '127.0.0.1'), 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  try {
    const response = await fetch(`http://127.0.0.1:${port}/`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /text\/plain/)
    const text = await response.text()
    assert.match(text, /developed_by: FamilyTV/)
    assert.doesNotMatch(text, /<html/i)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('api routes fall back to the match source when the requested source is empty', async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.push(url)

    if (url.endsWith('/api/sports')) {
      return makeJsonResponse([{ id: 'football', name: 'Football' }])
    }

    if (url.endsWith('/api/matches/football')) {
      return makeJsonResponse([
        {
          id: 'sporting-cp-vs-strasbourg-game-399075',
          title: 'Sporting CP vs Strasbourg',
          category: 'football',
          startAt: '2026-07-19T00:00:00Z',
          sources: [{ source: 'echo', id: 'sporting-cp-vs-strasbourg-game-399075' }],
        },
      ])
    }

    if (url.endsWith('/api/matches/football/popular')) {
      return makeJsonResponse([])
    }

    if (url.endsWith('/api/stream/admin/sporting-cp-vs-strasbourg-game-399075')) {
      return makeJsonResponse([])
    }

    if (url.endsWith('/api/stream/echo/sporting-cp-vs-strasbourg-game-399075')) {
      return makeJsonResponse([
        {
          id: 'sporting-cp-vs-strasbourg-game-399075',
          streamNo: 1,
          language: 'English',
          hd: true,
          embedUrl: 'https://embed.example/1',
          source: 'echo',
        },
      ])
    }

    throw new Error(`unexpected fetch: ${url}`)
  }

  try {
    const { default: app } = await import('../src/app.js')
    const server = createServer(app)
    await once(server.listen(0, '127.0.0.1'), 'listening')
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    try {
      const sports = await originalFetch(`http://127.0.0.1:${port}/api/sports`)
      assert.equal(sports.status, 200)
      assert.deepEqual(await sports.json(), [{ id: 'football', name: 'Football' }])

      const matches = await originalFetch(`http://127.0.0.1:${port}/api/matches/football`)
      assert.equal(matches.status, 200)
      const matchJson = await matches.json()
      assert.equal(matchJson[0].id, 'sporting-cp-vs-strasbourg-game-399075')
      assert.deepEqual(matchJson[0].sources, [{ source: 'echo', id: 'sporting-cp-vs-strasbourg-game-399075' }])

      const streams = await originalFetch(`http://127.0.0.1:${port}/api/stream/admin/sporting-cp-vs-strasbourg-game-399075`)
      assert.equal(streams.status, 200)
      const streamJson = await streams.json()
      assert.equal(streamJson[0].embedUrl, 'https://embed.example/1')

      assert(calls.includes('https://streamed.pk/api/sports'))
      assert(calls.includes('https://streamed.pk/api/matches/football'))
      assert(calls.includes('https://streamed.pk/api/stream/admin/sporting-cp-vs-strasbourg-game-399075'))
      assert(calls.includes('https://streamed.pk/api/stream/echo/sporting-cp-vs-strasbourg-game-399075'))
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('buildStreamEntry preserves the proxied relay URL', () => {
  const entry = buildStreamEntry(
    { streamNo: 1, language: 'English', hd: true, embedUrl: 'https://embed.example/1', source: 'delta' },
    { ok: true, relay: 'http://127.0.0.1:5000/api/m3u8-proxy?url=https%3A%2F%2Fupstream.example%2Fplaylist.m3u8' },
    'delta',
    'live-event_world-cup-champions-celebration-live-stream',
  )

  assert.equal(entry.embedUrl, 'https://embed.example/1')
  assert.equal(entry.streamUrl, 'http://127.0.0.1:5000/api/m3u8-proxy?url=https%3A%2F%2Fupstream.example%2Fplaylist.m3u8')
})

test('api hls route proxies playlists instead of falling through to 404', async () => {
  const upstream = createServer((req, res) => {
    if (req.url === '/playlist.m3u8') {
      assert.equal(req.headers.referer, 'https://embed.st/embed/echo/demo/1')
      assert.equal(req.headers.origin, 'https://embed.st')
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' })
      res.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,\nsegment.ts\n')
      return
    }

    if (req.url === '/segment.ts') {
      res.writeHead(200, { 'content-type': 'video/mp2t' })
      res.end('segment-bytes')
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  await once(upstream.listen(0, '127.0.0.1'), 'listening')
  const upstreamAddress = upstream.address()
  const upstreamPort = typeof upstreamAddress === 'object' && upstreamAddress ? upstreamAddress.port : 0

  try {
    const { default: app } = await import('../src/app.js')
    const server = createServer(app)
    await once(server.listen(0, '127.0.0.1'), 'listening')
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/hls?url=${encodeURIComponent(`http://127.0.0.1:${upstreamPort}/playlist.m3u8`)}&embed=echo%2Fdemo%2F1&embedOrigin=${encodeURIComponent('https://embed.st')}`,
      )

      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type') ?? '', /mpegurl/i)
      const text = await response.text()
      assert.match(text, /#EXTM3U/)
      assert.match(text, /\/api\/hls\?url=/)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  } finally {
    await new Promise((resolve) => upstream.close(resolve))
  }
})