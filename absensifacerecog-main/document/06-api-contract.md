# API Contract — Sistem Absensi

> Detail kontrak HTTP + WebSocket. Lihat `02-architecture.md` untuk flow, `05-spec.md` untuk overview.

---

## 1. FRONTEND → NESTJS

### 1.1 Standard Response Format

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "limit": 20, "total": 100 }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email already registered"
  }
}
```

### 1.2 Auth Endpoints

#### `POST /api/auth/register`
```json
// Request
{ "email": "user@example.com", "username": "optional_handle", "password": "SecureP@ss1", "full_name": "John Doe" }

// Response 201
{ "success": true, "data": { "id": "uuid", "email": "...", "username": "...", "full_name": "...", "role": "employee", "created_at": "..." } }
```

Validation:
- email: valid, max 100 (unique)
- username: optional, 3-50 chars, `[a-zA-Z0-9_.-]+` only (unique)
- password: min 8, 1 upper, 1 lower, 1 digit, 1 special
- full_name: 2-100

#### `POST /api/auth/login`
```json
// Request (identifier accepts email OR username)
{ "identifier": "admin" | "admin@absenface.local", "password": "..." }

// Response 200 (cookies set)
// Set-Cookie: access_token=...; HttpOnly; SameSite=Strict; Path=/; Max-Age=900
// Set-Cookie: refresh_token=...; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=604800
{ "success": true, "data": { "user": {"id":"uuid","email":"...","username":"...","full_name":"...","role":"admin"}, "access_token_expires_in": 900 } }
```

**Identifier detection**:
- Contains `@` → query `users.email`
- Otherwise → query `users.username`

#### `POST /api/auth/refresh` (cookie-based)
```json
// Response 200 (new cookies set)
{ "success": true, "data": { "access_token_expires_in": 900 } }
```

#### `POST /api/auth/logout`
```json
// Response 200
{ "success": true, "data": null }
```

#### `GET /api/auth/me`
```json
// Response 200
{ "success": true, "data": { "id": "uuid", "email": "...", "full_name": "...", "role": "employee" } }
```

### 1.3 Users (admin only)

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/users?page=1&limit=20&search=&role=&is_active=` | — | `{success, data: User[], meta}` |
| `GET` | `/api/users/{id}` | — | `{success, data: User}` |
| `POST` | `/api/users` | `{email, username?, password, full_name, role}` | `{success, data: User}` |
| `PATCH` | `/api/users/{id}` | `{full_name?, username?, role?, is_active?}` | `{success, data: User}` |
| `DELETE` | `/api/users/{id}` | — | `204 No Content` (soft delete) |

`search` parameter matches against `email`, `username`, or `full_name` (ILIKE).

### 1.4 Attendance

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/api/attendance/check-in` | JWT | `{location_lat?, location_lng?, photo?, notes?}` | `{success, data: Attendance}` |
| `POST` | `/api/attendance/check-out` | JWT | `{location_lat?, location_lng?, photo?, notes?}` | `{success, data: Attendance}` |
| `GET` | `/api/attendance?from=&to=&page=&limit=` | JWT | — | `{success, data: Attendance[], meta}` |
| `GET` | `/api/attendance/today` | JWT | — | `{success, data: {checked_in, checked_out, attendance}}` |
| `GET` | `/api/attendance/all?from=&to=&user_id=&status=` | JWT + admin | — | `{success, data: Attendance[], meta}` |

### 1.5 Leave

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/api/leaves` | JWT | `{type, start_date, end_date, reason}` | `{success, data: Leave}` |
| `GET` | `/api/leaves?page=&limit=&status=` | JWT | — | `{success, data: Leave[], meta}` |
| `GET` | `/api/leaves/all?page=&limit=&status=&user_id=&type=` | JWT + admin | — | `{success, data: Leave[], meta}` |
| `PATCH` | `/api/leaves/{id}` | JWT + admin | `{status: "approved"\|"rejected"}` | `{success, data: Leave}` |

