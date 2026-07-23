# SPESIFIKASI TEKNIS — SISTEM ABSENSI v3

> Last updated: 2026-07-22
> Status: Refactor in progress — Separation of Concerns enforcement

---

## 1. PRINSIP ARSITEKTUR (LOCKED)

| Prinsip | Aturan |
|---|---|
| **Single Source of Truth — Database** | Hanya **NestJS** yang akses PostgreSQL. Python AI **DILARANG** import `psycopg`/`asyncpg`/ORM apapun. |
| **Single Source of Truth — Realtime** | Hanya **NestJS** yang kirim event ke frontend via WebSocket. Python AI **DILARANG** punya koneksi WebSocket ke frontend. |
| **Single Source of Truth — Business Rule** | Hanya **NestJS** yang tahu aturan absensi (jam kerja, cuti, double check-in, threshold confidence). Python AI hanya hasil inferensi murni. |
| **Single Responsibility** | Python AI: inference. NestJS: orkestrasi + persistensi. Frontend: presentasi. |
| **Loose Coupling** | Python AI bisa diganti (Go, Rust, cloud AI) tanpa ubah business logic NestJS. |
| **Internal Service Auth** | Komunikasi Python ↔ NestJS pakai shared secret header `X-Internal-Token`. Bukan JWT user. |
| **Idempotent Camera Control** | Start/Stop/Restart/Reload endpoint return 200 dengan `{status: "already_running"}` atau `{status: "started"}` — bukan 409 Conflict. Aman untuk retry/click berulang. |
| **Event-Driven Config Sync** | Perubahan camera config di NestJS → push HTTP ke Python (per-camera). Tidak ada polling DB dari Python. Restart per-camera, bukan seluruh AI service. |

---

## 2. ARSITEKTUR FINAL

```
┌──────────────────────────────────────────────────────────────────┐
│ IP Camera (RTSP / ONVIF / USB)                                   │
└────────────────────────┬─────────────────────────────────────────┘
                         │ 1 koneksi RTSP per camera
                         ▼
              ┌──────────────────────┐
              │  Python AI (FastAPI) │
              │  Port 8000           │
              │                      │
              │  - FFmpeg (full FPS) │
              │  - OpenCV            │
              │  - InsightFace       │
              │  - ArcFace           │
              │  - Camera FSM        │
              │    (STOPPED/         │
              │     CONNECTING/      │
              │     RUNNING/         │
              │     RECONNECTING/    │
              │     ERROR)           │
              │  - Preview 1 FPS     │
              └──────┬───────────────┘
                     │
       ┌─────────────┴─────────────┐
       │                           │
       │ (1) Detection event       │ (2) Preview JPEG (1 FPS)
       │ HTTPS POST                │ HTTPS POST
       │ /internal/ai/recognition  │ /internal/ai/frame
       │                           │
       │ (3) State change          │
       │ HTTPS POST                │
       │ /internal/ai/state-change │
       │                           │
       ▼                           ▼
┌──────────────────────────────────────────────────────────────────┐
│ NestJS (Backend)                                                 │
│ Port 4000                                                        │
│                                                                  │
│ - SATU-SATUNYA yang akses PostgreSQL                             │
│ - Business logic (attendance rules, validation, threshold)       │
│ - WebSocket gateway ke frontend                                  │
│ - HTTP client ke Python (internal, signed)                       │
│                                                                  │
│ WebSocket namespaces:                                            │
│   /realtime → attendance.created, camera.status                  │
│   /preview  → camera.frame                                       │
│   /security → security.alert                                     │
│                                                                  │
│ /internal/* endpoints untuk Python callback                      │
└────────────────────────┬─────────────────────────────────────────┘
                         │ WebSocket + HTTPS
                         ▼
                  ┌──────────────┐
                  │ Browser      │
                  │ Next.js 15   │
                  └──────────────┘
```

---

## 3. TECH STACK

| Layer | Teknologi | Versi |
|---|---|---|
| Frontend | Next.js, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Zustand, socket.io-client, axios | 16.x |
| Backend | NestJS, TypeScript, TypeORM, Socket.IO | 10.x |
| AI Service | Python FastAPI, InsightFace, OpenCV, onvif-zeep-async | 3.12 |
| Database | PostgreSQL | 16-alpine |
| Reverse Proxy | nginx (alpine) | latest |
| Auth (user) | JWT (RS256), bcrypt | — |
| Auth (internal) | Shared secret header `X-Internal-Token` | — |
| Container | Docker Compose | v3.8+ |
| Package Mgr (Python) | uv | 0.11+ |

---

## 4. STRUKTUR PROJECT

