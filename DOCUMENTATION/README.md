# FamilyTV HLS Stream Proxy Server

A Node.js server that resolves and proxies HLS streams from **streamed.pk / embed.st** (and **golf** embeds) so they can be played in any browser or media player without referer or CORS issues.

## Features

- Resolves `admin`/`echo` streams using the embed.st handshake.
- Resolves `golf` streams via a third‑party embed chain.
- Proxies HLS playlists and segments with correct `Referer`/`Origin` headers.
- Rewrites M3U8 playlists so all segments and keys go through the proxy.
- Strips PNG wrappers from segments (tiktokcdn).
- Works with `hls.js`, VLC, MPV, and any HLS‑compatible player.

## Quick Start

```bash
git clone https://github.com/family-tv/family-tv
npm install
npm start
```

Then open `http://localhost:5000` (or your deployed URL).

## Documentation

- [API Reference](./API.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [Setup & Configuration](./SETUP.md)
- [Deployment (incl. Hugging Face Spaces)](./DEPLOYMENT.md)
- [Debugging](./DEBUGGING.md)

## License

For study and research only. See the original [streamed-pk-hls-stream-resolver](https://github.com/sharoon7171/streamed-pk-hls-stream-resolver) disclaimer.