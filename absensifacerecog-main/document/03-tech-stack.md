# 02 — Tech Stack

> Setiap pilihan teknologi + alasan + alternatif yang dipertimbangkan.

---

## Ringkasan

| Layer | Pilihan | Versi | Alasan singkat |
|---|---|---|---|
| Frontend framework | Next.js | 16.x | App Router, standalone build, ekosistem |
| Frontend language | TypeScript | 5.x | Type safety end-to-end |
| Frontend UI | shadcn/ui | base-nova | Copy-paste, no lock-in, modern |
| Frontend state | Zustand | latest | Simple, less boilerplate dari Redux |
| Backend framework | NestJS | 10.x | TypeScript backend, modular, mature |
| Backend ORM | TypeORM | latest | Decorator-based, sync dengan NestJS |
| Backend WS | Socket.IO | 4.x | Same as NestJS gateway, auto-reconnect |
| AI framework | FastAPI | 0.115+ | Async native, Pydantic validation |
| AI face | InsightFace | 0.7+ | Buffalo_L model, SOTA accuracy |
| AI ONVIF | onvif-zeep-async | 3.2+ | Async, support modern ONVIF specs |
| AI video | ffmpeg | 4.4+ | De-facto RTSP decoder |
| AI HTTP | requests | 2.32+ | Sync from worker threads |
| Database | PostgreSQL | 16-alpine | ACID, JSON support, mature |
| Auth | JWT RS256 | — | Asymmetric, can verify without private key |
| Hash | bcrypt | 5+ | 12 rounds, slow-by-design |
| Reverse proxy | nginx | alpine | Battle-tested, low memory |
| Container | Docker Compose | v2+ | Multi-container, single host |
| Python pkg | uv | 0.11+ | Fast, replaces pip+venv |
| Node pkg | npm | 10+ | Built-in, no extra dep |

---

## Frontend

### Next.js 16 (App Router)
**Kenapa**:
- Built-in routing (no react-router)
- Server Components untuk optimasi initial load
- Standalone output untuk Docker (slim image ~150MB)
- Image optimization built-in
- Middleware (Edge runtime) untuk auth redirect

**Alternatif**:
- **Remix** — bagus tapi ekosistem lebih kecil
- **SvelteKit** — lebih simple, tapi tim mungkin tidak familiar
- **Vite + React Router** — lebih fleksibel, tapi banyak yang harus di-setup manual

**Trade-off**:
- Next.js opinionated (struktur folder, API routes, dll) — tim harus ikut convention
- Build time lebih lama dari Vite

### TypeScript strict mode
**Kenapa**:
- Catch type errors saat build, bukan runtime
- Auto-completion di IDE
- Self-documenting

**Config**:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

### shadcn/ui (base-nova style)
**Kenapa**:
- Component code di-copy ke project (no npm dependency bloat)
- Bisa customize 100% (bukan library lock-in)
- Tailwind-based, consistent dengan ekosistem
- Base-nova style = modern, neutral colors

**Alternatif**:
- **Material UI** — bagus tapi Material banget, susah customize
- **Chakra UI** — bagus tapi runtime overhead
- **Ant Design** — enterprise look, terlalu "China-style"

### Zustand
**Kenapa**:
- Less boilerplate dari Redux (no actions, reducers, dispatch)
- TypeScript-friendly
- Tiny bundle size

**Alternatif**:
- **Jotai** — atom-based, bagus untuk complex state
- **Context API** — built-in tapi re-render semua consumers

**Future**: Mungkin tambah `@tanstack/react-query` untuk server state caching.

### Tailwind CSS v4
**Kenapa**:
- Utility-first, no context switch ke file CSS
- v4: CSS-first config (no `tailwind.config.js` needed, semua di `globals.css`)
- Tree-shaking by default (no purge step)

### axios
**Kenapa**:
- Interceptor built-in (auto-refresh on 401)
- `withCredentials: true` untuk cookie
- Better DX dari fetch

### socket.io-client
**Kenapa**:
- Same as backend (consistency)
- Auto-reconnect built-in
- Fallback to long-polling if WebSocket blocked

---

## Backend

### NestJS 10
**Kenapa**:
- TypeScript end-to-end (sama dengan frontend)
- Modular architecture (Module → Controller → Service → Repository)
- Built-in dependency injection
- Decorator-based (mirip Spring Boot, mudah dibaca)
- Throttler module built-in (rate limiting)
- Helmet integration untuk security headers

**Alternatif**:
- **Express + tsoa** — lebih simple, tapi banyak setup manual
- **Fastify + TypeBox** — lebih cepat, tapi ekosistem NestJS lebih besar
- **Hono** — modern, edge-runtime, tapi masih baru

**Trade-off**:
- NestJS verbose (banyak file untuk 1 feature)
- Belajar curve decorator

### TypeORM
**Kenapa**:
- Decorator-based, sync dengan NestJS
- Auto-migration dengan `synchronize: true` (dev only, prod pakai migrations)
- Snake case naming strategy built-in

**Alternatif**:
- **Prisma** — modern, type-safe, tapi tidak native ke NestJS DI
- **Drizzle** — ringan, tapi lebih low-level
- **MikroORM** — bagus, tapi lebih jarang

**Decision**: `synchronize: true` di dev untuk fast iteration. **Production WAJIB pakai SQL migrations** (numbered files).

### Socket.IO 4
**Kenapa**:
- Auto-reconnect, fallback, room semantics
- WebSocket gateway built-in di NestJS
- 3 namespaces: `/realtime` (events) + `/preview` (frames) + `/security` (security alerts)

