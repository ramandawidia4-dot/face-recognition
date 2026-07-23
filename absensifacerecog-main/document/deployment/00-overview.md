# Deployment Guide

> Docker Compose orchestration + environment configuration + production hardening.

---

## Overview

Single `docker-compose.yml` brings up 5 services:

| Service | Image | Internal port | Host port | Public? |
|---|---|---|---|---|
| nginx | nginx:alpine | 80 | **80** | YES (only) |
| backend | (local Dockerfile) | 4000 | hidden | NO |
| ai | (local Dockerfile) | 8000 | hidden | NO |
| frontend | (local Dockerfile) | 3000 | hidden | NO |
| db | postgres:16-alpine | 5432 | hidden | NO |

All services on shared `absen-network` (bridge, internal DNS).

---

## Quick start (local dev)

```bash
# 1. Clone
git clone <repo>
cd absen

# 2. Generate secrets + JWT keys
echo "INTERNAL_TOKEN=$(openssl rand -hex 32)" >> .env
mkdir -p backend/keys
uv run --with cryptography python -c "
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
priv = key.private_bytes(encoding=serialization.Encoding.PEM, format=serialization.PrivateFormat.PKCS8, encryption_algorithm=serialization.NoEncryption())
pub = key.public_key().public_bytes(encoding=serialization.Encoding.PEM, format=serialization.PublicFormat.SubjectPublicKeyInfo)
open('backend/keys/private.pem', 'wb').write(priv)
open('backend/keys/public.pem', 'wb').write(pub)
"

# 3. Set env
cp .env.example .env
# Edit .env: passwords, secrets

# 4. Start
docker compose up -d --build

# 5. Verify
curl http://localhost/api/auth/login -X POST -H "Content-Type: application/json" \
  -d '{"identifier":"admin","password":"Admin@1234"}'
```

Default admin credentials (set in `SEED_ADMIN_*` env):
- email: `admin@absenface.local`
- username: `admin`
- password: `Admin@1234` (change in `.env` before first boot!)

---

## Environment variables

### Root `.env` (shared between services)

```env
# Database
POSTGRES_DB=absen
POSTGRES_USER=absen_user
POSTGRES_PASSWORD=<strong-password>
POSTGRES_PORT=5432

# Internal service-to-service auth
INTERNAL_TOKEN=<random-32+chars>

# Default admin (created on first boot)
SEED_ADMIN_EMAIL=admin@absenface.local
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=Admin@1234
SEED_ADMIN_FULL_NAME=System Administrator

# Frontend build-time
NEXT_PUBLIC_API_BASE=http://localhost/api
NEXT_PUBLIC_BACKEND_URL=http://localhost
```

### `backend/.env`

```env
PORT=4000
NODE_ENV=production
DATABASE_URL=postgresql://absen_user:absen_password@postgres:5432/absen

JWT_PRIVATE_KEY_PATH=/app/keys/private.pem
JWT_PUBLIC_KEY_PATH=/app/keys/public.pem
JWT_ACCESS_EXPIRY=900
JWT_REFRESH_EXPIRY=604800

CORS_ORIGIN=http://localhost
THROTTLE_TTL=60
THROTTLE_LIMIT=100

AI_SERVICE_URL=http://ai:8000
INTERNAL_TOKEN=<same-as-root>

SEED_ADMIN_EMAIL=admin@absenface.local
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=Admin@1234
SEED_ADMIN_FULL_NAME=System Administrator
```

### `ai-service/.env`

```env
PORT=8000
BACKEND_URL=http://backend:4000
INTERNAL_TOKEN=<same-as-root>
RECOGNITION_CONFIDENCE_THRESHOLD=0.6
PREVIEW_FPS=1
RECONNECT_MAX_ATTEMPTS=5
RECONNECT_BACKOFF_MS=1000
```

### `frontend/.env` (build-time only)

```env
NEXT_PUBLIC_API_BASE=http://localhost/api
NEXT_PUBLIC_BACKEND_URL=http://localhost
```

> ⚠️ `NEXT_PUBLIC_*` di-inline saat build. Tidak bisa di-set saat runtime.

---

## docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: absen-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - absen-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    container_name: absen-backend
    restart: unless-stopped
    env_file: backend/.env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    volumes:
      - ./backend/keys:/app/keys:ro
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - absen-network

  ai:
    build: ./ai-service
    container_name: absen-ai
    restart: unless-stopped
    env_file: ai-service/.env
    environment:
      BACKEND_URL: http://backend:4000
    volumes:
      - insightface_models:/root/.insightface
    # network_mode: host  # for LAN camera access (alternative to bridge)
    depends_on:
      - backend
    networks:
      - absen-network

  frontend:
    build:
      context: ./frontend
      args:
        NEXT_PUBLIC_API_BASE: ${NEXT_PUBLIC_API_BASE}
        NEXT_PUBLIC_BACKEND_URL: ${NEXT_PUBLIC_BACKEND_URL}
    container_name: absen-frontend
    restart: unless-stopped
    environment:
      NEXT_PUBLIC_API_BASE: ${NEXT_PUBLIC_API_BASE}
      NEXT_PUBLIC_BACKEND_URL: ${NEXT_PUBLIC_BACKEND_URL}
    depends_on:
      - backend
    networks:
      - absen-network

  nginx:
    image: nginx:alpine
    container_name: absen-nginx
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - frontend
      - backend
    networks:
      - absen-network

volumes:
  postgres_data:
  insightface_models:

networks:
  absen-network:
    driver: bridge
