# Internal AI Endpoints (`/internal/ai/*`)

> Service-to-service communication. All require `X-Internal-Token` header.

**Base URL** (from backend perspective): `http://ai:8000`
**Base URL** (from AI perspective, callback): `http://backend:4000`

---

## Authentication

All endpoints require header:
```
X-Internal-Token: <shared-secret>
```

Same env var (`INTERNAL_TOKEN`) di backend & AI service. Tidak exposed ke browser.

Validated by:
- Backend: `InternalTokenGuard` on `/internal/ai/*` routes
- AI service: `XInternalToken` middleware

---

## Camera lifecycle (Backend → AI)

### POST /internal/ai/cameras/{id}/start

Start camera pipeline.

**Request**:
```json
{
  "rtsp_url": "rtsp://...",       // null if source=onvif
  "source": "rtsp" | "onvif" | "usb",
  "fps": 1,                      // optional
  "resolution": "640x480",       // optional
  
  // ONVIF-specific (when source=onvif)
  "onvif_host": "192.168.1.9",
  "onvif_port": 10000,
  "onvif_username": "admin",
  "onvif_password": "admin",
  "onvif_profile_index": 0       // 0=main, 1=sub typically
}
```

**Response 200**:
```json
{
  "status": "started" | "already_running" | "starting" | "starting, stop_in_progress",
  "rtsp_url": "rtsp://resolved-onvif-uri"  // for ONVIF, after resolution
}
```

**ONVIF resolution flow**:
1. AI service connects to `onvif_host:onvif_port`
2. Calls `GetProfiles()` → list of media profiles
3. Selects profile by `onvif_profile_index`
4. Calls `GetStreamUri()` → RTSP URI
5. Spawns ffmpeg on resolved URI
6. Returns `rtsp_url` in response (so backend can log resolved URL)

**Errors**:
- `400 BAD_REQUEST` — missing required fields for source
- `502 BAD_GATEWAY` — ONVIF resolution failed

---

### POST /internal/ai/cameras/{id}/stop

Stop camera pipeline.

**Response 200**:
```json
{
  "status": "stopped" | "already_stopped" | "stopping"
}
```

---

### POST /internal/ai/cameras/{id}/restart

Stop + start with existing config.

**Response 200**:
```json
{ "status": "restarting" }
```

---

### POST /internal/ai/cameras/{id}/reload

Stop + apply new config + start.

**Request**: same as start, but for updated fields.

---

### POST /internal/ai/cameras/{id}/reconnect

Force reconnect (e.g. camera went offline).

---

## Face embeddings (Backend ↔ AI sync)

### GET /internal/ai/embeddings

AI service loads all embeddings on boot.

**Response 200**:
```json
[
  {
    "user_id": "uuid",
    "embedding": [0.012, -0.034, ...],  // 512 float values
    "version": 1
  }
]
```

Called by AI service on startup + admin-triggered resync.

---

### PUT /internal/ai/embeddings/{userId}

Backend pushes new embedding to AI when face registered.

**Request**:
```json
{
  "embedding": [0.012, -0.034, ...],
  "version": 1
}
```

**Response 200**:
```json
{ "status": "upserted", "count": 1 }
```

---

### DELETE /internal/ai/embeddings/{userId}

Backend tells AI to remove embedding (user deleted face).

**Response**: 204

---

## Security cameras (Phase 6, Backend → AI sync)

### GET /internal/ai/security-cameras

Get list of security camera IDs (for AI to know which cameras to always report all faces for).

**Request**: empty

**Response 200**:
```json
["uuid-1", "uuid-2", ...]
```

**When called**: on AI boot + on demand when backend updates security_cameras table.

### POST /internal/ai/security-cameras/sync

Push new set of security camera IDs to AI (called when admin adds/removes security camera).

**Request**:
```json
["uuid-1", "uuid-2", ...]
```

**Response 200**:
```json
{ "synced": 2 }
```

**AI behavior**: replace `app_state.security_camera_ids` set with new values.

---

## Camera callbacks (AI → Backend)

### POST /internal/ai/recognition

AI sends detected faces to backend for business logic. Backend decides whether to create attendance or security alert based on `security_cameras` table lookup.

**Request**:
```json
{
  "trace_id": "uuid",             // for log correlation
  "camera_id": "uuid",
  "captured_at": "2026-07-23T08:00:00Z",
  "detections": [
    {
      "face_known": true,
      "external_user_id": "uuid",
      "confidence": 0.94,
      "bounding_box": { "x": 120, "y": 80, "w": 200, "h": 240 },
      "best_matched_user_id": null,
      "best_matched_user_name": null,
      "snapshot_base64": null
    }
  ]
}
```

