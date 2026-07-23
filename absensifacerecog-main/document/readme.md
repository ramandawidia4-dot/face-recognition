# Documentation Index

> All docs in this `document/` folder are committed to the repo.
> File names use numbered prefix (`00-`, `01-`, ...) for reading order.

---

## 📖 Reading order (penting!)

Mulai dari atas. Setiap level prerequisites level sebelumnya.

### Level 1 — Konsep (baca dulu)

| # | File | Untuk apa |
|---|---|---|
| 1 | [`01-overview.md`](01-overview.md) | Latar belakang, scope, constraints, success criteria |
| 2 | [`02-architecture.md`](02-architecture.md) | Topology, data flow, sequence diagrams |
| 3 | [`03-tech-stack.md`](03-tech-stack.md) | Semua teknologi + alasan |
| 4 | [`04-principles.md`](04-principles.md) | 8 prinsip arsitektur yang LOCKED (tidak boleh dilanggar) |

### Level 2 — Master spec (untuk stakeholder & dev lead)

| # | File | Untuk apa |
|---|---|---|
| 5 | [`05-spec.md`](05-spec.md) | Master spec: tech stack, principles, API contracts, implementation order (44 step), testing, risks, changelog |
| 6 | [`06-api-contract.md`](06-api-contract.md) | Detail HTTP + WebSocket contract (frontend & AI integration) |

### Level 3 — Deployment & planning

| # | File | Untuk apa |
|---|---|---|
| 7 | [`07-deployment.md`](07-deployment.md) | Docker, env, nginx prod, backup, HTTPS |
| 8 | [`08-roadmap.md`](08-roadmap.md) | 4-phase delivery plan + Phase 6 (Security Room) |
| 9 | [`09-risks.md`](09-risks.md) | 24 risiko + mitigations |

### Level 4 — Per-service design (untuk implementer)

| # | File | Untuk apa |
|---|---|---|
| 01 | [`services/01-frontend.md`](services/01-frontend.md) | Next.js 16 + shadcn/ui + Zustand |
| 02 | [`services/02-backend.md`](services/02-backend.md) | NestJS + auth + camera + security modules |
| 03 | [`services/03-ai-service.md`](services/03-ai-service.md) | Python FastAPI + InsightFace + ONVIF |
| 04 | [`services/04-database.md`](services/04-database.md) | PostgreSQL 9 tables + 8 enums + migrations |
| 05 | [`services/05-nginx.md`](services/05-nginx.md) | Reverse proxy + WS upgrade |
| 06 | [`services/06-security.md`](services/06-security.md) | **Security Room** — server room access alert (Phase 6) |

### Level 5 — API contracts detail

| # | File | Untuk apa |
|---|---|---|
| 00 | [`api/00-overview.md`](api/00-overview.md) | API navigation index |
| 01 | [`api/01-websocket.md`](api/01-websocket.md) | WS protocol: /realtime, /preview, /security |
| 02 | [`api/02-internal-ai.md`](api/02-internal-ai.md) | Backend ↔ AI service contract |
| 03 | [`api/03-endpoints-auth.md`](api/03-endpoints-auth.md) | `/api/auth/*` |
| 04 | [`api/04-endpoints-users.md`](api/04-endpoints-users.md) | `/api/users/*` |
| 05 | [`api/05-endpoints-attendance.md`](api/05-endpoints-attendance.md) | `/api/attendance/*` |
| 06 | [`api/06-endpoints-leave.md`](api/06-endpoints-leave.md) | `/api/leaves/*` |
| 07 | [`api/07-endpoints-camera.md`](api/07-endpoints-camera.md) | `/api/cameras/*` + `/api/security/*` (Security Room) |

### Level 6 — Operational

| File | Untuk apa |
|---|---|
| [`deployment/00-overview.md`](deployment/00-overview.md) | Docker setup, env vars, nginx config, backup |
| [`planning/00-implementation-checklist.md`](planning/00-implementation-checklist.md) | 71 step daily coding guide (Phase 1-6) |

---

## Quick reference

### Stack pilihan
- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind 4, shadcn/ui, Zustand
- **Backend**: NestJS 10, TypeORM, Socket.IO, JWT RS256, bcrypt
- **AI**: Python 3.12, FastAPI, InsightFace (buffalo_l), onvif-zeep-async, ffmpeg
- **DB**: PostgreSQL 16
- **Infra**: Docker Compose, nginx, Cloudflare (optional)

### Ports
- 80 — nginx (PUBLIC)
- 4000 — backend (internal)
- 8000 — ai (internal)
- 3000 — frontend (internal)
- 5432 — postgres (internal)

### 4 services + 1 reverse proxy
- Browser → nginx (80) → backend/frontend (over Docker network)
- Backend → AI (over Docker network, X-Internal-Token)
- AI → camera (over LAN, RTSP/ONVIF)

### 8 LOCKED principles
1. Single source of truth — DB
2. Single source of truth — Realtime
3. Single source of truth — Business rule
4. Single responsibility per service
5. Loose coupling (replaceable AI)
6. Internal service auth (X-Internal-Token)
7. Idempotent camera control
8. Event-driven config sync

---

## Next step

→ Mulai dari [`01-overview.md`](01-overview.md).
