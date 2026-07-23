# Service: nginx (Reverse Proxy)

> Single entry point. Hides backend/frontend/AI from host. TLS termination (production).

---

## Tujuan

- **Satu-satunya** service yang publish ke host (port 80)
- Reverse proxy ke backend (port 4000) + frontend (port 3000)
- WebSocket upgrade headers untuk Socket.IO
- Static asset serving (`/_next/`)
- TLS termination (production)

---

## Tech

| | Version |
|---|---|
| nginx | alpine (latest) |
| OpenSSL | bundled |

Image size: ~40MB (alpine + nginx).

---

## Config (target)

`nginx/default.conf`:

```nginx
upstream backend {
    server backend:4000;
}

upstream frontend {
    server frontend:3000;
}

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name _;

    client_max_body_size 50M;

    # REST API + internal callbacks (no auth at proxy level)
    location /api/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Socket.IO (realtime + preview namespaces)
    location /socket.io/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;  # 24h for long-lived WS
    }

    # Next.js static assets
    location /_next/ {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Default → Next.js (App Router pages)
    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**AI service TIDAK di-expose**. Backend yang talk ke AI via `absen-network`. AI tidak punya public entry.

---

## Routing rules

| Path | Destination | Auth | Notes |
|---|---|---|---|
| `/api/*` | backend:4000 | JWT cookie | All REST + internal callbacks |
| `/socket.io/*` | backend:4000 | JWT cookie | WebSocket upgrade |
| `/_next/*` | frontend:3000 | none | Static assets (JS, CSS, fonts) |
| `/` | frontend:3000 | none | Next.js App Router pages |
| `/internal/ai/*` (direct) | **REJECT** | — | Only reachable via `/api/internal/...` proxy |

**AI service tidak punya direct path**. Semua traffic ke AI harus lewat backend.

---

## WebSocket upgrade

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

```nginx
location /socket.io/ {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 86400s;  # critical — default 60s, kills long-lived WS
}
```

**Why `proxy_read_timeout 86400s`**: Socket.IO connections are long-lived. Default 60s timeout = connection drops every minute.

---

## Headers (forwarded to backend)

| Header | Source | Purpose |
|---|---|---|
| `Host` | `$host` | Backend knows original hostname |
| `X-Real-IP` | `$remote_addr` | Backend logs real client IP |
| `X-Forwarded-For` | `$proxy_add_x_forwarded_for` | Chain of proxies |
| `X-Forwarded-Proto` | `$scheme` | Original scheme (http/https) |
| `Upgrade` | `$http_upgrade` | WebSocket upgrade |
| `Connection` | `$connection_upgrade` | Keep-alive for WS |

**Backend** bisa pakai `X-Real-IP` untuk logging, rate limit per IP.

---

## TLS (production)

Untuk production dengan HTTPS, ada 2 opsi:

### Option A: Cloudflare in front (recommended)
```
Internet
  ↓ HTTPS
Cloudflare (TLS termination, DDoS, caching)
  ↓ HTTPS (Cloudflare Origin cert, port 443) atau HTTP (port 80)
nginx (no TLS, just proxy)
  ↓ HTTP
backend / frontend
```

Setup:
1. Cloudflare dashboard → Enable Full (strict) SSL
2. Generate Origin Certificate di Cloudflare
3. Mount cert ke nginx container
4. Update nginx config: `listen 443 ssl`

### Option B: Self-signed (dev / intranet only)
- Generate self-signed: `openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365`
- Browser warning (acceptable untuk internal)

**Recommendation**: Option A. Cloudflare Tunnel juga work (no port forwarding needed di router).

---

## docker-compose integration

```yaml
nginx:
  image: nginx:alpine
  container_name: absen-nginx
  restart: unless-stopped
  ports:
    - "80:80"           # only public port
  volumes:
    - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
  depends_on:
    - frontend
    - backend
  networks:
    - absen-network
```

**Key points**:
- Image: `nginx:alpine` (no custom build needed)
- Config mounted as read-only volume
- `depends_on` ensures nginx starts after backend/frontend (but doesn't wait for healthy)
- `networks: absen-network` so nginx can resolve `backend` and `frontend` hostnames

---

## Production hardening (TODO)

- [ ] Add `server_tokens off;` (hide version)
- [ ] Add rate limiting (`limit_req_zone`)
- [ ] Add fail2ban integration
- [ ] Enable HTTP/2 (`listen 443 ssl http2;`)
- [ ] Add security headers (CSP, X-Frame-Options, HSTS)
- [ ] Log rotation
- [ ] Add `/health` endpoint (for Cloudflare health check)
- [ ] Geo-blocking (jika perlu)
- [ ] Bot protection (rate limit /api/auth/login)

---

## Anti-pattern (JANGAN)

- ❌ Expose backend/frontend/AI port ke host (defeats purpose)
- ❌ Hardcode credentials di config
- ❌ Use `proxy_pass http://localhost:4000` (works but breaks container networking)
- ❌ Use HTTP/1.0 (deprecated, slower)
- ❌ Forget `proxy_read_timeout` (WS connections die)
- ❌ Cache POST requests (only GET should be cached)
- ❌ Log full request body (privacy + storage)

---

## Next step

→ Baca [`04-database.md`](04-database.md) untuk schema.
