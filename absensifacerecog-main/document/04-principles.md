# 03 — Architecture Principles

> 8 prinsip yang **LOCKED**. Tidak boleh dilanggar. Violation = bug atau security issue.

---

## P1. Single Source of Truth — Database

**Aturan**: Hanya **NestJS backend** yang akses PostgreSQL. AI service **DILARANG** import `psycopg`/`asyncpg`/SQLAlchemy/TypeORM/anything DB.

**Reasoning**:
- Data integrity: satu tempat yang handle transactions, locks, audit
- AI service bisa di-restart tanpa kehilangan data
- AI service bisa di-replace (Go, Rust, cloud AI) tanpa migrasi data

**Violations**:
```python
# ❌ JANGAN
import psycopg2
import asyncpg
from sqlalchemy import create_engine

# ✅ BOLEH
import httpx  # call backend API
```

**Cara kerja**:
- AI baca embeddings: `GET /internal/ai/embeddings` (backend query DB, return JSON)
- AI sync embedding baru: `PUT /internal/ai/embeddings/{userId}` (backend update DB)
- AI tidak pernah `SELECT * FROM users`

---

## P2. Single Source of Truth — Realtime

**Aturan**: Hanya **NestJS backend** yang kirim event ke browser via WebSocket. AI service **DILARANG** punya koneksi WebSocket ke browser.

**Reasoning**:
- Backend validate business rules sebelum broadcast (e.g. jangan broadcast `attendance.created` kalau user on_leave)
- Single connection point = easier auth, rate limit
- AI restart tidak disrupt browser connection

**Violations**:
```python
# ❌ JANGAN
import socketio
sio = socketio.Client()
sio.connect('http://browser', namespaces=['/events'])

# ✅ BOLEH
import requests
requests.post('http://backend:4000/internal/ai/state-change', ...)
# Backend akan broadcast ke WS subscribers
```

---

## P3. Single Source of Truth — Business Rule

**Aturan**: Hanya **NestJS backend** yang tahu aturan absensi (jam kerja, cuti, double check-in, threshold confidence, max attempts). AI service hanya hasil **inferens murni** (face match score).

**Reasoning**:
- Business rule bisa berubah tanpa rebuild AI
- Multiple AI services bisa pakai rule yang sama
- Testing lebih mudah (mock AI, test backend rule)

**Contoh**:
- ❌ AI: "user sudah check-in, skip" (AI memutuskan)
- ✅ AI: "ini wajah user X, confidence 0.94" (AI cuma detection)
- ✅ Backend: "user X sudah check-in hari ini, action=ignored, reason=already_checked_in" (Backend decide)

**Threshold config** (`ai-service/.env`):
```env
RECOGNITION_CONFIDENCE_THRESHOLD=0.6  # minimum confidence untuk face match
```

Ini di-read AI untuk filter low-confidence (avoid false positives), tapi threshold "is this user allowed to check-in?" di backend.

---

## P4. Single Responsibility per Service

**Aturan**: Setiap service punya 1 job utama, tidak overlap.

| Service | Job | BUKAN job-nya |
|---|---|---|
| **Frontend** | Presentasi data, UI state | Business logic, AI inference, DB access |
| **Backend** | Business logic, persistence, WS gateway | Camera processing, face recognition |
| **AI** | Camera streaming, face detection/recognition | DB access, user management, business rule |
| **nginx** | Reverse proxy, TLS | Application logic |

**Violations**:
```typescript
// ❌ Frontend tidak boleh ada business rule
if (user.lastCheckIn < 1_hour_ago) { ... }

// ❌ Backend tidak boleh spawn ffmpeg
spawn('ffmpeg', ['-i', rtsp_url, ...])

// ❌ AI tidak boleh query users table
db.query("SELECT * FROM users WHERE id = ?")
```

---

## P5. Loose Coupling (Replaceable AI)

**Aturan**: AI service contract dengan backend stabil. AI service bisa diganti (InsightFace → cloud AI, Python → Go/Rust) tanpa ubah business logic backend.

**Contract surface** (yang harus stabil):
- `POST /internal/ai/cameras/{id}/start` + body schema
- `POST /internal/ai/cameras/{id}/stop`
- `POST /internal/ai/recognition` + body schema (callback)
- `POST /internal/ai/frame` + body schema (callback)
- `POST /internal/ai/state-change` + body schema (callback)
- `GET /internal/ai/embeddings`

**Kalau ganti**:
- InsightFace (Python) → AWS Rekognition (REST calls) → backend contract sama
- Local model → cloud API → backend contract sama
- Python → Go → backend contract sama

**Test**: Mock AI service dengan HTTP server sederhana yang implement contract. Backend tidak boleh peduli.

---

## P6. Internal Service Auth (X-Internal-Token)

**Aturan**: Komunikasi backend ↔ AI pakai shared secret header `X-Internal-Token`. **BUKAN** JWT user.

**Reasoning**:
- Service-to-service trust: bukan user, jadi JWT overkill
- Simple: 1 header, 1 env var
- Easy to rotate: ganti `INTERNAL_TOKEN` di kedua `.env`, restart
- Tidak expose ke browser: token ini **HANYA** antara backend & AI

