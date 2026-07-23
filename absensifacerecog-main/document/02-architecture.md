# ARSITEKTUR — Sistem Absensi v4

> High-level design. Detail API/contract di `06-api-contract.md`, deployment di `07-deployment.md`, spec di `05-spec.md`.

---

## Ringkasan 1-Gambar

```
                            IP Camera (RTSP/ONVIF/USB)
                                    │
                                    │ 1 koneksi RTSP (resolved by AI service)
                                    ▼
                          ┌─────────────────────┐
                          │   Python AI         │
                          │   (FastAPI:8000)    │   ← internal only
                          │                     │     (not exposed to host)
                          │ - FFmpeg            │
                          │ - OpenCV            │
                          │ - InsightFace       │
                          │ - ONVIF (zeep-async)│
                          │ - Camera FSM        │
                          │ - Preview 1 FPS     │
                          └──────────┬──────────┘
                                     │ X-Internal-Token
                       ┌─────────────┼─────────────┐
                       ▼             ▼             ▼
                recognition      frame       state-change
                (POST)           (POST)       (POST)
                       │             │             │
                       └─────────────┼─────────────┘
                                     ▼
                          ┌─────────────────────┐
                          │   NestJS (4000)     │   ← internal only
                          │                     │     (not exposed to host)
                          │ - SATU-SATUNYA      │
                          │   akses PostgreSQL  │
                          │ - Business rule     │
                          │ - WebSocket gateway │
                          │   ke FE (/realtime, │
                          │   /preview,         │
                          │   /security)         │
                          │ - Preview cache     │
                          │   (10s TTL)         │
                          └──────────┬──────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  │ HTTP              │ WS               │
                  │ /api/*            │ /socket.io/      │
                  │ /api/cameras/:id/ │  → /realtime     │
                  │   preview.jpg     │  → /preview      │
                  │ /api/security/*   │  → /security     │
                  └──────────────────┼──────────────────┘
                                     ▼
                          ┌─────────────────────┐
                          │   nginx (:80)       │   ← ONLY public entry
                          │   reverse proxy     │
                          │   - /api → backend  │
                          │   - /socket.io → WS │
                          │   - / → frontend    │
                          └──────────┬──────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │   Browser           │
                          │   Next.js 16:3000   │   ← internal only
                          │   (shadcn/ui)       │
                          └─────────────────────┘
```

**Trust boundaries**:
- Browser ↔ nginx: HTTPS in production (via Cloudflare), HTTP locally
- nginx ↔ backend: private network `absen-network`, JWT cookies forwarded
- backend ↔ AI: `absen-network` only, `X-Internal-Token` required
- AI → IP camera: depends on source — RTSP/ONVIF to network, USB to host devices

**Only port 80** is published to host. Backend (4000), frontend (3000), and AI (8000) are all internal — reached only through nginx reverse proxy.

---


## 3 Pilar Tanggung Jawab

### Next.js 16 (Frontend)
- UI, presentasi data, client-side state (Zustand)
- HTTP ke NestJS untuk semua action (axios with auto-refresh on 401)
- WebSocket ke NestJS untuk realtime events + live preview
- Live preview via HTTP polling `GET /api/cameras/:id/preview.jpg` (1 FPS) **or** WebSocket `/preview` subscription
- shadcn/ui components (60 components, base-nova style)
- **TIDAK**: akses DB, business logic, camera control langsung, AI inference

### NestJS (Backend)
- **Satu-satunya** yang akses PostgreSQL
- **Satu-satunya** yang kirim event ke frontend via WebSocket
- Auth, validasi, business rule
- HTTP client ke Python untuk delegate AI task
- **TIDAK**: AI inference, FFmpeg, ONVIF, USB, face recognition

### Python AI (Inference)
- ONVIF discovery, RTSP pull, USB device detect
- FFmpeg subprocess per camera
- OpenCV preprocessing
- InsightFace + ArcFace untuk face detection & recognition
- Cosine similarity matching
- 1 FPS preview JPEG extraction
- Camera state machine
- HTTP POST ke NestJS untuk:
  - Hasil recognition
  - Frame preview
  - State transition
