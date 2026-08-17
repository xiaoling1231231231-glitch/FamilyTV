# API Reference

All endpoints are relative to the server root (e.g. `http://localhost:5000`).

---

## `GET /api/stream/:source/:id`

Returns a JSON array of available streams for a given match.

**URL parameters**  
- `source` – source name (`admin`, `echo`, `golf`, etc.)  
- `id` – match slug (e.g. `ppv-brooklyn-nets-vs-milwaukee-bucks`)

**Example request**  
```
GET /api/stream/admin/ppv-brooklyn-nets-vs-milwaukee-bucks
```

**Example response**
```json
[
  {
    "id": "ppv-brooklyn-nets-vs-milwaukee-bucks",
    "streamNo": 1,
    "language": "English - ESPN+",
    "hd": true,
    "streamUrl": "http://localhost:5000/api/m3u8-proxy?url=https%3A%2F%2Flb14.strmd.st%2Fsecure%2F...%2Fplaylist.m3u8",
    "source": "admin",
    "viewers": 14
  }
]
```

**Fields**  
| Field      | Type    | Description |
|------------|---------|-------------|
| `id`       | string  | Match identifier |
| `streamNo` | number  | Stream number (used internally) |
| `language` | string  | Human‑readable label |
| `hd`       | boolean | Whether the stream is high‑definition |
| `streamUrl`| string  | **Proxied** playlist URL – use this for playback |
| `source`   | string  | Source name |
| `viewers`  | number  | Approximate viewer count (may be `0`) |

> The endpoint may also accept a full watch URL or embed URL if your router supports it.

---

## `GET /api/m3u8-proxy`

Serves the HLS playlist or a segment.  
The server automatically detects whether the response is a playlist or a segment and handles it accordingly.

**Query parameters**  
| Parameter | Required | Description |
|-----------|----------|-------------|
| `url`     | ✅       | The upstream HLS URL (playlist or segment). |
| `referer` | ❌       | Override the `Referer` header sent to upstream. If omitted, `EMBED_DOMAIN` is used. |

**Behaviour**  
- If the upstream response is an M3U8 playlist (contains `#EXTM3U`), it rewrites all media URLs and `URI` attributes to point back to `/api/m3u8-proxy`.
- If the response is an MPEG‑TS segment, it strips the PNG wrapper (if present) and returns raw TS data.

**Response headers**  
- `Content-Type: application/vnd.apple.mpegurl` or `video/mp2t`  
- `Access-Control-Allow-Origin: *`  
- `Cache-Control: no-cache`

**Example**  
```
GET /api/m3u8-proxy?url=https://lb14.strmd.st/secure/.../playlist.m3u8&referer=https://embed.st/
```

---

## `GET /api/segment-proxy` *(if mounted separately)*

Some implementations separate segment proxying from playlist proxying.  
This endpoint behaves exactly like `/api/m3u8-proxy` but is dedicated to segments and always returns `video/mp2t`.

**Same query parameters as above.**

---

## Error Responses

All endpoints return appropriate HTTP status codes:

- `400` – Missing required parameter.
- `502` – Upstream fetch failed (non‑2xx status, network error, or invalid response).
- `500` – Internal server error (e.g., resolver failure).

Error responses are plain text with a descriptive message.