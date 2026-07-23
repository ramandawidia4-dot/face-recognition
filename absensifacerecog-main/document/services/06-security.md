# Service: Security (Server Room Access Alert)

> **Phase 6 module** — COMPLETELY SEPARATE from attendance. Own cameras table, own API, own WebSocket namespace.

---

## Tujuan

- Kamera di ruangan terbatas (server room) dipantau oleh sistem
- Wajah **known** → log info saja (siapa masuk jam berapa)
- Wajah **unknown** → ALERT ke admin (WebSocket + dashboard + Telegram webhook)
- Tidak ada check-in/check-out (itu urusan attendance module)
- **Sepenuhnya terpisah** dari modul attendance

---

## Kenapa modul terpisah (bukan `cameras.mode`)

| Attendance Module | Security Module |
|---|---|
| Table: `cameras` | Table: `security_cameras` |
| API: `/api/cameras/*` | API: `/api/security/*` |
| WS: `/realtime` | WS: `/security` |
| AI pipeline: report ONLY matched faces | AI pipeline: report ALL faces |
| Behavior pada known face: check-in | Behavior pada known face: info log |
| Behavior pada unknown face: silent drop | Behavior pada unknown face: alert |
| Snapshot JPEG: tidak disimpan | Snapshot JPEG: disimpan (face crop) |
| Frontend: `/admin/cameras` | Frontend: `/admin/security/cameras` + `/admin/security/alerts` |

**Reason**: attendance dan security memiliki business logic, lifecycle, API surface, storage retention, dan UX yang berbeda. Menaikkannya jadi modul terpisah jaga clean code (P4: single responsibility).

---

## Data model

### Table: `security_cameras`

```sql
CREATE TYPE security_camera_source AS ENUM ('onvif', 'rtsp', 'usb');

CREATE TABLE security_cameras (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    source          security_camera_source NOT NULL,
    rtsp_url        VARCHAR(500),
    usb_device_path VARCHAR(100),
    onvif_host      VARCHAR(100),
    onvif_port      INTEGER DEFAULT 80,
    onvif_username  VARCHAR(100),
    onvif_password  VARCHAR(100),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    location        VARCHAR(100),
    last_frame_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_security_cameras_name      ON security_cameras(name);
CREATE INDEX idx_security_cameras_source    ON security_cameras(source);
CREATE INDEX idx_security_cameras_is_active ON security_cameras(is_active);
```

**Required fields by source**:
- `rtsp` → `rtsp_url` required
- `onvif` → `onvif_host`, `onvif_port`, `onvif_username`, `onvif_password` required
- `usb` → `usb_device_path` required

### Table: `security_alerts`

```sql
CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');

CREATE TABLE security_alerts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    camera_id       UUID NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE,
    
    face_known      BOOLEAN NOT NULL,
    matched_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    confidence      REAL NOT NULL,
    bounding_box    JSONB NOT NULL,           -- {x, y, w, h}
    snapshot_jpeg   TEXT NOT NULL,            -- base64 face crop (max 200x200)
    
    severity        alert_severity NOT NULL,
    reviewed        BOOLEAN NOT NULL DEFAULT false,
    reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    notes           TEXT,
    
    captured_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_security_alerts_camera_id    ON security_alerts(camera_id);
CREATE INDEX idx_security_alerts_severity     ON security_alerts(severity);
CREATE INDEX idx_security_alerts_reviewed     ON security_alerts(reviewed);
CREATE INDEX idx_security_alerts_captured_at  ON security_alerts(captured_at DESC);
```

---

## Behavior per severity

| Severity | When | Action |
|---|---|---|
| `info` | Known face (confidence >= 0.6) | Log alert, no notification |
| `warning` | Unknown face, partial match (0.3-0.6) | Log alert + WS broadcast + dashboard badge |
| `critical` | Unknown face, zero matches (< 0.3) | Log alert + WS broadcast + Telegram/Discord webhook + modal popup + alarm sound |

**Thresholds**:
- `0.6+` → known
- `0.3-0.6` → partial (some similarity to someone)
- `< 0.3` → total stranger

---

## Data flow

### Flow A: Known face in security zone → info

```
1. AI detects face, compute embedding
2. cam_id is in security_camera_set → use security pipeline
3. find_match() → best_score = 0.94, user_id = X
4. face is known → no snapshot needed
5. AI: POST /internal/ai/recognition {
     detections: [{face_known: true, external_user_id: X, confidence: 0.94, bounding_box}]
   }
6. Backend: cam_id in security_cameras table
   → SecurityAlertService.processDetection()
   → INSERT security_alerts (severity=info, matched_user_id=X)
   → WS /security: security.alert {type: "known_access", severity: "info"}
7. No webhook
8. Frontend: add row to /admin/security/alerts (no popup)
```