```

---

## Network modes for AI service

AI service needs to reach cameras on the LAN (`192.168.1.0/24` typically). Options:

### Option A: Default bridge (current)

AI container has its own IP in `172.20.0.0/16` (Docker network). Can still reach LAN via NAT through Docker's bridge to host's `eth0` (assuming default `masquerade` rules).

**Works if**: Docker default iptables rules allow it (usually yes).

### Option B: host network (recommended for reliability)

```yaml
ai:
  network_mode: host
```

AI container shares host's network namespace. Can directly bind to LAN IP.

**Pros**: simpler, no NAT issues
**Cons**: loses Docker network isolation, can't use `http://backend:4000` (must use `http://localhost:4000` or `127.0.0.1:4000`)

**Workaround**: in `ai-service/.env`, use `BACKEND_URL=http://host.docker.internal:4000` (Docker Desktop) or `http://172.17.0.1:4000` (Linux).

### Option C: macvlan (advanced)

Create a Docker network that shares the LAN subnet directly. Each container gets its own LAN IP.

**Pros**: full LAN access, no NAT
**Cons**: complex setup, depends on network infra (router must allow Docker's MAC addresses)

**Recommendation**: start with Option A. Switch to Option B if camera discovery fails.

---

## LAN access from AI container

If cameras on `192.168.1.0/24` not reachable from AI container:

```bash
# Test from inside AI container
docker exec absen-ai ping 192.168.1.9
docker exec absen-ai nc -zv 192.168.1.9 554
```

If fails:
1. Check host's iptables: `sudo iptables -L -n -t nat`
2. Check host's default route: `ip route`
3. Try `network_mode: host` (Option B)

---

## Production deployment (NUC Ubuntu)

### Server setup

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Node 24 (for manual dev)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# Install uv (for manual dev)
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Firewall

```bash
# Allow only port 80 (nginx)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw enable

# Or with Cloudflare Tunnel, allow nothing:
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw enable
# (Cloudflare Tunnel makes outbound connection to Cloudflare, no inbound needed)
```

### Systemd service (auto-start on boot)

```ini
# /etc/systemd/system/absen.service
[Unit]
Description=Absen Attendance System
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/absen
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable absen.service
sudo systemctl start absen.service
```

---

## HTTPS via Cloudflare (recommended for production)

1. Sign up Cloudflare, add your domain
2. Update nameservers di registrar
3. Cloudflare dashboard → SSL/TLS → Full (strict)
4. Cloudflare dashboard → Origin Server → Create Certificate
5. Save cert + private key to `/opt/absen/nginx/ssl/`
6. Update `docker-compose.yml`:
   ```yaml
   nginx:
     volumes:
       - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
       - ./nginx/ssl/:/etc/nginx/ssl/:ro
   ```
7. Update `nginx/default.conf`:
   ```nginx
   server {
       listen 443 ssl http2;
       ssl_certificate     /etc/nginx/ssl/cert.pem;
       ssl_certificate_key /etc/nginx/ssl/key.pem;
       ...
   }
   ```
8. Restart: `docker compose restart nginx`

---

## HTTPS via Cloudflare Tunnel (no port forwarding)

1. Install cloudflared: `sudo apt install cloudflared` (or download from GitHub)
2. Login: `cloudflared tunnel login`
3. Create tunnel: `cloudflared tunnel create absen`
4. Configure `/etc/cloudflared/config.yml`:
   ```yaml
   tunnel: <TUNNEL_ID>
   credentials-file: /etc/cloudflared/<TUNNEL_ID>.json
   
   ingress:
     - hostname: absen.yourdomain.com
       service: http://localhost:80
     - service: http_status:404
   ```
5. DNS: `cloudflared tunnel route dns absen absen.yourdomain.com`
6. Run as service: `sudo cloudflared service install`
7. Now `https://absen.yourdomain.com` works WITHOUT opening port 80 on router

---

## Backup

### Database

```bash
# Daily cron at 02:00
docker exec absen-postgres pg_dump -U absen_user absen | gzip > /backup/absen-$(date +%Y%m%d).sql.gz

# Retention 30 days
find /backup -name "absen-*.sql.gz" -mtime +30 -delete
```

### Crontab entry

```cron
0 2 * * * /opt/absen/scripts/backup.sh
```

### Encrypt + offsite

```bash
# Encrypt
gpg --symmetric --cipher-algo AES256 /backup/absen-20260723.sql.gz

# Upload to S3 (after rclone config)
rclone copy /backup/ remote:absen-backup/ --include "*.gpg"
```

### Restore

```bash
# Stop backend (prevent new writes)
docker compose stop backend

# Restore
zcat /backup/absen-20260723.sql.gz | docker exec -i absen-postgres psql -U absen_user -d absen

# Start backend
docker compose start backend
```

---

## Logs

```bash
# All services
docker compose logs -f --tail 100

# Specific service
docker compose logs -f backend

# Timestamp filter
docker compose logs --since "2026-07-23T08:00:00"
```

### Log rotation (TODO)

Add to `/etc/logrotate.d/docker-compose`:
```
/var/lib/docker/containers/*/*.log {
    rotate 7
    daily
    compress
    missingok
    notifempty
    copytruncate
}
```

---

## Monitoring (TODO)

- **Uptime monitoring**: UptimeRobot / Betterstack (ping `/health` every 60s)
- **Error tracking**: Sentry (frontend + backend)
- **Metrics**: Prometheus + Grafana
- **Alerts**: PagerDuty / Telegram bot

For v1: manual log check is enough.

---

## Next step

→ Baca [`08-roadmap.md`](../08-roadmap.md) untuk phased delivery plan.
