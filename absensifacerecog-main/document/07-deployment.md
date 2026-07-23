# DOCKER — Deployment Guide

> Stack: PostgreSQL + NestJS (backend) + Python AI (inference) + Next.js (frontend)

---

## 1. CURRENT LOCAL SETUP

### 1.1 Container Layout

```yaml
# docker-compose.yml
services:
  postgres:    # 127.0.0.1:5432 (host-bound, internal-only)
  backend:     # hidden, internal 4000
  ai:          # hidden, internal 8000
  frontend:    # hidden, internal 3000
  nginx:       # 0.0.0.0:80 (reverse proxy, public entry)
```

Network: `absen-network` (bridge, internal DNS). Only **nginx** publishes port 80. Backend, frontend, AI are not exposed to host — they are reached via nginx routes (`/api/*`, `/socket.io/*`, `/_next/*`, `/`).

### 1.2 Local Run

```bash
cd D:\Projecty\absen

# 1. Postgres
docker compose up -d postgres

# 2. Backend (manual, dengan hot reload)
cd backend
npm run start:dev

# 3. Python AI (manual, hot reload)
cd ai-service
uv run uvicorn app.main:app --reload --port 8000

# 4. Frontend (manual, hot reload)
cd frontend
npm run dev
```

### 1.3 Full Docker Run (current)

```bash
docker compose up -d --build
docker compose logs -f
```

---

## 2. PRODUCTION TARGET (NUC Ubuntu)

### 2.1 Server Setup (manual steps)

```bash
# On NUC Ubuntu
sudo apt update
sudo apt install -y postgresql-client

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Node.js 24 (for manual dev if needed)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# Install Python 3.12 + uv
sudo apt install -y python3.12 python3.12-venv
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2.2 Systemd Services (optional, for bare-metal deploy)

```ini
# /etc/systemd/system/absen-backend.service
[Unit]
Description=Absen NestJS Backend
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/absen
ExecStart=/usr/bin/docker compose up -d postgres backend ai
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/absen-frontend.service
[Unit]
Description=Absen Next.js Frontend
After=absen-backend.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/absen
ExecStart=/usr/bin/docker compose up -d frontend

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable absen-backend absen-frontend
sudo systemctl start absen-backend absen-frontend
```

---

## 3. ENV SETUP

### 3.1 Generate Internal Token

```bash
openssl rand -hex 32
# output: a3f2c8e1b9d4... (use this for both backend and ai-service)
```

### 3.2 Generate JWT Keys

```bash
cd /opt/absen
uv run python -c "
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
priv = key.private_bytes(encoding=serialization.Encoding.PEM, format=serialization.PrivateFormat.PKCS8, encryption_algorithm=serialization.NoEncryption())
pub = key.public_key().public_bytes(encoding=serialization.Encoding.PEM, format=serialization.PublicFormat.SubjectPublicKeyInfo)
open('keys/private.pem', 'wb').write(priv)
open('keys/public.pem', 'wb').write(pub)
print('Done')
"
```

### 3.3 Update `.env` Files

```env
# /opt/absen/.env
POSTGRES_DB=absen
POSTGRES_USER=absen_user
POSTGRES_PASSWORD=<strong-password>
POSTGRES_PORT=5432
INTERNAL_TOKEN=<random-32+chars-shared-with-backend-and-ai>

# Default admin (created on first boot if no admin exists)
SEED_ADMIN_EMAIL=admin@absenface.local
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=Admin@1234
SEED_ADMIN_FULL_NAME=System Administrator

# Security Room Module webhooks (Phase 6, optional)
# Set WEBHOOK_*_ENABLED=true to activate. Webhook only fires for severity >= WEBHOOK_MIN_SEVERITY
WEBHOOK_TELEGRAM_ENABLED=false
WEBHOOK_TELEGRAM_BOT_TOKEN=
WEBHOOK_TELEGRAM_CHAT_ID=
WEBHOOK_DISCORD_ENABLED=false
WEBHOOK_DISCORD_WEBHOOK_URL=
WEBHOOK_SLACK_ENABLED=false
WEBHOOK_SLACK_WEBHOOK_URL=
WEBHOOK_MIN_SEVERITY=critical    # only critical alerts trigger webhook