### Flow B: Unknown face → warning or critical

```
1. AI detects face, embedding
2. cam_id in security_camera_set
3. find_match() → best_score = 0.34 (partial), or 0.12 (stranger)
4. face is unknown → crop face region, JPEG encode
5. AI: POST /internal/ai/recognition {
     detections: [{
       face_known: false, external_user_id: null,
       confidence: 0.34,
       best_matched_user_id: X, best_matched_name: "John",
       bounding_box, snapshot_base64
     }]
   }
6. Backend:
   → SecurityAlertService.processDetection()
   → calculate severity (>= 0.3 → warning, < 0.3 → critical)
   → INSERT security_alerts
   → WS /security: security.alert {type: "stranger", severity: "critical"}
   → Webhook sent (if severity >= WEBHOOK_MIN_SEVERITY)
7. Frontend: modal popup (critical) or toast notification (warning)
```

---

## API endpoints

### Security camera CRUD (`/api/security/cameras`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/security/cameras` | admin | List all security cameras |
| `POST` | `/api/security/cameras` | admin | Register new security camera |
| `GET` | `/api/security/cameras/{id}` | admin | Get single camera |
| `PATCH` | `/api/security/cameras/{id}` | admin | Update camera config |
| `DELETE` | `/api/security/cameras/{id}` | admin | Delete camera |

### Security camera control (idempotent)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/security/cameras/{id}/start` | admin | Start streaming |
| `POST` | `/api/security/cameras/{id}/stop` | admin | Stop streaming |
| `POST` | `/api/security/cameras/{id}/restart` | admin | Restart |
| `GET` | `/api/security/cameras/{id}/state` | any | Current state |
| `GET` | `/api/security/cameras/{id}/preview.jpg` | admin | Live preview (exempt from throttler) |

### Security alerts (`/api/security/alerts`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/security/alerts` | admin | List alerts (paginated, filterable) |
| `GET` | `/api/security/alerts/{id}` | admin | Get single alert (full snapshot) |
| `PATCH` | `/api/security/alerts/{id}/review` | admin | Mark as reviewed + notes |
| `GET` | `/api/security/alerts/stats` | admin | Count by severity, unreviewed count |

---

## WebSocket (namespace: `/security`)

Dedicated namespace — bukan `/realtime`.

### Events FROM server

#### `security.alert`
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
  "bounding_box": { "x": 120, "y": 80, "w": 200, "h": 240 },
  "snapshot_jpeg": "data:image/jpeg;base64,..." | "",
  "captured_at": "2026-07-23T14:30:00Z"
}
```

### Events FROM client

No client emit needed for now. Server broadcasts to all connected admin clients.

### Gateway implementation

```ts
@WebSocketGateway({
  namespace: '/security',
  cors: { origin: CORS_ORIGIN, credentials: true },
})
export class SecurityGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;
  
  private readonly logger = new Logger(SecurityGateway.name);
  
  handleConnection(client: Socket) {
    this.logger.log(`Security client connected: ${client.id}`);
  }
  
  broadcastAlert(event: WsSecurityAlertEvent) {
    this.server.emit('security.alert', event);
  }
}
```

---

## Backend module structure

```
src/modules/security/
├── security.module.ts
├── entities/
│   ├── security-camera.entity.ts      # NEW: SecurityCamera
│   └── security-alert.entity.ts       # NEW: SecurityAlert
├── services/
│   ├── security-camera.service.ts     # CRUD + delegation ke AI
│   ├── security-alert.service.ts      # processDetection + review
│   └── webhook.service.ts             # Telegram/Discord/Slack
├── controllers/
│   ├── security-camera.controller.ts  # /api/security/cameras/*
│   └── security-alert.controller.ts   # /api/security/alerts/*
├── gateways/
│   └── security.gateway.ts           # /security namespace
└── dto/
    ├── create-security-camera.dto.ts
    └── review-alert.dto.ts
```

### Entity: `security-camera.entity.ts`

```ts
export enum SecurityCameraSource {
  ONVIF = 'onvif',
  RTSP = 'rtsp',
  USB = 'usb',
}

@Entity('security_cameras')
export class SecurityCamera {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column({ type: 'enum', enum: SecurityCameraSource }) source: SecurityCameraSource;
  