### 1.6 Camera CRUD (admin only)

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/cameras` | — | `{success, data: Camera[]}` |
| `POST` | `/api/cameras` | `{name, source, rtsp_url?, usb_device_path?, onvif_host?, onvif_port?, onvif_username?, onvif_password?, location?}` | `{success, data: Camera}` |
| `PATCH` | `/api/cameras/{id}` | `{name?, rtsp_url?, is_active?, ...}` | `{success, data: Camera}` |
| `DELETE` | `/api/cameras/{id}` | — | `204` |

**Source types**:
- `rtsp` — direct RTSP URL (`rtsp_url` required)
- `onvif` — ONVIF device, AI service resolves RTSP via `GetStreamUri` (`onvif_host`, `onvif_port`, `onvif_username`, `onvif_password` required)
- `usb` — USB camera (`usb_device_path` required)

### 1.7 Camera Control (admin only, IDEMPOTENT)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/cameras/{id}/start` | — | `{success, data: {status: "started"\|"already_running"\|"starting"\|"reconnecting", camera_id}}` |
| `POST` | `/api/cameras/{id}/stop` | — | `{success, data: {status: "stopped"\|"already_stopped", camera_id}}` |
| `POST` | `/api/cameras/{id}/restart` | — | `{success, data: {status: "restarting", camera_id}}` |
| `POST` | `/api/cameras/{id}/reconnect` | — | `{success, data: {status: "reconnecting", camera_id}}` |
| `GET` | `/api/cameras/{id}/state` | — | `{success, data: {state, last_frame_at, error?}}` |
| `GET` | `/api/cameras/sources` | — | `{success, data: ["onvif", "rtsp", "usb"]}` |
| `GET` | `/api/cameras/usb/devices` | — | `{success, data: UsbDevice[]}` |
| `POST` | `/api/cameras/discover` | — | `{success, data: DiscoveredCamera[]}` |

### 1.7.1 Live Preview (admin, JWT required)

| Method | Path | Response |
|---|---|---|
| `GET` | `/api/cameras/{id}/preview.jpg` | `200 image/jpeg` (latest cached frame) **or** `404 {code: "NO_FRAME"}` |

**Exempt from rate limiting** (`@SkipThrottle()`) — designed for high-frequency polling.

**Response headers**:
- `Content-Type: image/jpeg`
- `Content-Length: <bytes>`
- `X-Captured-At: 2026-07-23T02:43:37.580Z` (frame capture timestamp)
- `Cache-Control: no-store, max-age=0` (always fetch fresh)

**Frontend usage**:
```html
<img src="/api/cameras/{id}/preview.jpg?t={tick}" alt="live" />
```

Polled at 1 FPS (keyed by `tick` counter to force reload).

### 1.8 Face Registration (admin only)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/cameras/faces/{userId}` | `{photo: "data:image/jpeg;base64,..."}` | `{success, data: {user_id, embedding_id, status: "registered"}}` |
| `GET` | `/api/cameras/faces/{userId}` | — | `{success, data: {user_id, has_embedding, photo_url?}}` |
| `DELETE` | `/api/cameras/faces/{userId}` | — | `204` |

---

## 2. NESTJS → PYTHON AI (Internal)

Header wajib: `X-Internal-Token: <shared-secret>`

### 2.1 Camera Lifecycle (idempotent)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/internal/ai/cameras/{id}/start` | `{rtsp_url?, source, fps?, resolution?, onvif_host?, onvif_port?, onvif_username?, onvif_password?, onvif_profile_index?}` | `{status: "started"\|"already_running"\|"starting", rtsp_url?}` |
| `POST` | `/internal/ai/cameras/{id}/stop` | — | `{status: "stopped"\|"already_stopped"}` |
| `POST` | `/internal/ai/cameras/{id}/restart` | — | `{status: "restarting"}` |
| `POST` | `/internal/ai/cameras/{id}/reload` | `{rtsp_url?, onvif_host?, ...}` | `{status: "reloading"}` |
| `POST` | `/internal/ai/cameras/{id}/reconnect` | — | `{status: "reconnecting"}` |