```
absen/
├── spec.md                          ← this file
├── architecture.md                  ← high-level design + flow
├── api-contract.md                           ← API contract
├── deployment.md                        ← deployment guide
├── docker-compose.yml
├── .env.example
├── .gitignore
│
├── backend/                         # NestJS (port 4000)
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   ├── nest-cli.json
│   ├── Dockerfile
│   ├── .env
│   └── src/
│       ├── main.ts
│       ├── app.module.ts
│       ├── config/
│       │   ├── database.config.ts
│       │   ├── jwt.config.ts
│       │   ├── app.config.ts
│       │   └── ai.config.ts
│       ├── common/
│       │   ├── guards/
│       │   │   ├── jwt-auth.guard.ts
│       │   │   ├── roles.guard.ts
│       │   │   └── internal-token.guard.ts
│       │   ├── decorators/
│       │   │   ├── roles.decorator.ts
│       │   │   ├── public.decorator.ts
│       │   │   └── current-user.decorator.ts
│       │   ├── filters/
│       │   │   └── http-exception.filter.ts
│       │   ├── interceptors/
│       │   │   └── audit-log.interceptor.ts
│       │   ├── pipes/
│       │   │   └── sanitize.pipe.ts
│       │   └── ai/
│       │       ├── ai-client.service.ts        # HTTP client → Python
│       │       └── face-embedding.service.ts    # CRUD embedding di DB
│       ├── modules/
│       │   ├── auth/
│       │   ├── users/
│       │   ├── attendance/
│       │   │   ├── attendance.module.ts
│       │   │   ├── attendance.controller.ts
│       │   │   ├── attendance.service.ts        # + createFromAiDetection()
│       │   │   ├── attendance.gateway.ts       # WS /realtime
│       │   │   ├── entities/attendance.entity.ts
│       │   │   └── dto/attendance.dto.ts
│       │   ├── security/                       # NEW: Security Room Module
│       │   │   ├── security.module.ts
│       │   │   ├── entities/
│       │   │   │   ├── security-camera.entity.ts
│       │   │   │   └── security-alert.entity.ts
│       │   │   ├── services/
│       │   │   │   ├── security-camera.service.ts
│       │   │   │   ├── security-alert.service.ts
│       │   │   │   └── webhook.service.ts
│       │   │   ├── controllers/
│       │   │   │   ├── security-camera.controller.ts
│       │   │   │   └── security-alert.controller.ts
│       │   │   └── gateways/
│       │   │       └── security.gateway.ts      # WS /security
│       │   ├── leave/
│       │   ├── audit-log/
│       │   ├── camera/
│       │   │   ├── camera.module.ts
│       │   │   ├── camera.controller.ts         # idempotent, delegasi ke AI
│       │   │   ├── camera.service.ts
│       │   │   ├── preview.service.ts           # preview FFmpeg + cache
│       │   │   ├── preview.gateway.ts           # WS /preview
│       │   │   ├── entities/
│       │   │   │   ├── camera.entity.ts
│       │   │   │   └── face-embedding.entity.ts
│       │   │   └── dto/camera.dto.ts
│       │   └── internal/                       # callback dari Python
│       │       ├── internal.module.ts
│       │       ├── internal.controller.ts       # /internal/ai/*
│       │       └── ai-recognition.service.ts
│       └── database/migrations/
│
├── ai-service/                      # Python FastAPI (port 8000)
│   ├── pyproject.toml
│   ├── Dockerfile
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── state.py                  # global camera state manager
│       ├── middleware/
│       │   └── auth.py               # X-Internal-Token validation
│       ├── models/
│       │   └── schemas.py            # Pydantic
│       ├── services/
│       │   ├── onvif_discovery.py
│       │   ├── usb_detection.py
│       │   ├── stream_manager.py     # FFmpeg subprocess per camera
│       │   ├── frame_decoder.py
│       │   ├── face_detector.py
│       │   ├── face_recognizer.py
│       │   ├── embedding_store.py    # in-memory cache
│       │   ├── recognition_pipeline.py
│       │   ├── preview_generator.py
│       │   └── state_reporter.py
│       └── routes/
│           ├── health.py
│           ├── cameras.py            # /internal/ai/cameras/{id}/*
│           ├── faces.py              # /internal/ai/register-face, /sync
│           ├── discover.py           # /internal/ai/discover
│           └── boot.py               # /internal/ai/boot-sync
│
└── frontend/                         # Next.js 16 (port 3000)
    ├── package.json
    ├── next.config.ts                 # output: "standalone" for Docker
    ├── components.json                # shadcn/ui config
    ├── Dockerfile                     # multi-stage standalone
    └── src/
        ├── proxy.ts                   # auth redirect (Next.js 16 convention)
        ├── lib/
        │   ├── api.ts                 # axios withCredentials + auto-refresh
        │   ├── socket.ts              # socket.io singleton
        │   └── utils.ts               # cn() helper
        ├── stores/                    # Zustand
        │   ├── auth-store.ts
        │   ├── realtime-store.ts
        │   └── ui-store.ts
        ├── hooks/
        │   ├── useAuth.ts
        │   ├── useRealtime.ts         # subscribe /realtime events
        │   └── useCameraStream.ts     # subscribe /preview frames
        ├── types/
        │   └── index.ts               # User, Attendance, Leave, Camera, WS events
        ├── components/
        │   ├── ui/                    # 60 shadcn components
        │   ├── app-sidebar.tsx
        │   ├── camera-live.tsx
        │   ├── main-nav.tsx
        │   └── theme-provider.tsx
        └── app/
            ├── layout.tsx
            ├── page.tsx               # redirect /dashboard
            ├── login/
            ├── globals.css            # Tailwind v4 + shadcn vars
            └── (dashboard)/           # route group — shared sidebar layout
                ├── layout.tsx
                ├── dashboard/
                ├── attendance/
                ├── leave/
                └── admin/
                    ├── users/
                    ├── cameras/      # live preview cards
                    ├── leaves/
                    ├── reports/
                    └── register-face/
```

### Frontend Routes

| Path | Auth | Deskripsi |
|---|---|---|
| `/login` | public | Split-panel login (email/username + password) |
| `/dashboard` | JWT | Stats + recent attendances (realtime) |
| `/attendance` | JWT | List + check-in/out buttons |
| `/leave` | JWT | List + request leave dialog |
| `/admin/users` | JWT + admin | CRUD + username field |
| `/admin/cameras` | JWT + admin | **Live preview** cards + fullscreen modal |
| `/admin/leaves` | JWT + admin | Approve/reject actions |
| `/admin/reports` | JWT + admin | Filtered attendance reports |
| `/admin/register-face` | JWT + admin | Webcam capture (getUserMedia) |

---

## 5. DATABASE SCHEMA

### 5.1 Tables

| Table | Purpose |
|---|---|
| `users` | User account (employee + admin) |
| `refresh_tokens` | JWT refresh token storage |
| `attendances` | Daily check-in/out records |
| `leaves` | Leave/permission requests |
| `audit_logs` | All API action logs |
| `cameras` | Camera configuration (RTSP URL, ONVIF host, USB path) |
| `face_embeddings` | User face embedding (512-dim float array) |

**Akses**: hanya NestJS. Python AI **TIDAK PERNAH** query/insert ke tabel manapun.

