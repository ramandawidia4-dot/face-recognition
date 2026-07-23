# Service: AI (Python FastAPI)

> Camera streaming, face detection, face recognition. NO database access, NO business logic.

---

## Tujuan

- ONVIF discovery + RTSP URI resolution
- ffmpeg subprocess per camera (raw BGR24 frames)
- InsightFace detection + ArcFace embedding (512-dim)
- Cosine similarity matching
- 1 FPS preview JPEG extraction
- Camera state machine
- HTTP callbacks ke backend (recognition, frame, state-change)

---

## Tech

| | Version |
|---|---|
| Python | 3.12 |
| FastAPI | 0.115+ |
| Pydantic | 2.9+ |
| uvicorn | 0.32+ |
| httpx | 0.28+ |
| **requests** | 2.32+ (sync, for thread context) |
| opencv-python-headless | 4.10+ |
| insightface | 0.7+ |
| onvif-zeep-async | 3.2+ |
| numpy | 2.1+ |
| python-dotenv | 1.0+ |
| uv | 0.11+ (package manager) |

---

## Struktur (target)

```
ai-service/
├── pyproject.toml                # deps + uv config
├── Dockerfile                     # python:3.12-slim + ffmpeg + uv
└── app/
    ├── main.py                    # FastAPI bootstrap
    ├── config.py                  # settings (env vars)
    ├── state.py                   # global state manager (thread-safe) + security_camera_ids set
    ├── state.py                   # global state manager (thread-safe)
    │
    ├── middleware/
    │   └── auth.py                # X-Internal-Token validation
    │
    ├── models/
    │   └── schemas.py             # Pydantic request/response
    │
    ├── services/
    │   ├── backend_client.py      # sync HTTP to backend
    │   ├── boot_sync.py           # load embeddings on startup
    │   ├── embedding_store.py     # in-memory cache
    │   ├── face_detector.py       # InsightFace wrapper
    │   ├── face_registration.py   # register new face
    │   ├── onvif_client.py        # ONVIF resolve RTSP URI
    │   ├── onvif_discovery.py     # WS-Discovery (TODO)
    │   ├── preview_generator.py   # 1 FPS JPEG
    │   ├── recognition_pipeline.py # detect + match
    │   ├── stream_manager.py      # ffmpeg subprocess per camera
    │   └── usb_detection.py       # list USB devices
    │
    └── routes/
        ├── health.py              # GET /health (no auth)
        ├── cameras.py             # /internal/ai/cameras/{id}/*
        ├── faces.py               # /internal/ai/faces/*
        ├── discover.py            # /internal/ai/discover
        ├── security_cameras.py    # /internal/ai/security-cameras (NEW Phase 6)
        └── boot_sync.py           # /internal/ai/boot-sync (full sync including security set)
```

---

## Camera state machine

States: `STOPPED | CONNECTING | RUNNING | STOPPING | RECONNECTING | ERROR`

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

**State held where**:
- AI service: `app_state` (in-memory, thread-safe with lock)
- Backend: `CameraFsmService` (in-memory, source of truth for UI)

**State sync**: AI state change → POST `/internal/ai/state-change` → Backend updates FSM + broadcasts WS.

---

## Camera lifecycle (idempotent)

### POST /internal/ai/cameras/{id}/start

```python
@router.post("/{camera_id}/start")
async def start_camera(camera_id: str, body: CameraStartRequest):
    entry = app_state.get_camera(camera_id)
    current = entry.state if entry else CameraState.STOPPED
    
    # Idempotent
    if current == CameraState.RUNNING:
        return {"status": "already_running"}
    if current in (CameraState.CONNECTING, CameraState.RECONNECTING):
        return {"status": "starting"}
    if current == CameraState.STOPPING:
        return {"status": "starting", "note": "stop_in_progress"}
    
    # Resolve RTSP URL (for ONVIF source)
    rtsp_url = await _resolve_url(body)
    
    # Mark CONNECTING + spawn worker
    entry = entry or app_state.add_camera(camera_id, rtsp_url, body.source)
    entry.transition(CameraState.CONNECTING)
    
    entry.thread = threading.Thread(
        target=StreamManager._run_pipeline,
        args=(camera_id, rtsp_url, body.source),
        daemon=True,
    )
    entry.thread.start()
    
    return {"status": "started", "rtsp_url": rtsp_url}


async def _resolve_url(body: CameraStartRequest) -> str:
    if body.source == "onvif":
        uri = await resolve_rtsp_uri(
            host=body.onvif_host,
            port=body.onvif_port,
            username=body.onvif_username or "admin",
            password=body.onvif_password or "",
            profile_index=body.onvif_profile_index,
        )
        if not uri:
            raise HTTPException(502, f"ONVIF resolve failed for {body.onvif_host}:{body.onvif_port}")
        return uri
    
    if not body.rtsp_url:
        raise HTTPException(400, "rtsp_url required for source=rtsp")
    return body.rtsp_url
```