**ONVIF source handling** (when `source=onvif`):
1. AI service connects to `onvif_host:onvif_port` with `onvif_username`/`onvif_password`
2. Calls `GetProfiles()` — array of available media profiles
3. Selects profile by `onvif_profile_index` (default 0 = main HD, 1 = sub SD)
4. Calls `GetStreamUri()` to get the actual RTSP URI
5. Spawns ffmpeg subprocess on the resolved RTSP URL
6. Returns `{status: "started", rtsp_url: "rtsp://resolved..."}`

For `source=rtsp`, just pass `rtsp_url` directly. For `source=usb`, pass device path as `rtsp_url` field.

### 2.2 Face Embeddings

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/internal/ai/embeddings` | — | `[{user_id, embedding: [float...], version}]` |
| `PUT` | `/internal/ai/embeddings/{userId}` | `{embedding: [float...], version: 1}` | `{status: "upserted", count: 1}` |
| `DELETE` | `/internal/ai/embeddings/{userId}` | — | `204` |

**Sync strategy**:
- **Boot**: `GET /internal/ai/embeddings` — full snapshot untuk init memory
- **Incremental**: `PUT /internal/ai/embeddings/{userId}` — upsert per user (saat register face baru)
- **Delete**: `DELETE /internal/ai/embeddings/{userId}` — saat admin hapus wajah user

Tidak ada `POST /sync-embeddings` (full resync) untuk hot-path. Kalau perlu full resync (misal ganti model), pakai endpoint khusus `POST /internal/ai/embeddings/reload-all` (admin only).

### 2.3 Camera Discovery (on-demand)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/internal/ai/discover` | — | `[{host, port, rtsp_url?, manufacturer?}]` |
| `GET` | `/internal/ai/usb-devices` | — | `[{name, path, type}]` |

### 2.4 Health

```http
GET /health
→ 200 {
  "status": "ok",
  "service": "ai",
  "version": "1.0.0",
  "uptime": 3402,                          // seconds since boot
  "model_loaded": true,                    // InsightFace loaded?
  "model_name": "buffalo_l",               // insightface model variant
  "embedding_count": 512,                  // total embeddings cached
  "embedding_version": 1,                 // schema version (untuk migration)
  "camera_total": 5,                       // cameras registered
  "camera_running": 3,                     // cameras in RUNNING state
  "camera_states": {                        // per-camera state
    "uuid-1": "RUNNING",
    "uuid-2": "RECONNECTING",
    "uuid-3": "STOPPED",
    "uuid-4": "ERROR",
    "uuid-5": "CONNECTING"
  },
  "cpu_usage": 23.4,                       // percent
  "memory_usage": 512.3,                   // MB
  "last_recognition_at": "2026-07-22T08:00:00Z"
}
```

---

## 3. PYTHON AI → NESTJS (Callback)

Header wajib: `X-Internal-Token: <shared-secret>`

### 3.1 Recognition Result

```http
POST /internal/ai/recognition
Headers: X-Internal-Token: ...
Body: {
  "trace_id": "uuid-v4",          // untuk correlate log NestJS & Python
  "camera_id": "uuid",
  "captured_at": "2026-07-22T08:00:00Z",
  "detections": [
    {
      "external_user_id": "uuid",
      "confidence": 0.97,
      "bounding_box": { "x": 120, "y": 80, "w": 200, "h": 240 }
    }
  ]
}

→ 200 {
  "trace_id": "uuid-v4",         // echo balik untuk confirm
  "results": [
    {
      "external_user_id": "uuid",
      "action": "check_in" | "check_out" | "ignored",
      "reason": "already_checked_in" | "low_confidence" | "on_leave" | "outside_work_hours" | "user_inactive" | null,
      "attendance_id": "uuid" | null
    }
  ]
}
```

Possible actions & reasons:

