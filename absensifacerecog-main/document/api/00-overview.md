# API Contracts

> HTTP REST + WebSocket contracts antara Frontend, Backend, AI service.

---

## Base URL

- **Local dev**: `http://localhost` (via nginx)
- **Production**: `https://absen.yourdomain.com` (via Cloudflare)

Semua path di bawah ini relative terhadap `http(s)://<host>`.

---

## Authentication

### Cookie-based (browser)
- `access_token` — JWT RS256, 15 min, HttpOnly, SameSite=Strict, Path=/
- `refresh_token` — opaque UUID, 7 days, HttpOnly, SameSite=Strict, Path=/api/auth

Browser auto-sends cookies. Server validates `access_token` di setiap request (kecuali `@Public()`).

### Service-to-service (backend ↔ AI)
- `X-Internal-Token: <shared-secret>` header
- Same env var di backend & AI service
- Validated by `InternalTokenGuard` di backend, `X-Internal-Token middleware` di AI

---

## Standard response format

### Success
```json
{
  "success": true,
  "data": { /* payload */ },
  "meta": { "page": 1, "limit": 20, "total": 100 }  // for list endpoints
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email already registered"
  }
}
```

### Error codes

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `UNAUTHORIZED` | 401 | Missing/invalid JWT |
| `TOKEN_EXPIRED` | 401 | Access token expired (refresh) |
| `FORBIDDEN` | 403 | Wrong role |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Duplicate (e.g. already checked in) |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected error |
| `AI_SERVICE_UNAVAILABLE` | 503 | AI down, retry later |
| `INVALID_INTERNAL_TOKEN` | 401 | Internal service auth failed |
| `NO_FRAME` | 404 | Camera preview cache empty |

---

## Rate limiting

Default: 100 req / 60s per IP (configurable via env).

**Exempt**:
- `/internal/ai/*` (internal)
- `/api/cameras/:id/preview.jpg` (high-frequency polling)
- `/api/auth/refresh` (auto-refresh on 401)
- `/health`

---

## API Endpoints

Lihat:
- [`03-endpoints-auth.md`](03-endpoints-auth.md) — `/api/auth/*`
- [`04-endpoints-users.md`](04-endpoints-users.md) — `/api/users/*`
- [`05-endpoints-attendance.md`](05-endpoints-attendance.md) — `/api/attendance/*`
- [`06-endpoints-leave.md`](06-endpoints-leave.md) — `/api/leaves/*`
- [`07-endpoints-camera.md`](07-endpoints-camera.md) — `/api/cameras/*`
- [`02-internal-ai.md`](02-internal-ai.md) — `/internal/ai/*` (service-to-service)
- [`01-websocket.md`](01-websocket.md) — WebSocket namespaces & events

---

## Next step

→ Mulai dari [`03-endpoints-auth.md`](03-endpoints-auth.md).