---

## ffmpeg pipeline (worker thread)

```python
class StreamManager:
    @staticmethod
    async def start(camera_id, rtsp_url, source="rtsp"):
        entry = app_state.get_camera(camera_id) or app_state.add_camera(camera_id, rtsp_url, source)
        entry.rtsp_url = rtsp_url
        entry.source = source
        entry.transition(CameraState.CONNECTING)
        
        entry.thread = threading.Thread(
            target=StreamManager._run_pipeline,
            args=(camera_id, rtsp_url, source),
            daemon=True,
        )
        entry.thread.start()
    
    @staticmethod
    def _run_pipeline(camera_id, rtsp_url, source):
        entry = app_state.get_camera(camera_id)
        if not entry: return
        backend_client.send_state_change_sync(camera_id, "CONNECTING")
        
        try:
            if source == "usb":
                # OpenCV VideoCapture
                ...
            else:
                # RTSP via ffmpeg subprocess
                cmd = [
                    "ffmpeg",
                    "-rtsp_transport", "tcp",     # TCP transport (lebih reliable)
                    "-i", rtsp_url,
                    "-an",                          # no audio
                    "-f", "rawvideo",
                    "-pix_fmt", "bgr24",            # 3-channel BGR (no alpha)
                    "-vf", "scale=640:480",         # fixed size for downstream
                    "-fflags", "nobuffer",          # low latency
                    "-flags", "low_delay",
                    "pipe:1",
                ]
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    bufsize=10**7,
                )
                entry.process = proc
                
                W, H = 640, 480
                frame_size = W * H * 3  # 921600 bytes
                buf = bytearray()
                
                while True:
                    if entry.state == CameraState.STOPPING:
                        proc.terminate()
                        return
                    
                    chunk = proc.stdout.read(frame_size - len(buf))
                    if not chunk:
                        stderr = proc.stderr.read(2000).decode(errors="replace")
                        logger.warning(f"ffmpeg closed: {stderr[-300:]}")
                        return
                    
                    buf.extend(chunk)
                    if len(buf) >= frame_size:
                        frame = np.frombuffer(bytes(buf[:frame_size]), dtype=np.uint8).reshape(H, W, 3)
                        buf.clear()
                        
                        if entry.state == CameraState.CONNECTING:
                            entry.transition(CameraState.RUNNING)
                            backend_client.send_state_change_sync(camera_id, "RUNNING")
                        
                        RecognitionPipeline.process_frame(camera_id, frame)
        
        except Exception as e:
            logger.exception(f"Pipeline error for {camera_id}")
            entry.transition(CameraState.ERROR, str(e))
            backend_client.send_state_change_sync(camera_id, "ERROR", str(e))
    
    @staticmethod
    async def stop(camera_id):
        entry = app_state.get_camera(camera_id)
        if not entry: return
        if entry.state in (CameraState.STOPPED, CameraState.STOPPING): return
        entry.transition(CameraState.STOPPING)
        backend_client.send_state_change_sync(camera_id, "STOPPING")
        
        if entry.process:
            try:
                entry.process.terminate()
                try: entry.process.wait(timeout=3)
                except: entry.process.kill()
            except: pass
            entry.process = None
        
        entry.transition(CameraState.STOPPED)
        backend_client.send_state_change_sync(camera_id, "STOPPED")
```

**Important**: `subprocess.Popen` di thread (bukan event loop). `stdout.read()` blocking tapi itu OK karena dedicated thread per camera.

---

## ONVIF client