  @Column({ nullable: true }) rtsp_url: string | null;
  @Column({ nullable: true }) usb_device_path: string | null;
  @Column({ nullable: true }) onvif_host: string | null;
  @Column({ nullable: true }) onvif_port: number | null;
  @Column({ nullable: true }) onvif_username: string | null;
  @Column({ nullable: true }) onvif_password: string | null;
  
  @Column({ default: true }) is_active: boolean;
  @Column({ nullable: true }) location: string | null;
  @Column({ nullable: true, type: 'timestamptz' }) last_frame_at: Date | null;
  
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
```

### Service: `security-camera.service.ts`

```ts
@Injectable()
export class SecurityCameraService {
  constructor(
    @InjectRepository(SecurityCamera) private repo: Repository<SecurityCamera>,
    private aiClient: AIClientService,
  ) {}
  
  async create(dto: CreateSecurityCameraDto): Promise<SecurityCamera> {
    return this.repo.save(dto);
  }
  
  async findAll(): Promise<SecurityCamera[]> {
    return this.repo.find({ order: { created_at: 'DESC' } });
  }
  
  async start(camera: SecurityCamera) {
    const payload = {
      rtsp_url: camera.rtsp_url,
      source: camera.source,
      onvif_host: camera.onvif_host,
      onvif_port: camera.onvif_port,
      onvif_username: camera.onvif_username,
      onvif_password: camera.onvif_password,
    };
    // Use same AI endpoint as attendance cameras — AI decides pipeline
    return this.aiClient.startCamera(camera.id, payload);
  }
  
  async stop(cameraId: string) {
    return this.aiClient.stopCamera(cameraId);
  }
}
```

### Service: `security-alert.service.ts`

```ts
@Injectable()
export class SecurityAlertService {
  constructor(
    @InjectRepository(SecurityAlert) private repo: Repository<SecurityAlert>,
    @InjectRepository(SecurityCamera) private camRepo: Repository<SecurityCamera>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private gateway: SecurityGateway,    // dedicated /security namespace
    private webhook: WebhookService,
  ) {}
  
  async processDetection(
    cameraId: string,
    detection: DetectionPayload,
    capturedAt: Date,
  ): Promise<SecurityAlert> {
    const severity = this.calculateSeverity(detection);
    const matchedUserId = detection.face_known 
      ? detection.external_user_id 
      : detection.best_matched_user_id;
    
    // Lookup matched user name
    let matchedUserName: string | null = null;
    if (matchedUserId) {
      const user = await this.userRepo.findOne({ where: { id: matchedUserId } });
      matchedUserName = user?.fullName ?? null;
    }
    
    // Save alert
    const alert = this.repo.create({
      camera_id: cameraId,
      face_known: detection.face_known,
      matched_user_id: matchedUserId,
      confidence: detection.confidence,
      bounding_box: detection.bounding_box,
      snapshot_jpeg: detection.snapshot_base64 ?? '',
      severity,
      captured_at: capturedAt,
    });
    await this.repo.save(alert);
    
    // Load camera name
    const camera = await this.camRepo.findOne({ where: { id: cameraId } });
    
    // WS broadcast on /security namespace
    this.gateway.broadcastAlert({
      alert_id: alert.id,
      camera_id: cameraId,
      camera_name: camera?.name ?? 'Unknown',
      type: detection.face_known ? 'known_access' : (detection.confidence >= 0.3 ? 'partial_match' : 'stranger'),
      severity,
      face_known: detection.face_known,
      matched_user_id: matchedUserId,
      matched_user_name: matchedUserName,
      confidence: detection.confidence,
      bounding_box: detection.bounding_box,
      snapshot_jpeg: detection.snapshot_base64 ?? '',
      captured_at: capturedAt.toISOString(),
    });
    
    // Webhook for warning/critical only
    if (severity !== 'info') {
      await this.webhook.sendAlert(alert, camera, matchedUserName);
    }
    
    return alert;
  }
  
  private calculateSeverity(d: DetectionPayload): AlertSeverity {
    if (d.face_known) return AlertSeverity.INFO;
    if (d.confidence >= 0.3) return AlertSeverity.WARNING;
    return AlertSeverity.CRITICAL;
  }
  