### JWT RS256
**Kenapa**:
- Asymmetric: backend sign dengan private key, FE verify dengan public key (tapi FE tidak perlu verify, backend saja)
- Bisa distribute public key ke services lain untuk verify tanpa akses private
- 2048-bit key, generated sekali di setup

**Alternatif**:
- **HS256 (HMAC)** — simpler, tapi symmetric (anyone who can verify can also sign)
- **Session cookie** — stateful, butuh session store, tidak scalable

### bcrypt (12 rounds)
**Kenapa**:
- Slow-by-design (resist brute force)
- 12 rounds = ~250ms per hash (acceptable login latency)

---

## AI Service

### Python 3.12 + FastAPI
**Kenapa**:
- Async native (good untuk banyak kamera concurrent)
- Pydantic validation (mirip TypeScript types)
- OpenAPI auto-generated (untuk testing)
- Mature ecosystem (InsightFace wrapper)

**Alternatif**:
- **Go (Fiber/Gin)** — lebih cepat, tapi face recognition libraries lebih sedikit
- **Rust (Actix)** — paling cepat, tapi steep learning curve
- **Node.js** — bisa, tapi InsightFace/ONVIF libs lebih matang di Python

### InsightFace (buffalo_l)
**Kenapa**:
- SOTA accuracy (ArcFace, 99.8% on LFW)
- Pre-trained models ready (buffalo_l = Light + accurate)
- 512-dim embeddings (standard)
- Active maintenance

**Alternatif**:
- **FaceNet** — bagus, tapi lebih tua
- **dlib** — lebih ringan, tapi akurasi lebih rendah
- **CompreFace** — full SaaS, tidak on-premise friendly

### onvif-zeep-async
**Kenapa**:
- Pure Python, tidak butuh native deps berat
- Support modern ONVIF specs (Profile S, T, G)
- Async (cocok dengan FastAPI)

**Alternatif**:
- **python-onvif-zeep** — sync only, blocking
- **onvif-camera** — limited features
- **Manual SOAP** — kerja tapi reinvent wheel

### ffmpeg
**Kenapa**:
- De-facto RTSP decoder
- Pipe output ke Python (raw BGR24)
- Scale + crop filter built-in
- Reconnect logic mature

**Note**: ffmpeg **bukan** di-spawn oleh backend. Backend delegate ke AI service. AI spawn ffmpeg di worker thread (bukan event loop).

### requests (sync)
**Kenapa**:
- AI service pakai worker threads (`threading.Thread` untuk per-camera ffmpeg)
- Dari thread, tidak bisa `asyncio.run()` tanpa bikin event loop baru tiap call (broken)
- Sync `requests` lebih reliable di thread context

**Trade-off**: Sync I/O di async FastAPI = block event loop sebentar (50-100ms per call). Untuk callback rate (1 FPS per camera = 5 cameras = 5 req/s), ini acceptable.

---

## Database

### PostgreSQL 16
**Kenapa**:
- ACID (data integrity penting untuk absensi)
- JSON support (untuk audit_log details)
- Mature, banyak tools
- Performance bagus untuk 100-1000 users (use case kita)

**Alternatif**:
- **MySQL** — setara, tapi PG lebih cocok untuk JSON + extensions
- **SQLite** — lebih simple, tapi tidak multi-container friendly
- **MongoDB** — flexible, tapi relasi data kita kompleks (users → attendances → audit_logs)

### Snake case naming
**Kenapa**:
- SQL convention: `created_at`, `password_hash`
- TypeORM: `@Column({ name: 'created_at' })` → otomatis snake_case via `SnakeNamingStrategy`

---

## Infrastructure

### Docker Compose
**Kenapa**:
- Single-host deployment (cocok untuk NUC)
- No orchestrator needed (no k8s overhead)
- Reproducible

**Alternatif**:
- **k8s** — overkill untuk single-node
- **Nomad** — bagus, tapi learning curve
- **Systemd** — low-level, banyak manual config

### nginx
**Kenapa**:
- TLS termination
- WebSocket upgrade headers
- Static file serving
- Battle-tested
- Memory footprint kecil

**Alternatif**:
- **Traefik** — bagus, tapi lebih berat
- **Caddy** — simple, auto-TLS, tapi fitur WebSocket upgrade perlu config
- **HAProxy** — bagus untuk load balancing, tapi overkill

### uv (Python package manager)
**Kenapa**:
- 10-100x lebih cepat dari pip
- Drop-in replacement (pakai `pyproject.toml`)
- Built-in venv management
- Deterministic lock files

---

## Excluded (NOT used)

| Tidak dipakai | Alasan |
|---|---|
| **Redux / MobX** | Zustand cukup untuk scope ini |
| **GraphQL** | REST + WebSocket cukup, GraphQL overhead |
| **Redis** | Premature optimization. Cache di-memory cukup untuk v1 |
| **Kafka / RabbitMQ** | Tidak perlu event queue. HTTP callback cukup |
| **MongoDB / NoSQL** | Data kita relasional, PG lebih cocok |
| **Kubernetes** | Overkill untuk single-node NUC |
| **OAuth / SSO** | Internal app, JWT cukup |
| **Cloud AI (AWS Rekognition)** | Butuh internet, data privacy |
| **Terraform / Ansible** | Manual setup cukup untuk single host |

---

## Next step

→ Baca [`04-principles.md`](04-principles.md) untuk aturan main yang tidak boleh dilanggar.