```python
async def resolve_rtsp_uri(host, port=10000, username="admin", password="", profile_index=0):
    try:
        from onvif import ONVIFCamera
    except ImportError:
        return None
    
    try:
        cam = ONVIFCamera(host, port, username, password)
        await cam.update_xaddrs()
        media = await cam.create_media_service()
        profiles = await media.GetProfiles()
        if not profiles:
            return None
        
        idx = max(0, min(profile_index, len(profiles) - 1))
        profile_token = profiles[idx].token
        
        uri = await media.GetStreamUri({
            "StreamSetup": {"Stream": "RTP-Unicast", "Transport": {"Protocol": "RTSP"}},
            "ProfileToken": profile_token,
        })
        return uri.Uri
    except Exception as e:
        logger.error(f"ONVIF resolve failed: {e}")
        return None
```

**Common gotcha**: vendor-specific path. ONVIF standard tapi RTSP URI beda per vendor:
- Hikvision: `rtsp://user:pass@host:554/Streaming/Channels/101`
- Dahua: `rtsp://user:pass@host:554/cam/realmonitor?channel=1&subtype=0`
- Generic: `rtsp://user:pass@host:554/V_ENC_000` (returned by ONVIF GetStreamUri, **vendor-specific**)

**Solution**: pakai ONVIF GetStreamUri (vendor-agnostic), bukan hardcoded path.

---

## Face detection & recognition

```python
class RecognitionPipeline:
    @staticmethod
    def process_frame(camera_id, frame):
        # 1) Send preview (1 FPS throttled)
        preview_generator.maybe_send_preview(camera_id, frame)

        # 2) Detect faces
        faces = face_detector.detect(frame)
        if not faces: return

        # 3) Determine pipeline: attendance vs security
        is_security = is_security_camera(camera_id)  # O(1) set lookup

        # 4) Build detections
        detections = []
        for face in faces:
            emb = face.embedding
            best_user_id, best_user_name, best_score = embedding_store.find_match_with_score(emb)
            is_known = best_score >= settings.confidence_threshold

            if not is_security:
                # Attendance: only report matched faces
                if not is_known: continue
                detections.append({
                    "face_known": True,
                    "external_user_id": best_user_id,
                    "confidence": float(best_score),
                    "bounding_box": {...},
                })
            else:
                # Security: report ALL faces, with snapshot
                snapshot = None if is_known else crop_and_encode_face(frame, face.bbox)
                detections.append({
                    "face_known": is_known,
                    "external_user_id": best_user_id if is_known else None,
                    "confidence": float(best_score),
                    "best_matched_user_id": best_user_id if not is_known else None,
                    "best_matched_user_name": best_user_name if not is_known else None,
                    "bounding_box": {...},
                    "snapshot_base64": snapshot,
                })

        if not detections: return

        # 5) Send to backend — backend decides pipeline based on security_cameras table
        event = {
            "trace_id": str(uuid.uuid4()),
            "camera_id": camera_id,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "detections": detections,
        }
        try:
            asyncio.run(backend_client.send_recognition(event))
        except Exception as e:
            logger.error(f"Recognition callback failed: {e}")
```

**Face detector**:
```python
class FaceDetector:
    def __init__(self):
        self.app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        self.app.prepare(ctx_id=0, det_size=(640, 640))

    def detect(self, frame):
        faces = self.app.get(frame)
        return faces
```

**Embedding store** (in-memory cache, loaded on boot):
```python
class EmbeddingStore:
    def __init__(self):
        self._embeddings: list[tuple[str, np.ndarray, int]] = []
        # (user_id, embedding_512, version)

    def load_from_backend(self, embeddings: list[dict]):
        self._embeddings = []
        for e in embeddings:
            self._embeddings.append((
                e["user_id"],
                np.array(e["embedding"], dtype=np.float32),
                e.get("version", 1),
            ))

    def find_match(self, query_emb, threshold=0.6):
        """Returns (user_id, score) if best >= threshold, else None."""
        result = self.find_match_with_score(query_emb)
        if result[0] is not None and result[2] >= threshold:
            return (result[0], result[2])
        return None

    def find_match_with_score(self, query_emb):
        """Returns (best_user_id, best_user_name, best_score) — score is always returned even if below threshold.

        Used by security pipeline to determine severity:
        - score >= 0.6 → known (info)
        - 0.3 <= score < 0.6 → partial match (warning)
        - score < 0.3 → stranger (critical)
        """
        if not self._embeddings:
            return (None, None, 0.0)

        query_norm = query_emb / np.linalg.norm(query_emb)
        best_user_id, best_user_name, best_score = None, None, -1.0

        for user_id, emb, _ in self._embeddings:
            emb_norm = emb / np.linalg.norm(emb)
            score = float(np.dot(query_norm, emb_norm))
            if score > best_score:
                best_score = score
                best_user_id = user_id
                # Look up name (would require join — placeholder)
                best_user_name = user_id

        if best_score < 0:
            best_score = 0.0
        return (best_user_id, best_user_name, best_score)
```