  async findAll(filter: SecurityFilterDto, page: number, limit: number) { ... }
  async findById(id: string) { ... }
  async markReviewed(id: string, adminId: string, notes?: string) { ... }
  async getStats() { ... }
}
```

### AI recognition service branching (in `ai-recognition.service.ts`)

```ts
async processRecognition(payload: RecognitionPayload) {
  // Check: is this a security camera? (different table from attendance)
  const isSecurity = await this.securityCameraRepo.exists({
    where: { id: payload.camera_id },
  });
  
  if (isSecurity) {
    const results = [];
    for (const det of payload.detections) {
      const alert = await this.securityAlertService.processDetection(
        payload.camera_id, det, new Date(payload.captured_at)
      );
      results.push({ alert_id: alert.id });
    }
    return { results };
  }
  
  // Attendance flow (existing logic)
  for (const det of payload.detections) {
    await this.processAttendanceDetection(payload.camera_id, det);
  }
}
```

---

## Webhook integration

Env vars (per provider):

```env
WEBHOOK_TELEGRAM_ENABLED=false
WEBHOOK_TELEGRAM_BOT_TOKEN=
WEBHOOK_TELEGRAM_CHAT_ID=
WEBHOOK_DISCORD_ENABLED=false
WEBHOOK_DISCORD_WEBHOOK_URL=
WEBHOOK_SLACK_ENABLED=false
WEBHOOK_SLACK_WEBHOOK_URL=
WEBHOOK_MIN_SEVERITY=critical    # only send to webhook for critical
```

### Telegram format (with photo)

```
🔴 SECURITY ALERT — CRITICAL
Camera: Server Room CCTV
Type: STRANGER DETECTED (0.18 confidence)
Time: 2026-07-23 14:30:00

[photo attached: face crop JPEG]
```

### Webhook service

```ts
@Injectable()
export class WebhookService {
  async sendAlert(alert: SecurityAlert, camera: SecurityCamera | null, matchedUserName: string | null) {
    const minSeverity = this.config.get('webhook.minSeverity', 'critical');
    if (!this.shouldSend(alert.severity, minSeverity)) return;
    
    const text = this.formatMessage(alert, camera, matchedUserName);
    
    // Fire and forget — don't block response
    Promise.allSettled([
      this.sendTelegram(text, alert.snapshot_jpeg),
      this.sendDiscord(text, alert.snapshot_jpeg),
      this.sendSlack(text),
    ]).then((results) => this.logFailures(results));
  }
}
```

---

## AI service changes

### Boot sync

Backend sends security camera IDs to AI on startup:

```http
GET /internal/ai/boot-sync
→ 200 {
  "embeddings": [...],
  "security_camera_ids": ["uuid-1", "uuid-2", ...]
}
```

AI stores in `app_state`:
```python
class AppState:
    security_camera_ids: set[str] = set()
```

### Recognition pipeline branch

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
            # Attendance behavior: only report matched faces
            if not is_known: continue
            detections.append({
                "face_known": True,
                "external_user_id": best_user_id,
                "confidence": best_score,
                "bounding_box": {...},
            })
        else:
            # Security behavior: report ALL faces
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
    
    event = {"trace_id": ..., "camera_id": camera_id, "captured_at": ..., "detections": detections}
    asyncio.run(backend_client.send_recognition(event))
```

### Face crop helper

```python
def crop_and_encode_face(frame, bbox, padding=0.2):
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    pad_w, pad_h = int((x2 - x1) * padding), int((y2 - y1) * padding)
    x1, y1 = max(0, x1 - pad_w), max(0, y1 - pad_h)
    x2, y2 = min(w, x2 + pad_w), min(h, y2 + pad_h)
    face_crop = frame[y1:y2, x1:x2]
    
    # Resize max 200x200 for storage
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

## Frontend changes

### New pages

| Path | Purpose |
|---|---|
| `/admin/security/cameras` | CRUD security cameras (separate form) |
| `/admin/security/alerts` | View + review alerts |

### Sidebar nav

```tsx
{
  title: 'Security',
  icon: ShieldAlert,
  url: '/admin/security/alerts',
  badge: unreviewedCount,  // from dedicated /security WS store
}
```

### Dedicated WS hook

```tsx
// useSecuritySocket.ts
import { io } from 'socket.io-client';

const securitySocket = io('/socket.io/', {
  path: '/socket.io',
  namespace: '/security',
  withCredentials: true,
});

export function useSecuritySocket() {
  return securitySocket;
}
```

### Critical alert modal

```tsx
function CriticalAlertListener() {
  const socket = useSecuritySocket();
  const [criticalAlert, setCriticalAlert] = useState(null);
  
  useEffect(() => {
    socket.on('security.alert', (alert) => {
      if (alert.severity === 'critical') {
        setCriticalAlert(alert);
        playAlarmSound();
        new Notification('SECURITY ALERT', {
          body: `Stranger detected at ${alert.camera_name}`,
          icon: `data:image/jpeg;base64,${alert.snapshot_jpeg}`,
        });
      }
    });
    return () => { socket.off('security.alert'); };
  }, []);
  
  if (!criticalAlert) return null;
  
  return (
    <Dialog open onOpenChange={() => setCriticalAlert(null)}>
      <DialogContent className="border-red-500 border-4 max-w-2xl">
        <DialogTitle>SECURITY ALERT</DialogTitle>
        <img src={`data:image/jpeg;base64,${criticalAlert.snapshot_jpeg}`} />
        <p>{criticalAlert.camera_name} — Stranger at {criticalAlert.captured_at}</p>
        <Button onClick={() => setCriticalAlert(null)}>Acknowledge</Button>
      </DialogContent>
    </Dialog>
  );
}
```

### Camera form

Security cameras dibuat via form terpisah di `/admin/security/cameras`, bukan via `mode` dropdown di kamera attendance.

---

## Migration

`backend/src/database/migrations/009_security_module.sql`:

```sql
-- 1. Security camera source enum
CREATE TYPE security_camera_source AS ENUM ('onvif', 'rtsp', 'usb');

-- 2. Security cameras table (separate from cameras)
CREATE TABLE security_cameras (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    source          security_camera_source NOT NULL,
    rtsp_url        VARCHAR(500),
    usb_device_path VARCHAR(100),
    onvif_host      VARCHAR(100),
    onvif_port      INTEGER DEFAULT 80,
    onvif_username  VARCHAR(100),
    onvif_password  VARCHAR(100),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    location        VARCHAR(100),
    last_frame_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_security_cameras_name ON security_cameras(name);
CREATE INDEX idx_security_cameras_is_active ON security_cameras(is_active);

-- 3. Alert severity enum
CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');

-- 4. Security alerts table
CREATE TABLE security_alerts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    camera_id       UUID NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE,
    face_known      BOOLEAN NOT NULL,
    matched_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    confidence      REAL NOT NULL,
    bounding_box    JSONB NOT NULL,
    snapshot_jpeg   TEXT NOT NULL,
    severity        alert_severity NOT NULL,
    reviewed        BOOLEAN NOT NULL DEFAULT false,
    reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    notes           TEXT,
    captured_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_security_alerts_camera_id ON security_alerts(camera_id);
CREATE INDEX idx_security_alerts_severity ON security_alerts(severity);
CREATE INDEX idx_security_alerts_reviewed ON security_alerts(reviewed);
CREATE INDEX idx_security_alerts_captured_at ON security_alerts(captured_at DESC);
```

---

## E2E test

```bash
# 1. Register security camera
curl -s -b "access_token=$TOKEN" \
  -X POST http://localhost/api/security/cameras \
  -d '{"name":"Server Room","source":"rtsp","rtsp_url":"rtsp://192.168.1.20:554/stream"}'

# 2. Start it
curl -s -b "access_token=$TOKEN" \
  -X POST http://localhost/api/security/cameras/{id}/start

# 3. Show registered face → info alert
curl /api/security/alerts
# Expected: severity=info, face_known=true

# 4. Show unregistered face → critical alert
curl /api/security/alerts
# Expected: severity=critical, face_known=false, snapshot_jpeg non-empty

# 5. Listen to WebSocket
wscat -c 'ws://localhost/socket.io/?EIO=4&transport=websocket' \
  -H 'Cookie: access_token=...'
# Send: '40/security,'  (connect to /security namespace)
# Expected: receive 'security.alert' event

# 6. Mark reviewed
curl -s -b "access_token=$TOKEN" \
  -X PATCH http://localhost/api/security/alerts/{id}/review \
  -d '{"notes":"Checked CCTV feed"}'
```

---

## Acceptance criteria

- Security cameras managed in `security_cameras` table (no `cameras.mode` column)
- Separate API at `/api/security/*` (not mixed with `/api/cameras`)
- Dedicated `/security` WebSocket namespace
- Security camera reports ALL faces (known + unknown)
- Unknown face → critical alert + webhook + modal popup
- Known face → info log only
- Admin can manage security cameras + review alerts
- Snapshot JPEG saved for review
- Telegram webhook sends critical alerts with photo

---

## Next step

→ Baca [`../05-spec.md`](../05-spec.md) §6.0.5 untuk overview Security Room di spec master.
→ Baca [`../api/07-endpoints-camera.md`](../api/07-endpoints-camera.md#security-room-module-phase-6) untuk detail endpoint.
→ Baca [`../planning/00-implementation-checklist.md`](../planning/00-implementation-checklist.md) Phase 6 untuk step-by-step coding.