---

## 6. SERVICE BOUNDARIES (KONTRAK)

### 6.0 Preview Cache Policy

NestJS menyimpan last frame per camera di memory (`Map<cameraId, {frame, captured_at}>`) dengan **TTL 10 detik**.

- Setiap `POST /internal/ai/frame` masuk → update cache + set timer
- Setelah 10 detik tanpa frame baru → cache expired → broadcast ke frontend `camera.frame_error` dengan `{reason: "no_frame"}` → frontend tampilkan "offline"
- Alasan: kalau Python mati, frontend tidak terus menampilkan gambar basi. Bisa detect Python down dengan cepat.

### 6.0.5 Security Room Module (Separate from Attendance)

Security room cameras are **fully separate** from attendance cameras — own table, own endpoints, own WebSocket namespace, own AI pipeline.

#### `security_cameras` table

```sql
CREATE TABLE security_cameras (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    source security_camera_source NOT NULL,  -- 'onvif' | 'rtsp' | 'usb'
    rtsp_url VARCHAR(500),
    usb_device_path VARCHAR(100),
    onvif_host VARCHAR(100),
    onvif_port INTEGER DEFAULT 80,
    onvif_username VARCHAR(100),
    onvif_password VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    location VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE security_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    camera_id UUID NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE,
    face_known BOOLEAN NOT NULL,
    matched_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    confidence REAL NOT NULL,
    bounding_box JSONB NOT NULL,
    snapshot_jpeg TEXT NOT NULL,
    severity alert_severity NOT NULL,  -- 'info' | 'warning' | 'critical'
    reviewed BOOLEAN DEFAULT false,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    notes TEXT,
    captured_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Why separate table (not `cameras.mode` column)

- **Different business logic**: attendance = check-in/out, security = always alert
- **Different endpoints**: `/api/cameras` (attendance) vs `/api/security/cameras` (security)
- **Different WebSocket namespace**: `/realtime` vs `/security`
- **Different camera lifecycle**: attendance cameras may stop for break, security cameras always on
- **Different UI**: `/admin/cameras` vs `/admin/security/cameras`
- **Future**: security cameras may have different storage/retention policies

#### Behavior

| Aspect | Attendance (`cameras`) | Security (`security_cameras`) |
|---|---|---|
| Known face | check-in/out | log info alert |
| Unknown face | silent drop | alert (warning/critical) |
| Snapshot | not saved | saved (face crop) |
| Auto check-in | yes | no |
| API base | `/api/cameras` | `/api/security/cameras` |
| WS namespace | `/realtime` | `/security` |
| AI pipeline | report ONLY matched faces | report ALL faces |

#### AI service change

- Backend sends set of security camera IDs to AI at boot (`GET /internal/ai/boot-sync`)
- AI stores `security_camera_ids: Set[str]` in `app_state`
- In `recognition_pipeline.py`: check `camera_id in security_camera_ids`
  - If `True` → report ALL faces (known + unknown), always send `face_known`, `snapshot_base64`
  - If `False` → existing behavior (only matched faces for attendance)

#### Backend change

- `ai-recognition.service.ts`: check if `camera_id` exists in `security_cameras` table
  - If yes → call `SecurityAlertService.processDetection()` (never attendance)
  - If no → existing attendance flow

#### WebSocket

- New namespace: `/security` with `SecurityGateway`
- Event: `security.alert` (payload includes camera_name, severity, snapshot_base64, matched_user_id, confidence)

Detail lengkap di `services/06-security.md`.

### 6.1 Frontend → NestJS (HTTPS + WebSocket)

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| `POST` | `/api/auth/register` | — | Register user baru |
| `POST` | `/api/auth/login` | — | Login → JWT cookie (accepts email OR username as `identifier`) |
| `POST` | `/api/auth/refresh` | Cookie | Refresh access token |
| `POST` | `/api/auth/logout` | Cookie | Logout |
| `GET` | `/api/auth/me` | JWT | Current user |
| `GET/POST/PATCH/DELETE` | `/api/users/*` | JWT + admin | User CRUD (with optional `username` field) |
| `POST` | `/api/attendance/check-in` | JWT | Manual check-in (web) |
| `POST` | `/api/attendance/check-out` | JWT | Manual check-out |
| `GET` | `/api/attendance/*` | JWT | Riwayat absensi |
| `POST/GET/PATCH` | `/api/leaves/*` | JWT | Leave CRUD |
| `GET/POST/PATCH/DELETE` | `/api/cameras/*` | JWT + admin | Camera CRUD |
| `GET` | `/api/cameras/{id}/preview.jpg` | JWT | Latest cached frame as `image/jpeg` (skip throttler) |
| `POST` | `/api/cameras/{id}/start` | JWT + admin | Idempotent. Delegate ke AI. |
| `POST` | `/api/cameras/{id}/stop` | JWT + admin | Idempotent. |
| `POST` | `/api/cameras/{id}/restart` | JWT + admin | Idempotent. |
| `POST` | `/api/cameras/faces/{userId}` | JWT + admin | Register embedding |
| `GET` | `/api/cameras/usb/devices` | JWT + admin | List USB |
| `POST` | `/api/cameras/discover` | JWT + admin | ONVIF discover |
| WS | `/realtime` | JWT | `attendance.created`, `camera.status` |
| WS | `/security` | JWT | `security.alert` |
| WS | `/preview` | JWT | `camera.frame` (1 FPS, throttled to 3 FPS broadcast) |

### 6.1.1 Auth Login with Identifier

```http
POST /api/auth/login
{ "identifier": "admin" | "admin@absenface.local", "password": "..." }
```

Backend auto-detects: if `identifier` contains `@` → query by `email`, else → query by `username`. Users can have either or both.

### 6.1.2 Live Preview HTTP Endpoint

```http
GET /api/cameras/{id}/preview.jpg
→ 200 image/jpeg (latest cached frame, 640x480, JPEG q=70)
→ 404 JSON { "code": "NO_FRAME", "message": "..." } if cache empty
```

**Exempt from rate limiting** (`@SkipThrottle()`) — designed for high-frequency polling (1-2 FPS).
Returns `X-Captured-At` header with frame timestamp, `Cache-Control: no-store`.

### 6.2 NestJS → Python AI (Internal REST, X-Internal-Token)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/internal/ai/cameras/{id}/start` | `{rtsp_url?, source, onvif_host?, onvif_port?, onvif_username?, onvif_password?, onvif_profile_index?}` | `{status: "started"\|"already_running", rtsp_url?}` |
| `POST` | `/internal/ai/cameras/{id}/stop` | — | `{status: "stopped"\|"already_stopped"}` |
| `POST` | `/internal/ai/cameras/{id}/restart` | — | `{status: "restarting"}` |
| `POST` | `/internal/ai/cameras/{id}/reload` | new config | `{status: "reloading"}` |
| `POST` | `/internal/ai/cameras/{id}/reconnect` | — | `{status: "reconnecting"}` |
| `GET` | `/internal/ai/embeddings` | — | `[{user_id, embedding}]` |
| `POST` | `/internal/ai/register-face/{userId}` | `{photo_base64}` | `{user_id, embedding}` |
| `POST` | `/internal/ai/sync-embeddings` | `{embeddings: [{user_id, embedding}]}` | `204` |
| `POST` | `/internal/ai/discover` | — | `[{host, port, rtsp_url, manufacturer}]` |
| `GET` | `/internal/ai/usb-devices` | — | `[{name, path, type}]` |

**ONVIF resolution**: When `source=onvif`, AI service uses `onvif-zeep-async` to:
1. Connect to `onvif_host:onvif_port` with credentials
2. Call `GetProfiles()` to list available streams
3. Pick profile by `onvif_profile_index` (0=main, 1=sub typically)
4. Call `GetStreamUri()` to obtain RTSP URI
5. Spawn ffmpeg subprocess on resolved URL

### 6.3 Python AI → NestJS (Callback, X-Internal-Token)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/internal/ai/recognition` | `{trace_id, camera_id, captured_at, detections: [{external_user_id, confidence, bounding_box}]}` | `{trace_id, results: [{external_user_id, action, reason?, attendance_id?}]}` |
| `POST` | `/internal/ai/frame` | Raw JPEG bytes (binary) **or** `{camera_id, frame_base64}` | `204` |
| `POST` | `/internal/ai/state-change` | `{camera_id, state, error?}` | `204` |

**Frame format**: Preferred binary JPEG via `Content-Type: image/jpeg` with `X-Camera-Id` and `X-Captured-At` headers. NestJS uses `express.raw()` body parser for this route — JSON parser is disabled.

---

## 7. CAMERA STATE MACHINE

```
        start              detection_error
STOPPED ──────► CONNECTING ──────► ERROR
   ▲               │                  │
   │               ▼                  │ reconnect
   │            RUNNING ◄─────────────┤
   │               │                  │
   │          stop │                  │
   │               ▼                  │
   │           STOPPING                │
   │               │                  │
   │               ▼                  │
   └────────── STOPPED ◄──────────────┘
                          reconnect    │
                          (success)    │
                          ┌────────────┘
                          ▼
                     RECONNECTING
                          │
                          │ success
                          ▼
                       RUNNING
```

States: `STOPPED`, `CONNECTING`, `RUNNING`, `STOPPING`, `RECONNECTING`, `ERROR`

**Tambahan `STOPPING`**: ketika FFmpeg sedang di-kill, status bukan langsung `STOPPED` — kasih transisi `STOPPING` agar frontend tidak flicker ke `STOPPED` prematur.

Setiap transisi → `POST /internal/ai/state-change` → NestJS update DB `cameras.last_frame_at` + broadcast WS `/realtime` `camera.status`.

---

## 8. ENV VARIABLES

### 8.1 Root `.env`

```env
POSTGRES_DB=absen
POSTGRES_USER=absen_user
POSTGRES_PASSWORD=absen_password
POSTGRES_PORT=5432
INTERNAL_TOKEN=<random-secret-min-32-chars>          # MUST match backend & ai-service

# Seed default admin (created on first boot, see §11.6)
SEED_ADMIN_EMAIL=admin@absenface.local
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=Admin@1234
SEED_ADMIN_FULL_NAME=System Administrator

# Frontend (build-time — passed as build args to Dockerfile)
NEXT_PUBLIC_API_BASE=http://localhost/api
NEXT_PUBLIC_BACKEND_URL=http://localhost
```

### 8.2 `backend/.env`

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

# Seed admin (loaded via ConfigModule.forFeature in users module)
SEED_ADMIN_EMAIL=admin@absenface.local
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=Admin@1234
SEED_ADMIN_FULL_NAME=System Administrator
```

### 8.3 `ai-service/.env`

```env
PORT=8000
BACKEND_URL=http://backend:4000
INTERNAL_TOKEN=<same-as-backend>
RECOGNITION_CONFIDENCE_THRESHOLD=0.6
PREVIEW_FPS=1
RECONNECT_MAX_ATTEMPTS=5
RECONNECT_BACKOFF_MS=1000
```

### 8.4 `frontend/.env` (also passed as Docker build args)

```env
NEXT_PUBLIC_API_BASE=http://localhost/api
NEXT_PUBLIC_BACKEND_URL=http://localhost
```

**Important**: `NEXT_PUBLIC_*` env vars are inlined at **build time** by Next.js, not runtime. Docker build must pass these as `build.args`:

```yaml
frontend:
  build:
    context: ./frontend
    args:
      NEXT_PUBLIC_API_BASE: ${NEXT_PUBLIC_API_BASE}
      NEXT_PUBLIC_BACKEND_URL: ${NEXT_PUBLIC_BACKEND_URL}
```

---

## 9. IDEMPOTENT CAMERA CONTROL

Semua camera control endpoint idempotent — aman untuk retry/click berulang dan concurrent request:

| Endpoint | State saat ini | Response | Side-effect |
|---|---|---|---|
| `POST /api/cameras/{id}/start` | `STOPPED` | `{status: "started"}` | spawn pipeline |
| | `CONNECTING` | `{status: "starting"}` | noop |
| | `RUNNING` | `{status: "already_running"}` | noop |
| | `RECONNECTING` | `{status: "reconnecting"}` | noop |
| | `ERROR` | `{status: "starting", note: "will_retry"}` | trigger reconnect |
| `POST /api/cameras/{id}/stop` | `RUNNING` | `{status: "stopped"}` | graceful kill |
| | `CONNECTING`/`STOPPING`/`RECONNECTING` | `{status: "stopping"}` | mark STOPPING |
| | `STOPPED` | `{status: "already_stopped"}` | noop |
| | `ERROR` | `{status: "stopped"}` | cleanup |
| `POST /api/cameras/{id}/restart` | any | `{status: "restarting"}` | always stop+start |
| `POST /api/cameras/{id}/reload` | any | `{status: "reloading"}` | stop+reload+start |
| `POST /api/cameras/{id}/reconnect` | any | `{status: "reconnecting"}` | force reconnect |

**Race condition protection**: pakai `request_id` di body request. Dua klik bersamaan → second request detect `request_id` sama atau state transition in-progress, return 200 idempotent tanpa double-spawn.

---

## 10. IMPLEMENTATION ORDER

> **44 step** terstruktur dalam **5 phase**. Detail lengkap ada di `document/planning/00-implementation-checklist.md` (internal, gitignored).
> Tiap step punya verifikasi (test command atau file path) dan dependencies ke step lain.

### Phase 1 — Setup & Database (Day 1-2)

| # | Step | Verifikasi |
|---|---|---|
| 1 | Repo init, folder structure, .env.example, .gitignore | `tree -L 2 -a -I '.git'` |
| 2 | 8 SQL migrations di `backend/src/database/migrations/` | `psql ... -f each file` no errors |
| 3 | docker-compose.yml (5 services, absen-network, only nginx :80) | `docker compose config` valid |
| 4 | Generate INTERNAL_TOKEN + JWT RSA 2048 keys | `openssl rand -hex 32` + `rsa.generate_private_key` |
| 5 | PostgreSQL up, 9 tables + 8 enums | `psql -c "\dt"`, `psql -c "\dT"` |

### Phase 2 — Backend + AI service (Day 3-14)

#### 2A — Backend skeleton (Day 3-5)

| # | Step | Verifikasi |
|---|---|---|
| 6 | NestJS init, package.json, tsconfig, Dockerfile, .dockerignore | `npm run build` succeeds |
| 7 | 5 config modules (database, jwt, app, ai, seed) | Config loads without errors |
| 8 | main.ts bootstrap: rawBody true, bodyParser false, helmet, cookie, CORS, ValidationPipe | Backend container starts |
| 9 | 7 TypeORM entities + enums | Entities sync to DB |
| 10 | 3 guards (jwt, roles, internal-token) + 3 decorators + 1 filter + 1 interceptor + 1 pipe | All apply via `@UseGuards` etc |

#### 2B — Auth & users (Day 6-7)

| # | Step | Verifikasi |
|---|---|---|
| 11 | Auth module: register, login (identifier), refresh, logout, me | `curl /api/auth/login` sets cookies + returns user |
| 12 | Users module: CRUD (admin), soft delete, seeder (idempotent) | Login as admin, create user, soft delete |

#### 2C — AI service skeleton (Day 8-10)

| # | Step | Verifikasi |
|---|---|---|
| 13 | pyproject.toml, Dockerfile, main.py, config.py, state.py | `docker compose up -d ai`, `curl /health` 200 |
| 14 | BackendClient async (httpx) + sync (requests) | Both clients work |
| 15 | StreamManager: ffmpeg worker thread, raw BGR24, scale 640:480, state transition | ffmpeg spawned, first frame → RUNNING |
| 16 | ONVIF client: resolve_rtsp_uri via onvif-zeep-async | Test 192.168.1.9:10000, returns `rtsp://.../V_ENC_000` |
| 17 | FaceDetector (buffalo_l) + EmbeddingStore (cosine sim) + boot_sync | Register 1 face, matches at threshold 0.6 |
| 18 | RecognitionPipeline + PreviewGenerator (1 FPS JPEG q=70) | Frames arrive at backend, callback fires |

#### 2D — AI routes (Day 11)

| # | Step | Verifikasi |
|---|---|---|
| 19 | `/health`, `/internal/ai/cameras/*`, `/internal/ai/faces/*`, `/internal/ai/discover` + X-Internal-Token middleware | From backend, POST start camera works |

#### 2E — Backend camera + attendance + leave (Day 12-13)

| # | Step | Verifikasi |
|---|---|---|
| 20 | AIClientService: HTTP to AI with X-Internal-Token | Direct curl from NestJS debug |
| 21 | CameraFsmService: state Map, atomic transitions, 6 states | Mock transitions work |
| 22 | PreviewService: 10s TTL cache, WS broadcast 3 FPS, forwardRef gateway | Frame arriving, cache populated, WS event |
| 23 | Camera module: 13 endpoints, idempotent state table, GET :id/preview.jpg @SkipThrottle | Full lifecycle start → preview → stop |
| 24 | Internal callback: /embeddings, /recognition, /frame (binary), /state-change + AiRecognitionService | Mock recognition from curl → attendance row + WS event |
| 25 | Attendance module: 5 endpoints, business rules (late/half_day), unique(user_id, date), gateway | Manual + AI check-in works |
| 26 | Leave module: 4 endpoints, admin approve/reject | Request + approve flow works |
| 27 | AuditLogInterceptor: global, POST/PATCH/DELETE, JSONB details | Any mutation creates row |
| 28 | ThrottlerModule: 100/60s, @SkipThrottle on preview/refresh/health | 101st req returns 429 |

#### 2F — WebSocket gateways (Day 14)

| # | Step | Verifikasi |
|---|---|---|
| 29 | AttendanceGateway `/realtime` namespace, JWT cookie auth, broadcastCameraStatus + broadcastAttendance | wscat connect, receive events |
| 30 | PreviewGateway `/preview` namespace, watch/unwatch rooms, broadcastFrame + broadcastFrameError | Subscribe 1 camera, receive frames |

### Phase 3 — Frontend (Day 15-20)

| # | Step | Verifikasi |
|---|---|---|
| 31 | Next.js 16 init, deps (zustand, socket.io-client, axios, lucide), next.config.ts standalone, Dockerfile, shadcn init | `npm run build` succeeds, `.next/standalone` exists |
| 32 | shadcn/ui init (base-nova) + add 60 components (sidebar, card, button, dialog, table, dll) | `npx shadcn add button` works |
| 33 | `lib/api.ts` (axios + 401 refresh), `lib/socket.ts` (singleton), `lib/utils.ts` (cn), 3 stores, 3 hooks, types, proxy.ts (Next.js 16) | Types compile, no TS errors |
| 34 | Root layout (ThemeProvider + Toaster), page.tsx (redirect), login page (split-panel) | `/login` renders, login → `/dashboard` |
| 35 | `(dashboard)/layout.tsx` (SidebarProvider + AppSidebar), `app-sidebar.tsx` (nav + admin section) | Layout renders, protected routes redirect |
| 36 | Dashboard + Attendance + Leave pages | Navigate, data loads, mutations work |
| 37 | Admin pages: users, cameras (live preview), leaves, reports, register-face | Admin can do all CRUD |

### Phase 4 — nginx + Docker (Day 21)

| # | Step | Verifikasi |
|---|---|---|
| 38 | `nginx/default.conf`: /api → backend, /socket.io → WS upgrade, /_next + / → frontend, `proxy_read_timeout 86400s` | http://localhost loads |
| 39 | docker-compose.yml: `frontend.build.args` for `NEXT_PUBLIC_*` | Rebuild with new args, no hardcoded URLs |
| 40 | E2E test: clean clone → `docker compose up -d --build` → login → add camera → start → preview → register face → auto check-in | Full flow works |

### Phase 5 — Production hardening (Day 22-25)

| # | Step | Verifikasi |
|---|---|---|
| 41 | HTTPS via Cloudflare (Origin cert + nginx SSL config) | `https://absen.yourdomain.com` works |
| 42 | Backup automation: `scripts/backup.sh` + cron + retention + rclone | Backup file daily, restore works |
| 43 | Monitoring: `/health` + UptimeRobot + (optional) Sentry + Prometheus | Alerts configured |
| 44 | Security: rate limit on login, nginx `server_tokens off`, security headers, fail2ban, log filter | Security scan clean |

### Phase 6 — Security Module (Day 26-30)

> Server room access monitoring — separate module from attendance.
> Detail lengkap di `services/06-security.md`.

**Scope**:
- NEW `security_cameras` table (completely separate from `cameras`)
- NEW `security_alerts` table (references `security_cameras`)
- NEW `/api/security/*` endpoints
- NEW `/security` WebSocket namespace
- AI service: check camera against security_camera ID set (not mode column)
- Backend: separate module `src/modules/security/`
- Webhook: Telegram/Discord/Slack (dengan foto)
- Frontend: separate `/admin/security` pages + critical alert modal

#### 6.1 — Database (Day 26)

| # | Step | Verifikasi |
|---|---|---|
| 45 | Migration `009_security_module.sql` — create `security_cameras` table + `security_alerts` table + indexes | `psql -c "\d security_cameras"`, `psql -c "\d security_alerts"` |
| 46 | TypeORM entities: `SecurityCamera` + `SecurityAlert` (no changes to `Camera`) | `npm run build` succeeds |

#### 6.2 — Backend security module (Day 26-27)

| # | Step | Verifikasi |
|---|---|---|
| 47 | `src/modules/security/security.module.ts` — register entities + services + controller + gateway | Module loaded |
| 48 | `security-alert.service.ts` — processDetection (calculate severity, save alert) | Unit test: known → info, partial → warning, stranger → critical |
| 49 | `security-camera.service.ts` — CRUD for security_cameras | Create, list, delete |
| 50 | `security-alert.controller.ts` — GET list/stats/:id, PATCH :id/review | `curl /api/security/alerts` returns 200 |
| 51 | `security-camera.controller.ts` — POST/GET/DELETE for security cameras | `curl /api/security/cameras` returns 200 |
| 52 | `webhook.service.ts` — Telegram/Discord/Slack sender (httpx async + photo) | Send test alert → webhook received |
| 53 | Create `src/modules/security/gateways/security.gateway.ts` — `/security` namespace with `broadcastAlert()` | WS connect to `/security`, receive events |
| 54 | `ai-recognition.service.ts` — check if `camera_id` exists in `security_cameras` table; if yes → security pipeline, else → attendance | Known face on security camera → info alert (no check-in) |
| 55 | Update `internal.controller.ts` schema to accept new fields (`face_known`, `snapshot_base64`, `best_matched_*`) | Schema validation passes |
| 56 | Env vars in `.env` (WEBHOOK_TELEGRAM_*, etc.) | Config loads |

#### 6.3 — AI service dual pipeline (Day 28)

| # | Step | Verifikasi |
|---|---|---|
| 57 | `models/schemas.py` — add `face_known`, `snapshot_base64`, `best_matched_*` to Detection | Schema validates |
| 58 | `embedding_store.py` — add `find_match_with_score()` returning best score even if < threshold | Returns (None, None, score) for no match |
| 59 | `services/recognition_pipeline.py` — check if `camera_id` is in security camera set (loaded at boot) | Security camera → always sends all faces with snapshot; attendance camera → existing behavior |
| 60 | `crop_and_encode_face(frame, bbox)` helper — crop with 20% padding, resize max 200x200, JPEG q=80 | Returns base64 string |
| 61 | Boot sync update: backend sends security_camera IDs via `GET /internal/ai/boot-sync` | AI stores `security_camera_ids: Set[str]` |
| 62 | `state.py` — init `security_camera_ids` set, populated at boot | Set lookup O(1) |

#### 6.4 — Frontend (Day 29)

| # | Step | Verifikasi |
|---|---|---|
| 63 | `types/index.ts` — add SecurityAlert, SecurityCamera, AlertSeverity, WsSecurityAlertEvent | TS compiles |
| 64 | `security-socket.ts` — connect to `/security` namespace, listen `security.alert` event | WS connect works |
| 65 | `app/(dashboard)/admin/security/alerts/page.tsx` — alerts list + filters + review button | Page renders, filters work |
| 66 | `app/(dashboard)/admin/security/cameras/page.tsx` — security camera CRUD form | Create/delete security cameras |
| 67 | `app-sidebar.tsx` — add "Security" nav item with unreviewed badge | Badge shows count |
| 68 | `CriticalAlertModal` component — full-screen modal for severity=critical | Pops up on critical event |

#### 6.5 — Integration & polish (Day 30)

| # | Step | Verifikasi |
|---|---|---|
| 69 | Configure Telegram webhook via env vars + restart | Webhook received |
| 70 | E2E test: known face on security camera → info alert; unknown → critical + webhook + modal | Full flow works |
| 71 | Update `services/06-security.md` if implementation diverges | Doc reflects reality |

**Acceptance criteria**:
- Security cameras managed in `security_cameras` table (no `cameras.mode` column)
- Security camera reports all faces (known + unknown)
- Unknown face → critical alert + Telegram webhook + modal popup
- Known face → info log only (no alert spam)
- Admin can review alerts in `/admin/security/alerts`
- Snapshot JPEG saved for review
- Webhook works for Telegram (photo + caption)
- Dedicated `/security` WebSocket namespace

**Total**: ~30 working days (6 minggu) untuk 1 dev full-time.

 (6 minggu) untuk 1 dev full-time.

---

## 11. TESTING STRATEGY

### Per-step verification

Setiap step di §10 punya verifikasi spesifik (test command atau file path). Lihat kolom "Verifikasi" di table implementasi. Contoh:
- Step 5: `docker exec absen-postgres psql -U absen_user -d absen -c "\dt"` — shows 9 tables
- Step 11: `curl -X POST /api/auth/login -d '{"identifier":"admin","password":"Admin@1234"}'` — returns 200 + sets cookies
- Step 22: Watch WS logs, see `camera.frame` events at 3 FPS

### E2E flow (Step 40)

Full happy path yang harus jalan di akhir Phase 4:

```bash
# 1. Clean state
docker compose down -v
git clean -fdx

# 2. Build + start
docker compose up -d --build

# 3. Wait for health
sleep 30
docker compose ps  # all 5 services "healthy" or "running"

# 4. Login as admin
COOKIE=$(curl -s -c - -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin","password":"Admin@1234"}' \
  | grep access_token | awk '{print $7}')

# 5. Add ONVIF camera
CAM_ID=$(curl -s -b "access_token=$COOKIE" \
  -X POST http://localhost/api/cameras \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","source":"onvif","onvif_host":"192.168.1.9","onvif_port":10000,"onvif_username":"admin","onvif_password":"admin"}' \
  | jq -r '.data.id')

# 6. Start camera
curl -s -b "access_token=$COOKIE" -X POST http://localhost/api/cameras/$CAM_ID/start
# Wait 5s, then:
curl -s -b "access_token=$COOKIE" http://localhost/api/cameras/$CAM_ID/state
# Expected: state = "RUNNING"

# 7. Get preview frame
curl -s -b "access_token=$COOKIE" http://localhost/api/cameras/$CAM_ID/preview.jpg -o frame.jpg
file frame.jpg  # expected: JPEG image data, 640x480

# 8. Register face for a user
curl -s -b "access_token=$COOKIE" \
  -X POST http://localhost/api/cameras/faces/$USER_ID \
  -H "Content-Type: application/json" \
  -d "{\"photo\":\"$(base64 -w0 photo.jpg)\"}"

# 9. Wait for auto check-in
# Show face to camera, wait 3s
curl -s -b "access_token=$COOKIE" http://localhost/api/attendance/today
# Expected: checked_in = true, attendance.status = "present"

# 10. WebSocket realtime (wscat)
wscat -c 'ws://localhost/socket.io/?EIO=4&transport=websocket' \
  -H "Cookie: access_token=$COOKIE"
# Expected: connect, then "40" (realtime namespace), then receive "attendance.created" event
```

### Unit test scaffold (TODO Phase 2)

```typescript
// backend/src/modules/auth/auth.service.spec.ts
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';

describe('AuthService.login', () => {
  let service: AuthService;
  let mockUsersRepo: any;
  
  beforeEach(async () => {
    mockUsersRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
    };
    
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
        // ... other mocks
      ],
    }).compile();
    
    service = module.get(AuthService);
  });
  
  it('returns user when email + password match', async () => {
    const hash = await bcrypt.hash('correct', 12);
    mockUsersRepo.findOne.mockResolvedValue({
      id: 'uuid', email: 'a@b.com', passwordHash: hash, isActive: true,
    });
    
    const result = await service.login({ identifier: 'a@b.com', password: 'correct' });
    expect(result.user.email).toBe('a@b.com');
  });
  
  it('rejects wrong password', async () => {
    const hash = await bcrypt.hash('correct', 12);
    mockUsersRepo.findOne.mockResolvedValue({
      id: 'uuid', email: 'a@b.com', passwordHash: hash, isActive: true,
    });
    
    await expect(service.login({ identifier: 'a@b.com', password: 'wrong' }))
      .rejects.toThrow('Invalid credentials');
  });
});
```

### E2E test (Playwright, TODO Phase 4)

```ts
// e2e/login.spec.ts
import { test, expect } from '@playwright/test';

test('admin can login and see dashboard', async ({ page }) => {
  await page.goto('http://localhost/login');
  await page.fill('input[name="identifier"]', 'admin');
  await page.fill('input[name="password"]', 'Admin@1234');
  await page.click('button[type="submit"]');
  
  await expect(page).toHaveURL('http://localhost/dashboard');
  await expect(page.locator('h2')).toContainText('Welcome');
});
```

---

## 12. RISIKO & MITIGASI

Mapping risiko → step implementasi yang handle. Detail lengkap di `09-risks.md` (internal, gitignored).

| Risiko | Mitigasi | Step |
|---|---|---|
| InsightFace model download ~300MB di first run | Volume mount `/root/.insightface` | Step 3 (compose), 13 (Dockerfile) |
| InsightFace lambat di CPU (5-10 FPS) | Acceptable 1-2 FPS, GPU optional | Step 17 (det_size, FPS) |
| Frame broadcast 1 FPS menambah bandwidth | Compress JPEG q=70, ~30KB/frame | Step 18 (PreviewGenerator) |
| Internal token bocor di log | Filter logger, helmet headers | Step 8 (helmet), 20 (AI client) |
| Race condition: 2 detection bersamaan | DB UNIQUE(user_id, date) + UPSERT | Step 25 (attendances entity) |
| Camera config drift DB vs Python memory | Push-only via P8, AI reloads on each request | Step 24 (callback) |
| Reconnect loop tanpa henti | Exponential backoff + max attempts | Step 15 (StreamManager) |
| Camera offline mid-recognition | WS `camera.frame_error`, manual check-in fallback | Step 22 (PreviewService), 25 (manual endpoints) |
| ONVIF WS-Discovery tidak work di container | Best-effort, manual fallback via POST /cameras | Step 16 (ONVIF client) |
| False positive face match | Threshold 0.6 + per-user cooldown | Step 17 (cosine sim) |
| Stale preview frame (camera silent death) | 10s TTL + WS `camera.frame_error: no_frame` | Step 22 |
| Database corruption | ACID + daily backup automation | Step 42 (backup) |
| NUC hardware failure | Offsite backup → restore on new hardware | Step 42 (rclone) |
| WebSocket disconnect for many clients | Socket.IO auto-reconnect + HTTP fallback | Step 29-30 (gateway) |
| Biometric data privacy (GDPR) | Embedding-only (no photo), audit log, right to delete | Step 11 (auth), 27 (audit) |
| USB camera device passthrough | Document `devices:` in compose (Linux only) | Step 3 (compose docs) |
| Memory leak AI service over long uptime | Bounded resources, weekly restart TODO | (deferred to Phase 4) |
| Unauthorized access to restricted room (server room) | Phase 6 security module: separate `security_cameras` table + alerts on unknown face | Step 45-71 |

---

## 13. SKETCHED (NANTI)

- [x] ~~Nginx reverse proxy~~ ✅ implemented (port 80 only, hides backend/frontend)
- [ ] Cloudflare Tunnel
- [ ] Cloudflare DNS
- [ ] Redis untuk cache & rate limit
- [ ] Multi-camera scale test
- [ ] InsightFace model training custom (jika ada data internal)
- [ ] HTTPS certificate (Let's Encrypt via Cloudflare Origin)
- [ ] Production deployment script (Ansible/Terraform)
- [ ] Switch live preview from HTTP polling → WebSocket subscription
- [ ] Auto-recovery: detect stale frame (state=RUNNING but no frame for >X seconds) → trigger restart
- [ ] Pipeline health monitor: if ffmpeg dies silently, force state → ERROR

---

## 14. CHANGELOG

| Date | Perubahan |
|---|---|
| 2026-07-22 (v1) | Initial spec: 3 service (NestJS + Python + Nuxt 4) |
| 2026-07-22 (v2) | Frontend migrated to Next.js 15 |
| 2026-07-22 (v3) | Refactor: strict separation of concerns. Python AI dipisah. NestJS jadi single source of truth untuk DB & WS. Idempotent camera control. Event-driven config sync. |
| 2026-07-23 (v4) | Frontend → Next.js 16 + shadcn/ui (60 components, base-nova style). Auth login accepts identifier (email or username). Username column added to users. Default admin auto-seeded on first boot. Nginx reverse proxy on port 80, backend/frontend hidden from host. Live preview HTTP endpoint (`/api/cameras/:id/preview.jpg`, `@SkipThrottle()`). ONVIF source support in AI service (resolves RTSP URI via `onvif-zeep-async`). AI service ffmpeg pipeline fixed-size (640x480) + sync requests for state/frame callbacks. Binary frame support via `express.raw()` body parser. Documented in spec.md, deployment.md, api-contract.md, architecture.md. |
| 2026-07-23 (v4.1) | **§10 IMPLEMENTATION ORDER** diperluas dari 19 step → **44 step** terstruktur dalam 5 phase (Setup, Database, Backend+AI, Frontend, nginx, Production). Tiap step punya verifikasi spesifik (test command). **§11 TESTING STRATEGY** diperluas: per-step verification table + E2E flow script (10 bash commands dari clean clone sampai auto check-in) + unit test scaffold (Jest) + Playwright E2E. **§12 RISIKO** diperluas dari 7 → 17 risiko dengan mapping ke step implementasi. `document/` folder baru (gitignored) berisi: 00-overview, 01-architecture, 02-tech-stack, 03-principles, services/, api/, deployment/, planning/00-implementation-checklist.md, roadmap.md, risks.md. |
| (future date) (v4.3) | **Security Module Refactor**: removed `cameras.mode`. New `security_cameras` table (separate from `cameras`). Dedicated `/api/security/*` endpoints + `SecurityGateway` `/security` namespace. AI pipeline uses security camera ID set instead of mode enum. Full rewrite of `services/06-security.md`.