**Face crop helper** (used in security mode):
```python
def crop_and_encode_face(frame, bbox, padding=0.2):
    """Crop face region with padding, encode as JPEG base64."""
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    pad_w, pad_h = int((x2 - x1) * padding), int((y2 - y1) * padding)
    x1, y1 = max(0, x1 - pad_w), max(0, y1 - pad_h)
    x2, y2 = min(w, x2 + pad_w), min(h, y2 + pad_h)
    face_crop = frame[y1:y2, x1:x2]

    # Resize to max 200x200
    max_dim = max(face_crop.shape[0], face_crop.shape[1])
    if max_dim > 200:
        scale = 200 / max_dim
        new_w, new_h = int(face_crop.shape[1] * scale), int(face_crop.shape[0] * scale)
        face_crop = cv2.resize(face_crop, (new_w, new_h))

    ok, buf = cv2.imencode(".jpg", face_crop, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    if not ok: return None
    return base64.b64encode(buf.tobytes()).decode('utf-8')
```

---

## Sync vs Async — important

**AI service pakai hybrid**:
- **FastAPI routes**: async (httpx async client)
- **Worker threads** (per-camera ffmpeg): sync (`requests`, `subprocess`)

**Gotcha**: `asyncio.run()` di dalam thread membuat event loop baru setiap call. Itu **broken** — multiple frames concurrent akan crash. Solusi: pakai `requests` sync library.

```python
class BackendClient:
    def send_state_change_sync(self, camera_id, state, error=None):
        import requests
        try:
            requests.post(
                f"{settings.backend_url}/internal/ai/state-change",
                json={"camera_id": camera_id, "state": state, "error": error, ...},
                headers={"X-Internal-Token": settings.internal_token},
                timeout=5,
            )
        except Exception as e:
            logger.error(f"[sync] state change failed: {e}")
    
    def send_frame_sync(self, camera_id, captured_at, jpeg_bytes):
        import requests
        try:
            requests.post(
                f"{settings.backend_url}/internal/ai/frame",
                data=jpeg_bytes,  # NB: requests uses `data=`, not `content=`
                headers={"X-Camera-Id": camera_id, "X-Captured-At": captured_at, ...},
                timeout=5,
            )
        except Exception as e:
            logger.error(f"[sync] frame send failed: {e}")
    
    async def send_recognition(self, event):
        # Async because called from async context (FastAPI handler, not thread)
        async with httpx.AsyncClient() as client:
            r = await client.post(...)
```

---

## Preview generation

```python
class PreviewGenerator:
    def __init__(self):
        self._last_sent: dict[str, float] = {}
        self._interval = 1.0 / max(settings.preview_fps, 1)
    
    def maybe_send_preview(self, camera_id, frame):
        now = time.time()
        if now - self._last_sent.get(camera_id, 0) < self._interval:
            return
        
        self._last_sent[camera_id] = now
        
        import cv2
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        if not ok: return
        
        jpeg_bytes = buf.tobytes()
        captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        backend_client.send_frame_sync(camera_id, captured_at, jpeg_bytes)
```

JPEG q=70 → ~30KB per frame. 1 FPS per camera = 30KB/s = 240kbps. Negligible.

---

## Boot sync (load embeddings on startup)

```python
async def boot_sync_embeddings():
    try:
        r = httpx.get(
            f"{settings.backend_url}/internal/ai/embeddings",
            headers={"X-Internal-Token": settings.internal_token},
            timeout=30,
        )
        r.raise_for_status()
        embeddings = r.json()
        embedding_store.load_from_backend(embeddings)
        logger.info(f"Boot sync: loaded {len(embeddings)} embeddings")
    except Exception as e:
        logger.error(f"Boot sync failed: {e}")


async def boot_sync_security_cameras():
    """Get set of security camera IDs from backend.

    Used by recognition_pipeline.py to decide if a camera is a security
    camera (always report all faces) or attendance camera (only matched).
    """
    try:
        r = httpx.get(
            f"{settings.backend_url}/internal/ai/security-cameras",
            headers={"X-Internal-Token": settings.internal_token},
            timeout=10,
        )
        r.raise_for_status()
        ids = r.json()  # ["uuid-1", "uuid-2", ...]
        app_state.security_camera_ids = set(ids)
        logger.info(f"Boot sync: loaded {len(ids)} security camera IDs")
    except Exception as e:
        logger.error(f"Boot sync security cameras failed: {e}")
```

