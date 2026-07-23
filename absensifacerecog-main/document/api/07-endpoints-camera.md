# Camera Endpoints (`/api/cameras/*`)

> Admin-only camera management + live preview.

All CRUD endpoints require `admin` role. Preview endpoint requires any authenticated user.

---

## Source types

| Source | Required fields | How it works |
|---|---|---|
| `rtsp` | `rtsp_url` | Direct RTSP URL, e.g. `rtsp://user:pass@host:554/stream` |
| `onvif` | `onvif_host`, `onvif_port`, `onvif_username`, `onvif_password` | AI service uses ONVIF GetStreamUri to resolve RTSP dynamically |
| `usb` | `usb_device_path` | e.g. `/dev/video0` (requires device mount to AI container) |

---

## GET /api/cameras

List all cameras.

**Auth**: JWT + admin

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Entrance",
      "source": "onvif",
      "rtsp_url": null,
      "usb_device_path": null,
      "onvif_host": "192.168.1.9",
      "onvif_port": 10000,
      "onvif_username": "admin",
      "onvif_password": "admin",        // ⚠️ plaintext, only via admin auth
      "is_active": true,
      "location": "Lobby",
      "last_frame_at": "2026-07-23T...",
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

---

## POST /api/cameras

Create new camera.

**Request**:
```json
{
  "name": "Entrance",
  "source": "onvif",
  "rtsp_url": "rtsp://...",          // for source=rtsp
  "usb_device_path": "/dev/video0", // for source=usb
  "onvif_host": "192.168.1.9",      // for source=onvif
  "onvif_port": 10000,
  "onvif_username": "admin",
  "onvif_password": "admin",
  "is_active": true,
  "location": "Lobby"
}
```

**Response 201**: camera object.

---

## PATCH /api/cameras/{id}

Update camera config.

**Side effects**:
- DB update
- Push to AI service: `POST /internal/ai/cameras/{id}/reload` (per P8: event-driven)
- AI service stops existing ffmpeg + spawns new with new config

**Response 200**: updated camera.

---

## DELETE /api/cameras/{id}

Stop camera + delete from DB.

**Side effects**:
- AI service: stop pipeline first
- Backend: stop camera (`POST /internal/ai/cameras/{id}/stop`)
- DB: DELETE row
- WS broadcast `camera.deleted`

**Response**: 204

---

## GET /api/cameras/{id}/state

Get current state + last frame timestamp.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "camera_id": "uuid",
    "state": "RUNNING" | "STOPPED" | "CONNECTING" | "STOPPING" | "RECONNECTING" | "ERROR",
    "error": null | "connection refused",
    "last_frame_at": "2026-07-23T..." | null
  }
}
```

---

## GET /api/cameras/{id}/preview.jpg

**Live preview** — returns latest cached frame as JPEG.

**Auth**: JWT (any role)

**`@SkipThrottle()`** — exempt from rate limit (high-frequency polling).

**Response 200**:
```
Content-Type: image/jpeg
Content-Length: 32845
Cache-Control: no-store, max-age=0
X-Captured-At: 2026-07-23T08:00:00Z

<raw JPEG bytes 640x480>
```

**Response 404** (no frame in cache):
```json
{
  "success": false,
  "error": { "code": "NO_FRAME", "message": "No preview available" }
}
```

**Frontend usage**:
```html
<img key={tick} src="/api/cameras/{id}/preview.jpg?t={tick}" alt="live" />
```

Poll every 1 second. Cache key in `tick` forces reload.

---

## POST /api/cameras/{id}/start (IDEMPOTENT)

Start camera pipeline.

**Response 200** (state-dependent):
```json
{
  "success": true,
  "data": {
    "status": "started" | "already_running" | "starting" | "reconnecting",
    "camera_id": "uuid",
    "state": "RUNNING"
  }
}
```

**State table**:

| Current state | Response | Side effect |
|---|---|---|
| `STOPPED` | `started` | spawn ffmpeg |
| `CONNECTING` | `starting` | none |
| `RUNNING` | `already_running` | none |
| `RECONNECTING` | `reconnecting` | none |
| `ERROR` | `starting` | trigger reconnect |

---

## POST /api/cameras/{id}/stop (IDEMPOTENT)

Stop camera pipeline.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "status": "stopped" | "already_stopped" | "stopping",
    "camera_id": "uuid"
  }
}
```

---

## POST /api/cameras/{id}/restart (IDEMPOTENT)

Stop + start again.

**Response 200**: `{status: "restarting"}`

---

## POST /api/cameras/{id}/reconnect (IDEMPOTENT)

Force reconnect (e.g. after camera offline).

---

## GET /api/cameras/sources

List supported source types.

**Response**:
```json
{ "success": true, "data": ["onvif", "rtsp", "usb"] }
```

---

## GET /api/cameras/usb/devices

List USB camera devices (delegated to AI service).

**Response**:
```json
{
  "success": true,
  "data": [
    { "name": "HD Webcam", "path": "/dev/video0", "type": "usb" }
  ]
}
```

**Note**: only works if AI service has USB device passthrough.

---

## POST /api/cameras/discover