- **TIDAK**: PostgreSQL, WebSocket ke frontend, business rule, user table, attendance table

---


---

## Data flow (timeline)

## Data flow

### Flow 1: Karyawan absen via face recognition

```
Time    Component       Action
─────   ─────────       ──────
T+0ms   IP Camera       Frame ready (RTSP)
T+10ms  ai service      ffmpeg pipe → frame BGR24
T+15ms  ai service      InsightFace detect face
T+25ms  ai service      ArcFace extract embedding (512-dim)
T+30ms  ai service      Cosine similarity vs embedding_store
T+35ms  ai service      Match found! confidence=0.94, user_id=X
T+40ms  ai service      POST /internal/ai/recognition {camera_id, detections: [{user_id: X, confidence: 0.94}]}
T+50ms  backend         Verify X-Internal-Token
T+55ms  backend         AiRecognitionService.processDetection()
T+60ms  backend         - Lookup user X (active? on leave?)
T+65ms  backend         - Check today attendance (already checked-in?)
T+70ms  backend         - Validate business rules
T+75ms  backend         - INSERT attendances row
T+80ms  backend         - WS broadcast /realtime attendance.created
T+85ms  backend         - WS broadcast /realtime camera.status
T+85ms  ai service      Receive {results: [{action: "check_in"}]}
T+90ms  browser (admin) WS /realtime → state update → toast
T+90ms  browser (user)  WS /realtime → state update → toast "Selamat pagi, X"

Total: ~90ms from detection to UI update
```

### Flow 2: Admin tambah kamera ONVIF

```
Time    Component       Action
─────   ─────────       ──────
T+0     browser         Admin isi form: name, source=onvif, host=192.168.1.9, port=10000, user, pass
T+10ms  browser         POST /api/cameras {config}
T+15ms  nginx           proxy → backend
T+20ms  backend         JwtAuthGuard verify cookie
T+25ms  backend         RolesGuard verify admin
T+30ms  backend         CameraController.create()
T+35ms  backend         CameraConfigService.create() → INSERT cameras
T+40ms  backend         AuditLogInterceptor log
T+45ms  backend         Return {success, data: camera}
T+50ms  browser         Toast "Camera created", refresh list

(Later, when admin clicks "Start")
T+0     browser         POST /api/cameras/{id}/start
T+5ms   backend         CameraService.startCamera()
T+10ms  backend         fsm.transition(CONNECTING)
T+15ms  backend         POST /internal/ai/cameras/{id}/start
                         Body: {source: "onvif", onvif_host, onvif_port, ...}
T+50ms  ai service      onvif_client.resolve_rtsp_uri()
T+200ms ai service      ONVIF GetProfiles → 2 profiles
T+250ms ai service      ONVIF GetStreamUri → "rtsp://192.168.1.9:554/V_ENC_000"
T+260ms ai service      StreamManager.start(camera_id, rtsp_url, "onvif")
T+265ms ai service      - app_state.transition(CONNECTING)
T+270ms ai service      - spawn ffmpeg subprocess
T+2700ms ai service     - first frame read
T+2710ms ai service     - app_state.transition(RUNNING)
T+2710ms ai service     - send_state_change_sync(RUNNING)
T+2715ms backend         handleStateChange(RUNNING) → fsm.transition(RUNNING)
T+2720ms backend         broadcastCameraStatus via /realtime
T+2725ms browser         WS /realtime → state badge update "RUNNING"

(T+0 from start click to RUNNING: ~2.7s)
```

### Flow 3: Live preview