| Action | Reason | Triggered When |
|---|---|---|
| `check_in` | null | First recognition hari ini & valid |
| `check_out` | null | Sudah check-in, belum check-out |
| `ignored` | `already_checked_in` | Sudah check-in & check-out |
| `ignored` | `low_confidence` | Confidence < threshold |
| `ignored` | `on_leave` | Ada leave aktif |
| `ignored` | `outside_work_hours` | Di luar jam kerja |
| `ignored` | `user_inactive` | User is_active = false |

### 3.2 Frame Preview (1 FPS)

**Recommended**: `Content-Type: image/jpeg` (binary, ~30% smaller than base64)

```http
POST /internal/ai/frame
Headers:
  X-Internal-Token: ...
  X-Camera-Id: uuid
  X-Captured-At: 2026-07-22T08:00:00Z
Content-Type: image/jpeg

<raw JPEG bytes>

→ 204 No Content
```

**Backend body parser**: NestJS uses `express.raw({ type: () => true, limit: '10mb' })` middleware for this route only. The default JSON parser is **disabled globally** (`bodyParser: false` in `NestFactory.create`) and re-enabled for non-frame routes. This allows raw binary frames to reach the controller.

**Fallback (untuk debugging, less efficient)**:

```http
POST /internal/ai/frame
Headers: X-Internal-Token: ...
Content-Type: application/json

Body: { "camera_id": "uuid", "frame_base64": "/9j/4AAQSkZ..." }

→ 204 No Content
```

**Cache policy di NestJS**:
- Last frame per camera disimpan di memory dengan TTL 10 detik
- Setiap frame baru → broadcast ke WebSocket subscribers di `/preview` namespace (throttled ke ~3 FPS untuk avoid spam)
- Kalau Python mati, setelah 10 detik cache expired → broadcast `camera.frame_error: {error: "no_frame"}` ke WS subscribers
- Frontend bisa fallback ke polling `GET /api/cameras/{id}/preview.jpg` (returns 404 if cache empty)

### 3.3 State Change

```http
POST /internal/ai/state-change
Headers: X-Internal-Token: ...
Body: {
  "camera_id": "uuid",
  "state": "STOPPED" | "CONNECTING" | "RUNNING" | "RECONNECTING" | "ERROR",
  "error": "string or null",
  "timestamp": "2026-07-22T08:00:00Z"
}

→ 204 No Content
```

---

## 4. WEBSOCKET (NestJS → Frontend)

URL: `ws://host:4000/{namespace}` (Socket.IO, with `credentials: 'include'`)

### 4.1 `/realtime` namespace

Connect dengan JWT cookie (auto-sent).

**Emit from server:**
| Event | Payload |
|---|---|
| `attendance.created` | `{user_id, full_name, status, timestamp, attendance_id}` |
| `attendance.updated` | `{attendance_id, check_out, timestamp}` |
| `camera.status` | `{camera_id, state, error?}` |
| `camera.registered` | `{camera_id, name, source}` |
| `camera.deleted` | `{camera_id}` |

**Emit from client (subscribe/unsubscribe):**
- Tidak perlu. Server broadcast ke semua connected clients.

### 4.2 `/preview` namespace

Connect dengan JWT cookie.

**Emit from server:**
| Event | Payload |
|---|---|
| `camera.frame` | `{camera_id, frame_base64, captured_at}` |
| `camera.frame_error` | `{camera_id, error}` |

**Emit from client (subscribe to specific camera):**
```javascript
socket.emit('watch', cameraId)
socket.on('camera.frame', (data) => { ... })
socket.emit('unwatch', cameraId)
```

---

## 5. ERROR CODES

| Code | HTTP | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `UNAUTHORIZED` | 401 | Missing or invalid JWT |
| `TOKEN_EXPIRED` | 401 | Access token expired (refresh needed) |
| `FORBIDDEN` | 403 | Insufficient role |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Duplicate (e.g. already checked in) |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `AI_SERVICE_UNAVAILABLE` | 503 | Python AI down, retry later |
| `INVALID_INTERNAL_TOKEN` | 401 | Internal service-to-service auth failed |