ONVIF WS-Discovery (delegated to AI service).

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "host": "192.168.1.9",
      "port": 10000,
      "rtsp_url": "rtsp://...",   // optional
      "manufacturer": "Hikvision"
    }
  ]
}
```

**Note**: WS-Discovery uses UDP multicast 239.255.255.250. May not work in all network configs.

---

## Face registration (admin only)

### POST /api/cameras/faces/{userId}

Register face embedding for user.

**Request**:
```json
{
  "photo": "data:image/jpeg;base64,..."
}
```

**Flow**:
1. Backend sends photo to AI: `POST /internal/ai/register-face/{userId}`
2. AI service: detect face, extract 512-dim embedding via InsightFace
3. Backend stores embedding in DB (`face_embeddings`)
4. AI service adds to in-memory cache
5. Response: `{user_id, embedding_id, status: "registered"}`

**Errors**:
- `400 NO_FACE_DETECTED` (from AI)
- `400 LOW_QUALITY` (from AI, multiple faces, etc)

### GET /api/cameras/faces/{userId}

Check if user has registered face.

**Response**:
```json
{
  "success": true,
  "data": {
    "user_id": "uuid",
    "has_embedding": true,
    "photo_url": "https://..."  // optional, reference photo
  }
}
```

### DELETE /api/cameras/faces/{userId}

Remove user's face embedding.

**Response**: 204

**Side effects**: AI service removes from in-memory cache.

---

## Security Room Module (Phase 6, separate from attendance)

**These endpoints are for `security_cameras` table — completely separate from `/api/cameras/*`.**

> Detail lengkap di `services/06-security.md`. Use case: monitor server room / vault where only authorized IT staff should enter. Unknown face → critical alert + Telegram webhook + modal popup.

### GET /api/security/cameras

List all security cameras.

**Auth**: admin

**Response 200**: array of `SecurityCamera` objects (same shape as `cameras` minus `mode` field).

### POST /api/security/cameras

Register new security camera.

**Request**:
```json
{
  "name": "Server Room",
  "source": "rtsp" | "onvif" | "usb",
  "rtsp_url": "rtsp://...",
  "onvif_host": "192.168.1.9",
  "onvif_port": 10000,
  "onvif_username": "admin",
  "onvif_password": "admin",
  "location": "IT Room 2nd floor"
}
```

**Response 201**: SecurityCamera object.

### GET /api/security/cameras/{id}

Get single security camera by ID.

### PATCH /api/security/cameras/{id}

Update config. Side effect: push to AI service.

### DELETE /api/security/cameras/{id}

Stop pipeline + delete from DB.

### POST /api/security/cameras/{id}/start (IDEMPOTENT)

Start streaming. Same response table as attendance camera (started/already_running/starting/reconnecting).

### POST /api/security/cameras/{id}/stop (IDEMPOTENT)

Stop streaming.

### POST /api/security/cameras/{id}/restart (IDEMPOTENT)

Stop + start.

### GET /api/security/cameras/{id}/state

Current FSM state (STOPPED / CONNECTING / RUNNING / STOPPING / RECONNECTING / ERROR).

### GET /api/security/cameras/{id}/preview.jpg

Live preview. `@SkipThrottle()` (high-frequency polling). Same as attendance preview endpoint.

### GET /api/security/alerts

List alerts (paginated, filterable).

**Query params**: `camera_id`, `severity` (info/warning/critical), `reviewed` (bool), `face_known` (bool), `from`, `to`, `page`, `limit`.

**Response 200**:
```json
{
  "data": [
    {
      "id": "uuid",
      "camera_id": "uuid",
      "camera_name": "Server Room",
      "face_known": false,
      "matched_user_id": null,
      "matched_user_name": null,
      "confidence": 0.18,
      "bounding_box": {"x": 120, "y": 80, "w": 200, "h": 240},
      "snapshot_jpeg": "data:image/jpeg;base64,...",
      "severity": "critical",
      "reviewed": false,
      "reviewed_by": null,
      "reviewed_at": null,
      "notes": null,
      "captured_at": "2026-07-23T14:30:00Z",
      "created_at": "2026-07-23T14:30:00Z"
    }
  ],
  "meta": {"page": 1, "limit": 20, "total": 42}
}
```

### GET /api/security/alerts/stats

Aggregate counts.

**Response 200**:
```json
{
  "total": 142,
  "unreviewed": 5,
  "by_severity": {"info": 130, "warning": 8, "critical": 4},
  "today": 12,
  "today_unreviewed": 1
}
```

### GET /api/security/alerts/{id}

Get single alert (full snapshot_jpeg).

### PATCH /api/security/alerts/{id}/review

Mark as reviewed.

**Request**:
```json
{ "notes": "Checked CCTV feed, was delivery guy" }
```

**Response 200**: updated alert.

### WS /security

Subscribe to security alerts.

**Connect**: same Socket.IO connection, join `/security` namespace.

**Event**:
```json
{
  "alert_id": "uuid",
  "camera_id": "uuid",
  "camera_name": "Server Room",
  "type": "known_access" | "partial_match" | "stranger",
  "severity": "info" | "warning" | "critical",
  "face_known": true | false,
  "matched_user_id": "uuid" | null,
  "matched_user_name": "John Doe" | null,
  "confidence": 0.34,
  "bounding_box": {"x": 120, "y": 80, "w": 200, "h": 240},
  "snapshot_jpeg": "data:image/jpeg;base64,...",
  "captured_at": "2026-07-23T14:30:00Z"
}
```