```
Time    Component       Action
─────   ─────────       ──────
T+0     ai service      ffmpeg → frame BGR24
T+1ms   ai service      cv2.imencode(".jpg", quality=70) → bytes
T+2ms   ai service      send_frame_sync(camera_id, captured_at, jpeg_bytes)
T+10ms  backend         express.raw() body parser receives binary
T+11ms  backend         PreviewService.set(camera_id, buffer)
T+12ms  backend         - cache.set(camera_id, {frame, capturedAt, size})
T+13ms  backend         - 10s TTL timer set/reset
T+14ms  backend         - if 333ms since last broadcast → gateway.broadcastFrame()
T+15ms  backend         PreviewGateway → server.to('camera:{id}').emit('camera.frame', {...})
T+25ms  browser (WS)    socket.on('camera.frame', set <img src="data:...">)

(Or HTTP polling alternative)
T+0     browser         <img src="/api/cameras/{id}/preview.jpg?t={tick}">
T+10ms  nginx           proxy → backend
T+15ms  backend         @SkipThrottle() preview handler
T+20ms  backend         PreviewService.get(camera_id) → return cached frame
T+25ms  browser         <img> updates with new frame
```

---

---

## Network topology

## Network topology

```
Internet
   │
   │ (optional, future) Cloudflare Tunnel (outbound from NUC)
   ▼
NUC Ubuntu (192.168.1.100, in office LAN)
   │
   ├── eth0: 192.168.1.100 (LAN, talks to cameras + internet)
   │
   ├── docker bridge: 172.20.0.0/16 (absen-network)
   │    ├── nginx:       172.20.0.2
   │    ├── backend:     172.20.0.3
   │    ├── ai:          172.20.0.4
   │    └── db:          172.20.0.5
   │
   ├── published port: 80:80 (nginx only)
   │
   └── internal: cameras LAN (192.168.1.0/24)
        - 192.168.1.9 (CCTV 1, ONVIF port 10000, RTSP port 554)
        - 192.168.1.10 (CCTV 2, ...)
        - 192.168.1.20 (USB camera, /dev/video0 mounted to ai container)
```

**Note**: AI service needs to reach cameras on `192.168.1.0/24` (LAN). Since AI container has `network_mode: bridge` (default) on NUC, it shares host's network namespace OR can use `host` network mode to access LAN. **Decision pending — see `09-risks.md` and `deployment/`.**

---

---

## Alur 1: Admin Tambah Camera

```
Browser (Admin)
   │
   │ 1. POST /api/cameras/discover  (admin auth)
   ▼
NestJS CameraController
   │
   │ 2. Forward: POST /internal/ai/discover  (X-Internal-Token)
   ▼
Python AI
   │
   │ 3. ONVIF WS-Discovery scan network
   │ 4. Return list [{host, port, rtsp_url, ...}]
   ▼
NestJS
   │
   │ 5. Return ke browser
   ▼
Browser
   │
   │ 6. Admin pilih camera, POST /api/cameras {config}
   ▼
NestJS CameraController
   │
   │ 7. Save ke Postgres (cameras table)
   │ 8. Audit log
   │ 9. Return created camera
```

---

## Alur 2: Admin Start Camera + AI Pipeline

### 2a. RTSP source (direct URL)

```
Browser (Admin)
   │
   │ 1. POST /api/cameras/{id}/start
   ▼
NestJS CameraController
   │
   │ 2. Lookup camera in DB (cameras table)
   │ 3. Build payload: {rtsp_url, source: "rtsp"}
   │ 4. Forward: POST /internal/ai/cameras/{id}/start
   ▼
Python AI
   │
   │ 5. State: STOPPED → CONNECTING (in app_state)
   │ 6. POST /internal/ai/state-change {state: "CONNECTING"}
   │ 7. Spawn FFmpeg subprocess (rtsp_transport=tcp, vf scale=640:480)
   │ 8. Read raw BGR24 frames from ffmpeg stdout
   │ 9. State: CONNECTING → RUNNING
   │ 10. POST /internal/ai/state-change {state: "RUNNING"}
   │ 11. Start recognition_pipeline (face detect + match)
   │     + preview_generator (1 FPS JPEG → backend)
   ▼
NestJS
   │
   │ 12. Update DB cameras.last_frame_at
   │ 13. Broadcast WS /realtime camera.status
   │ 14. Return 200 {status: "started", rtsp_url: "..."} ke browser
```