**Setup**:
- Root `.env`: `INTERNAL_TOKEN=<random-32+chars>`
- `backend/.env`: `INTERNAL_TOKEN=<same>`
- `ai-service/.env`: `INTERNAL_TOKEN=<same>`

**Header behavior**:
- Backend → AI: `X-Internal-Token: <secret>` di setiap request
- AI → Backend: `X-Internal-Token: <secret>` di setiap callback
- AI expose `/health` tanpa auth (untuk Docker healthcheck)
- AI expose `/internal/ai/*` dengan `X-Internal-Token` (via `InternalTokenGuard`)

**Middleware**:
```typescript
// backend/src/common/guards/internal-token.guard.ts
@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const token = req.headers['x-internal-token'];
    if (token !== this.config.get('ai.internalToken')) {
      throw new UnauthorizedException('Invalid internal token');
    }
    return true;
  }
}
```

---

## P7. Idempotent Camera Control

**Aturan**: Start/Stop/Restart/Reload/Reconnect camera return 200 dengan status string. **BUKAN** 409 Conflict. Aman untuk retry/click berulang.

**Reasoning**:
- Admin double-click "Start" → tidak boleh error
- Scheduler retry setiap 30s → tidak boleh error kalau state sudah OK
- WebSocket reconnect → tidak boleh spawn multiple ffmpeg

**State table**:

| Endpoint | State | Response | Action |
|---|---|---|---|
| `POST /start` | STOPPED | `{status: "started"}` | spawn pipeline |
| | CONNECTING | `{status: "starting"}` | noop |
| | RUNNING | `{status: "already_running"}` | noop |
| | RECONNECTING | `{status: "reconnecting"}` | noop |
| | ERROR | `{status: "starting", note: "will_retry"}` | trigger reconnect |
| `POST /stop` | RUNNING | `{status: "stopped"}` | graceful kill |
| | CONNECTING/STOPPING/RECONNECTING | `{status: "stopping"}` | mark STOPPING |
| | STOPPED | `{status: "already_stopped"}` | noop |
| | ERROR | `{status: "stopped"}` | cleanup |
| `POST /restart` | any | `{status: "restarting"}` | always stop+start |
| `POST /reload` | any | `{status: "reloading"}` | stop+reload+start |

**Race condition protection**:
- State transition di backend FSM **atomic** (Map dengan lock)
- State transition di AI `app_state` **atomic** (Lock-protected)
- Double-start dalam 100ms → second detect `entry.state != STOPPED`, return `already_running`

---

## P8. Event-Driven Config Sync

**Aturan**: Perubahan camera config di NestJS DB → push HTTP ke AI service. AI service **TIDAK** polling DB.

**Reasoning**:
- AI service tidak punya akses DB (P1)
- Realtime sync (admin update → AI apply dalam < 1 detik)
- Bandwidth hemat (no periodic polling)

**Flow**:
```
Admin PATCH /api/cameras/{id} {rtsp_url: "new"}
   ↓
Backend update DB
   ↓
Backend POST /internal/ai/cameras/{id}/reload {rtsp_url: "new"}
   ↓
AI stop existing ffmpeg
   ↓
AI spawn new ffmpeg dengan config baru
   ↓
AI POST /internal/ai/state-change (RUNNING)
   ↓
Backend broadcast camera.status
```

**Yang TIDAK boleh**:
- AI service tidak boleh punya API endpoint "list cameras" yang dipanggil periodik
- Backend tidak boleh set interval untuk sync ke AI (push only)

---

## Prioritas ketika prinsip conflict

Jika 2 prinsip conflict (rare), urutan prioritas:
1. **P1 (DB)** + **P2 (Realtime)** = paling penting. Jangan pernah dilanggar.
2. **P6 (Internal auth)** = security boundary. Jangan pernah dilanggar.
3. **P3 (Business rule)** = business integrity.
4. **P4 (Single responsibility)** = maintainability.
5. **P5 (Loose coupling)** = future flexibility.
6. **P7 (Idempotent)** = UX.
7. **P8 (Event-driven)** = performance.

Contoh conflict:
- "AI mau return business rule info biar backend gak perlu logic" → **P3 menang**. AI tetap return raw score, backend yang decide.
- "Backend mau cache state di Redis biar cepat" → **P1 tetap** (cache bukan source of truth). DB tetap authoritative.

---

## Checklist sebelum merge

Setiap PR harus verify:
- [ ] Tidak ada import DB di AI service (P1)
- [ ] Tidak ada WebSocket client ke browser di AI service (P2)
- [ ] Tidak ada business rule logic di AI service (P3)
- [ ] Tidak ada camera control di backend (P4)
- [ ] Tidak ada face recognition model di backend (P4)
- [ ] Setiap internal endpoint punya `InternalTokenGuard` (P6)
- [ ] Camera control endpoints idempotent (P7)
- [ ] Camera config change trigger push ke AI, bukan poll (P8)

---

## Next step

→ Baca [`services/`](services/) untuk design per service.