**Field notes**:
- `face_known` — true if best match >= 0.6 threshold. False for partial/unknown.
- `external_user_id` — only set if `face_known=true` (attendance flow).
- `best_matched_user_id` / `best_matched_user_name` — only set if `face_known=false` (closest match, may be null if no matches at all).
- `snapshot_base64` — only set if `face_known=false` AND camera is security. Base64 JPEG face crop, max 200x200.

For **attendance cameras**: AI only sends detections where `face_known=true` (other faces are dropped silently).

For **security cameras**: AI sends ALL detections (known + unknown), with `snapshot_base64` for unknown.

**Response 200** (backend's decision per detection):
```json
{
  "trace_id": "uuid",
  "results": [
    {
      "external_user_id": "uuid" | null,
      "action": "check_in" | "check_out" | "ignored" | "alerted",
      "reason": "already_checked_in" | "low_confidence" | "on_leave" | "outside_work_hours" | "user_inactive" | "stranger" | "partial_match" | null,
      "attendance_id": "uuid" | null,
      "alert_id": "uuid" | null
    }
  ]
}
```

For **security cameras**: backend creates `security_alerts` row and broadcasts `security.alert` event on `/security` namespace. `action=alerted`, `alert_id` set.

**Side effects** (in backend):
- `INSERT`/`UPDATE` attendances row
- WS broadcast `/realtime` `attendance.created`
- `INSERT` audit_log entry

---

### POST /internal/ai/frame

AI sends 1 FPS preview JPEG to backend (binary, recommended).

**Request (binary)**:
```
Headers:
  X-Internal-Token: <secret>
  X-Camera-Id: uuid
  X-Captured-At: 2026-07-23T08:00:00Z
  Content-Type: image/jpeg

<raw JPEG bytes, 640x480, quality 70>
```

**Response**: 204 No Content

**Backend behavior**:
- `PreviewService.set(camera_id, frame)` → cache in memory
- If 333ms since last broadcast → WS broadcast `/preview` `camera.frame`
- Set 10s TTL timer; on expiry → WS broadcast `camera.frame_error: {error: "no_frame"}`

**Fallback (JSON)**:
```json
{
  "camera_id": "uuid",
  "frame_base64": "/9j/4AAQSkZ..."
}
```

(30% larger, for debugging only)

---

### POST /internal/ai/state-change

AI reports camera state transition.

**Request**:
```json
{
  "camera_id": "uuid",
  "state": "STOPPED" | "CONNECTING" | "RUNNING" | "STOPPING" | "RECONNECTING" | "ERROR",
  "error": "string or null",
  "timestamp": "2026-07-23T08:00:00Z"
}
```

**Response**: 204

**Backend behavior**:
- `CameraFsmService.transition(camera_id, state, error)`
- `AttendanceGateway.broadcastCameraStatus(...)` → WS broadcast `/realtime` `camera.status`
- Update DB `cameras.last_frame_at` (on `RUNNING`)

---

## Discovery (Backend → AI)

### POST /internal/ai/discover

ONVIF WS-Discovery (UDP multicast 239.255.255.250).

**Response 200**:
```json
[
  {
    "host": "192.168.1.9",
    "port": 10000,
    "rtsp_url": "rtsp://...",
    "manufacturer": "Hikvision"
  }
]
```

**Status**: TODO. Currently AI service returns empty array (needs wsdiscovery lib).

---

### GET /internal/ai/usb-devices

List USB devices on AI service host.

**Response 200**:
```json
[
  { "name": "HD Webcam", "path": "/dev/video0", "type": "usb" }
]
```

**Requirement**: USB device passthrough in docker-compose.yml.

---

## Health (no auth)

### GET /health

For Docker healthcheck.

**Response 200**:
```json
{
  "status": "ok",
  "service": "ai",
  "version": "1.0.0",
  "uptime": 3402,
  "model_loaded": true,
  "model_name": "buffalo_l",
  "embedding_count": 512,
  "embedding_version": 1,
  "camera_total": 5,
  "camera_running": 3,
  "camera_states": { "uuid-1": "RUNNING", "uuid-2": "RECONNECTING" },
  "cpu_usage": 23.4,
  "memory_usage": 512.3,
  "last_recognition_at": "2026-07-23T08:00:00Z"
}
```