### 2b. ONVIF source (RTSP resolved dynamically)

```
Browser (Admin)
   │
   │ 1. POST /api/cameras/{id}/start
   ▼
NestJS CameraController
   │
   │ 2. Lookup camera (cameras table → onvif_host, onvif_port, etc.)
   │ 3. Build payload: {source: "onvif", onvif_host, onvif_port, onvif_username, onvif_password, onvif_profile_index: 0}
   │ 4. Forward: POST /internal/ai/cameras/{id}/start
   ▼
Python AI (onvif_client.resolve_rtsp_uri)
   │
   │ 5. ONVIFCamera(host, port, user, pass)  ← onvif-zeep-async
   │ 6. cam.update_xaddrs() — fetch device service URLs
   │ 7. media = create_media_service()
   │ 8. profiles = media.GetProfiles() — list available streams
   │ 9. Pick profile[onvif_profile_index]  (0=main, 1=sub)
   │ 10. uri = media.GetStreamUri({Stream: RTP-Unicast, Protocol: RTSP, ProfileToken})
   │ 11. Return uri (e.g. "rtsp://192.168.1.9:554/V_ENC_000")
   │
   │ 12. Continue from step 7 of 2a — spawn ffmpeg on resolved URI
```

**Why AI service resolves ONVIF** (not backend):
- ONVIF uses WS-Discovery multicast (UDP 239.255.255.250) — works on container's own network
- AI service is the only one running ffmpeg, so it has the most context on stream capabilities
- Backend stays pure data layer — no network discovery code

Idempotent: kalau camera sudah running, step 5-7 detect existing pipeline, return 200 `{status: "already_running"}` tanpa spawn ulang.

---

## Alur 3: Live Preview

Two transport mechanisms are supported — frontend uses HTTP polling (simpler, easier to debug), WS broadcast is for future use.

### 3a. HTTP polling (current)

```
Browser (Admin)
   │
   │ 1. Open /admin/cameras page
   │ 2. For each camera, render <img src="/api/cameras/{id}/preview.jpg?t={tick}">
   │ 3. setInterval(1s) → setTick(n => n+1) → force reload
   ▼
nginx (port 80)
   │
   │ 4. Match /api/ → proxy_pass to backend
   ▼
NestJS
   │
   │ 5. @SkipThrottle() — exempt from rate limit
   │ 6. PreviewService.get(cameraId) — read from in-memory Map
   │ 7. Return 200 image/jpeg (latest cached frame, 640x480, JPEG q=70)
   │    OR 404 JSON {code: "NO_FRAME"} if cache empty
   ▼
Browser
   │
   │ 8. <img> updates with new frame
   │ 9. Add ?t={tick} query to force reload (bypass HTTP cache)
```

**Backend's preview cache** is populated by AI service:

```
Python AI (preview_generator, per frame from recognition_pipeline)
   │
   │ 1. cv2.imencode(".jpg", frame, [JPEG_QUALITY=70]) → jpeg_bytes
   │ 2. send_frame_sync(camera_id, captured_at, jpeg_bytes)
   ▼
NestJS InternalController (frame route)
   │
   │ 3. express.raw() middleware captures binary body → req.body is Buffer
   │ 4. PreviewService.set(cameraId, frame) — store in Map + set 10s TTL timer
   │ 5. If 333ms elapsed since last broadcast: gateway.broadcastFrame() to WS
   │ 6. Return 204 No Content
```

### 3b. WebSocket broadcast (alternative)