# Frontend build-time env (inlined by Next.js)
NEXT_PUBLIC_API_BASE=http://localhost/api
NEXT_PUBLIC_BACKEND_URL=http://localhost
```

```env
# /opt/absen/backend/.env
PORT=4000
NODE_ENV=production
DATABASE_URL=postgresql://absen_user:<password>@postgres:5432/absen
JWT_PRIVATE_KEY_PATH=/app/keys/private.pem
JWT_PUBLIC_KEY_PATH=/app/keys/public.pem
JWT_ACCESS_EXPIRY=900
JWT_REFRESH_EXPIRY=604800
CORS_ORIGIN=http://localhost
AI_SERVICE_URL=http://ai:8000
INTERNAL_TOKEN=<same-as-root>
THROTTLE_TTL=60
THROTTLE_LIMIT=100

SEED_ADMIN_EMAIL=admin@absenface.local
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=Admin@1234
SEED_ADMIN_FULL_NAME=System Administrator
```

```env
# /opt/absen/ai-service/.env
PORT=8000
BACKEND_URL=http://backend:4000
INTERNAL_TOKEN=<same-as-root>
RECOGNITION_CONFIDENCE_THRESHOLD=0.6
PREVIEW_FPS=1
RECONNECT_MAX_ATTEMPTS=5
RECONNECT_BACKOFF_MS=1000
```

```env
# /opt/absen/frontend/.env
NEXT_PUBLIC_API_BASE=http://localhost/api
NEXT_PUBLIC_BACKEND_URL=http://localhost
```

> **Note**: `NEXT_PUBLIC_*` env vars are inlined into the client bundle at **build time**, not runtime. Docker must pass these as `build.args` (see docker-compose.yml). To change after build, rebuild the frontend image with new values.

### 3.4 Container Layout (current)

| Service | Image | Host Port | Internal Port | Public? |
|---|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `127.0.0.1:5432` | 5432 | local only |
| `backend` | `./backend/Dockerfile` | hidden | 4000 | via nginx |
| `ai` | `./ai-service/Dockerfile` | hidden | 8000 | via nginx |
| `frontend` | `./frontend/Dockerfile` | hidden | 3000 | via nginx |
| `nginx` | `nginx:alpine` | `80` | 80 | **only public entry** |

Network: `absen-network` (bridge, internal DNS). Only nginx publishes port 80 to host. Backend, frontend, AI are all internal — accessed via nginx reverse proxy.

---

## 4. EXPOSING TO PUBLIC (Future)

### 4.1 Architecture (NUC behind NAT)

```
Internet
   │
   ▼
Cloudflare DNS (absen.yourdomain.com)
   │
   ▼
Cloudflare Tunnel (cloudflared di NUC, outbound connection)
   │
   ▼