Called on `app.on_event("startup")` di `main.py`.

**Recurring refresh**: backend can push updates to AI when security cameras added/removed via `POST /internal/ai/security-cameras/sync` (sends new full set). AI updates `app_state.security_camera_ids` accordingly.

---

## Security camera pipeline (separate from attendance)

In `recognition_pipeline.py`:

```python
def is_security_camera(camera_id: str) -> bool:
    return camera_id in app_state.security_camera_ids

@staticmethod
def process_frame(camera_id, frame):
    preview_generator.maybe_send_preview(camera_id, frame)
    faces = face_detector.detect(frame)
    if not faces: return
    
    is_security = is_security_camera(camera_id)
    detections = []
    for face in faces:
        emb = face.embedding
        best_user_id, best_user_name, best_score = embedding_store.find_match_with_score(emb)
        is_known = best_score >= settings.confidence_threshold
        
        if not is_security:
            # Attendance: only matched faces
            if not is_known: continue
            detections.append({
                "face_known": True,
                "external_user_id": best_user_id,
                "confidence": best_score,
                "bounding_box": {...},
            })
        else:
            # Security: all faces, with snapshot
            snapshot = None if is_known else crop_and_encode_face(frame, face.bbox)
            detections.append({
                "face_known": is_known,
                "external_user_id": best_user_id if is_known else None,
                "confidence": best_score,
                "best_matched_user_id": best_user_id if not is_known else None,
                "best_matched_user_name": best_user_name if not is_known else None,
                "bounding_box": {...},
                "snapshot_base64": snapshot,
            })
    
    if not detections: return
    event = {"trace_id": ..., "camera_id": ..., "captured_at": ..., "detections": detections}
    asyncio.run(backend_client.send_recognition(event))
```

**Face crop helper** (`crop_and_encode_face`):
- Adds 20% padding around bbox
- Resizes to max 200x200
- Encodes JPEG q=80, base64 encoded
- Returns string (or None if encode fails)

Backend determines pipeline based on `security_cameras` table lookup (not mode). AI just sends ALL data — backend decides attendance vs security.

---

## Env

| Var | Required | Default | Example |
|---|---|---|---|
| `PORT` | no | `8000` | `8000` |
| `BACKEND_URL` | yes | — | `http://backend:4000` |
| `INTERNAL_TOKEN` | yes | — | `<same-as-backend>` |
| `RECOGNITION_CONFIDENCE_THRESHOLD` | no | `0.6` | `0.6` |
| `PREVIEW_FPS` | no | `1` | `1` |
| `RECONNECT_MAX_ATTEMPTS` | no | `5` | `5` |
| `RECONNECT_BACKOFF_MS` | no | `1000` | `1000` |

---

## Dockerfile

```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY pyproject.toml ./
RUN uv sync --no-cache --no-install-project

ENV PATH="/app/.venv/bin:$PATH"
COPY app/ ./app/

EXPOSE 8000

ENTRYPOINT ["uv", "run", "--directory", "/app", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Image size: ~1.5GB (InsightFace model + ONNX runtime + ffmpeg).

---

## Anti-pattern (JANGAN)

- ❌ Import DB library (psycopg, asyncpg, sqlalchemy, TypeORM) (P1)
- ❌ WebSocket ke browser (P2)
- ❌ Business rule logic (already_checked_in, on_leave, etc.) (P3)
- ❌ User CRUD (P4)
- ❌ `asyncio.run()` di dalam thread (use `requests` sync)
- ❌ `requests.post(content=...)` (use `data=`)
- ❌ Hardcoded RTSP path (use ONVIF GetStreamUri)
- ❌ Long blocking di FastAPI handler (use background tasks)

---

## Future improvements

- [ ] Reconnect logic dengan exponential backoff
- [ ] Health monitor (detect silent ffmpeg death)
- [ ] Camera status auto-recovery (force restart jika stale)
- [ ] GPU support (ONNX runtime GPU)
- [ ] WebSocket ke backend untuk push (instead of HTTP poll for embeddings)

---

## Next step

→ Baca [`05-nginx.md`](05-nginx.md).