```
Browser (Admin)
   │
   │ 1. WS connect to /preview namespace (Socket.IO)
   │ 2. emit('watch', cameraId) — join room
   ▼
NestJS PreviewGateway
   │
   │ 3. client.join('camera:{id}')
   │
   │ ... AI service pushes frames via PreviewService (same path as 3a) ...
   │
   │ 4. PreviewService.set() also calls gateway.broadcastFrame() (3 FPS throttle)
   │ 5. server.to('camera:{id}').emit('camera.frame', {frame_base64, captured_at})
   ▼
Browser
   │
   │ 6. socket.on('camera.frame', set <img src="data:image/jpeg;base64,...">)
```

**Cache TTL & error handling**:
- 10 seconds without new frame → cache entry deleted
- `camera.frame_error: {error: "no_frame"}` broadcast to WS subscribers
- Frontend can fallback to polling HTTP endpoint which returns 404 → shows "OFFLINE" placeholder

---

## Alur 4: Face Recognition → Auto Check-in

```
Python AI (recognition_pipeline, per frame)
   │
   │ 1. Detect face (InsightFace)
   │ 2. Extract 512-dim embedding (ArcFace)
   │ 3. Cosine similarity vs embedding_store
   │ 4. Kalau match (> threshold) AND cooldown elapsed:
   ▼
Python AI → NestJS
   │
   │ 5. POST /internal/ai/recognition
   │    Headers: X-Internal-Token
   │    Body: {
   │      camera_id: "uuid",
   │      captured_at: "...",
   │      detections: [{
   │        external_user_id: "uuid",
   │        confidence: 0.97,
   │        bounding_box: {...}
   │      }]
   │    }
   ▼
NestJS InternalController
   │
   │ 6. Verify X-Internal-Token
   │ 7. Panggil AiRecognitionService.processDetection()
   │    a. Lookup user (by user_id)
   │    b. Cek attendance hari ini (sudah check-in?)
   │    c. Cek leave aktif (sedang cuti?)
   │    d. Cek jam kerja (sesuai window?)
   │    e. Cek threshold confidence (sudah di NestJS, defense in depth)
   │    f. Kalau valid: create attendance row
   │ 8. Broadcast WS /realtime:
   │    Event: attendance.created
   │    Payload: {user_id, status, timestamp, attendance_id}
   │ 9. Return ke Python:
   │    {results: [{external_user_id, action: "check_in", attendance_id}]}
   ▼
Python AI
   │
   │ 10. Log hasil (audit)
   ▼
Browser Dashboard (user & admin)
   │
   │ 11. WS /realtime event diterima
   │ 12. State update → re-render
```

---

## Alur 5: Admin Update Camera Config (RTSP URL baru)

```
Browser (Admin)
   │
   │ 1. PATCH /api/cameras/{id} {rtsp_url: "rtsp://new..."}
   ▼
NestJS CameraController
   │
   │ 2. Update Postgres (cameras table)
   │ 3. Audit log
   │ 4. POST /internal/ai/cameras/{id}/reload
   │    Body: {rtsp_url: "rtsp://new..."}
   ▼
Python AI
   │
   │ 5. Stop existing FFmpeg (graceful)
   │ 6. State: RUNNING → CONNECTING
   │ 7. POST /internal/ai/state-change {state: "CONNECTING"}
   │ 8. Apply new config in-memory
   │ 9. Spawn new FFmpeg dengan RTSP baru
   │ 10. State: CONNECTING → RUNNING
   │ 11. POST /internal/ai/state-change {state: "RUNNING"}
   ▼
NestJS
   │
   │ 12. Broadcast WS /realtime camera.status (semua state transitions)
```

Kamera lain (id 1, 2, 3, 6-10) TIDAK terganggu. Hanya camera 5 yang restart.

---

## State Machine Camera (Python)