NUC Ubuntu
   │
   ├── Nginx (port 80/443, internal)
   │     │
   │     ├── /api/* → NestJS:4000
   │     ├── /ai/* → Python:8000 (internal only, no public access)
   │     ├── /socket.io/* → NestJS:4000 (WebSocket upgrade)
   │     ├── /preview → NestJS:4000 (WebSocket namespace)
   │     └── /* → Next.js:3000
   │
   ├── NestJS:4000
   ├── Python AI:8000
   ├── Next.js:3000
   └── PostgreSQL:5432 (localhost only)
```

### 4.2 Why Cloudflare Tunnel (not port forwarding)

- ✅ Tidak perlu buka port 80/443 di router/NUC
- ✅ Cloudflare handles DDoS, WAF, rate limit
- ✅ Free SSL certificate (Cloudflare Origin)
- ✅ Cloudflare Access untuk admin-only endpoints (opsional)
- ✅ Outbound connection dari NUC (cuma ke Cloudflare) — firewall-friendly

### 4.3 Cloudflare Tunnel Setup (future)

```bash
# 1. Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# 2. Login & create tunnel
cloudflared tunnel login
cloudflared tunnel create absen

# 3. Configure
cat > /etc/cloudflared/config.yml <<EOF
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: absen.yourdomain.com
    service: http://localhost:80
  - hostname: ai.absen.yourdomain.com
    service: http://localhost:8000
  - service: http_status:404
EOF

# 4. DNS
cloudflared tunnel route dns absen absen.yourdomain.com

# 5. Run as service
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

### 4.4 Nginx Config (current — implemented)

The `nginx/default.conf` is mounted into the nginx container and used as the only entry point. Backend, frontend, and AI services are not exposed to host.

```nginx
# nginx/default.conf
upstream backend { server backend:4000; }
upstream frontend { server frontend:3000; }

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name _;
    client_max_body_size 50M;

    # REST API + WebSocket
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
        proxy_read_timeout 86400s;
    }

    # Next.js static assets
    location /_next/ {
        proxy_pass http://frontend;
    }

    # Default → Next.js
    location / {
        proxy_pass http://frontend;
    }
}
```

**AI service** (`/internal/ai/*`) is **never** exposed to public — only NestJS backend talks to it via `absen-network`. AI service does not have a public entry; nginx config does not proxy to AI.

For HTTPS, place Cloudflare in front of port 80 (see §4.3) — no nginx TLS termination needed.

---

## 5. USB CAMERA (Future)

### 5.1 Problem

Docker Desktop di Windows tidak support USB passthrough (WSL2 limitation). Hanya ONVIF/RTSP camera dari network yang works.

### 5.2 Solutions

**Option A — Linux host (NUC Ubuntu):**
```yaml
# docker-compose.yml
services:
  ai:
    devices:
      - /dev/video0:/dev/video0
      - /dev/video1:/dev/video1
      - /dev/bus/usb:/dev/bus/usb
```

**Option B — USB over IP:**
- pakai `usbip` (Linux kernel module)
- share USB device dari Windows host ke container
- kompleksitas tinggi, latency tambahan

**Option C — Hybrid (recommended for development):**
- Docker untuk Postgres + Backend + Frontend
- Python AI jalan **di Windows host langsung** (bukan container)
- AI process: `uv run uvicorn app.main:app --port 8000`
- NestJS di container connect ke `host.docker.internal:8000`

**Rekomendasi**: gunakan **ONVIF IP camera** (banyak pilihan murah: TP-Link Tapo, Hikvision, Dahua, dll). Lebih stabil, tidak ada masalah USB passthrough.

---

## 6. MONITORING (Future)

### 6.1 Health Check Endpoints

- `http://localhost:4000/api/health` (NestJS — TODO: tambah)
- `http://localhost:8000/health` (Python — sudah ada)
- `http://localhost:3000/api/health` (Next.js — TODO: tambah)

### 6.2 Logs

```bash
# All services
docker compose logs -f --tail 100

# Specific service
docker compose logs -f backend
docker compose logs -f ai
docker compose logs -f frontend
```

### 6.3 Backup

```bash
# Postgres dump
docker exec absen-postgres pg_dump -U absen_user absen > backup_$(date +%Y%m%d).sql

# Restore
cat backup_20260722.sql | docker exec -i absen-postgres psql -U absen_user -d absen
```

Automated backup: cron job + GPG encryption + offsite upload (rclone ke S3/Backblaze).

---

## 7. DEPLOY CHECKLIST (Production)

- [ ] Generate strong `INTERNAL_TOKEN` (32+ chars random)
- [ ] Generate fresh JWT keys (jangan pakai dev keys)
- [ ] Set `NODE_ENV=production` di backend
- [ ] Set `CORS_ORIGIN` ke production domain
- [ ] Enable HTTPS (Cloudflare auto)
- [ ] Set secure cookies: `secure: true` (backend `.env` & code)
- [ ] Setup backup cron
- [ ] Setup log rotation
- [ ] Monitor disk space (InsightFace model + DB growth)
- [ ] Document runbook untuk incident response
- [ ] Test disaster recovery (restore from backup)