```
        start              detection_error
STOPPED ──────► CONNECTING ──────► ERROR
   ▲               │                  │
   │               ▼                  │ reconnect
   │            RUNNING ◄─────────────┤
   │               │                  │
   │          stop │                  │
   └───────────────┘                  │
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

States:
- `STOPPED` — initial & final state
- `CONNECTING` — FFmpeg spawning, RTSP handshake
- `RUNNING` — actively streaming, recognition happening
- `RECONNECTING` — connection lost, attempting reconnect (1s, 2s, 4s, 8s, 16s, 30s max)
- `ERROR` — 5x reconnect failed, needs admin intervention

---

## Idempotent Endpoints

Semua camera control idempotent — aman untuk retry/click berulang:

| Endpoint | State saat ini | Response |
|---|---|---|
| `POST /api/cameras/{id}/start` | STOPPED | `{status: "started"}` |
| | CONNECTING | `{status: "starting"}` |
| | RUNNING | `{status: "already_running"}` |
| | RECONNECTING | `{status: "reconnecting"}` |
| | ERROR | `{status: "starting", note: "will_retry"}` |
| `POST /api/cameras/{id}/stop` | RUNNING | `{status: "stopped"}` |
| | STOPPED | `{status: "already_stopped"}` |
| | (lainnya) | `{status: "stopped"}` |
| `POST /api/cameras/{id}/restart` | any | always `{status: "restarting"}` |
| `POST /api/cameras/{id}/reload` | any | `{status: "reloading"}` |
| `POST /api/cameras/{id}/reconnect` | any | `{status: "reconnecting"}` |

Tidak ada 409 Conflict. Scheduler retry aman, double-click aman, deployment retry aman.

---

## Alur 6: First Boot — Admin Seeder

```
docker compose up -d
   │
   ▼
postgres (healthy)
   │
   ▼
backend container starts
   │
   │ 1. AppModule init → TypeOrmModule auto-creates schema (synchronize: true)
   │ 2. UsersModule init → UsersSeeder registered
   │ 3. onApplicationBootstrap() fires
   ▼
UsersSeeder
   │
   │ 4. findOne({where: [{email: SEED_ADMIN_EMAIL}, {username: SEED_ADMIN_USERNAME}]})
   │ 5. If found → log "Admin exists, skip" → return
   │ 6. If not found:
   │    a. bcrypt.hash(SEED_ADMIN_PASSWORD, 12)
   │    b. INSERT users (email, username, password_hash, full_name, role: 'admin', is_active: true)
   │    c. log "Admin created → email: ..., username: ..."
   ▼
Frontend → /login → enter "admin" / "Admin@1234" → success
```

**Configuration** (env vars):
- `SEED_ADMIN_EMAIL` (default: `admin@absenface.local`)
- `SEED_ADMIN_USERNAME` (default: `admin`)
- `SEED_ADMIN_PASSWORD` (default: `Admin@1234`)
- `SEED_ADMIN_FULL_NAME` (default: `System Administrator`)

**Idempotent**: runs every boot but checks for existing admin first — never duplicates.

---

## Batasan yang TIDAK Boleh Dilanggar

| Larangan | Alasan |
|---|---|
| Python AI import `psycopg`/`asyncpg`/`sqlalchemy` | Single source of truth DB |
| Python AI punya `socket.io`/`websocket` ke frontend | Single source of truth realtime |
| Python AI tahu schema `users`/`attendances`/`leaves` | Single source of truth business |
| NestJS spawn `ffmpeg` | Separation of concerns — Python fokus video |
| NestJS load ONNX/InsightFace model | AI service responsibility |
| NestJS hardcode business rule di Python callback | NestJS owns validation |
| Frontend connect langsung ke Python | Single entry point via NestJS |

---

## Mengapa Design Ini

| Aspek | Benefit |
|---|---|
| **Replaceable AI** | Tukar InsightFace dengan cloud AI (AWS Rekognition, Azure Face) — NestJS contract tetap |
| **Independent scaling** | AI service bisa di-scale horizontal tanpa scale NestJS |
| **Failure isolation** | AI crash → preview mati, tapi attendance API tetap jalan |
| **Single audit point** | Semua business action tercatat di NestJS audit log |
| **Single security boundary** | CORS, rate limit, JWT semua di NestJS |
| **Easier testing** | Mock Python untuk unit test NestJS; mock NestJS untuk unit test Python |
