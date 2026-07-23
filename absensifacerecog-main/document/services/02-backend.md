# Service: Backend (NestJS 10)

> Single source of truth untuk DB + WS gateway. Business logic, auth, camera orchestration.

---

## Tujuan

- **Satu-satunya** yang akses PostgreSQL (P1)
- **Satu-satunya** yang kirim event ke browser via WebSocket (P2)
- Auth (JWT, identifier = email/username)
- Business rules (attendance, leave, threshold)
- HTTP client ke AI service (delegasi camera control)
- Preview cache (10s TTL, 640x480 JPEG)
- Default admin seeder on first boot

---

## Tech

| | Version |
|---|---|
| NestJS | 10.x |
| TypeScript | 5.x |
| TypeORM | latest |
| PostgreSQL driver | pg 8.x |
| Socket.IO | 4.x |
| @nestjs/jwt | 10.x |
| @nestjs/throttler | 6.x |
| @nestjs/axios | 4.x |
| helmet | 8.x |
| bcrypt | 5.x |
| class-validator | 0.14.x |
| cookie-parser | 1.4.x |

---

## Modul (target)

```
src/
├── main.ts                              # bootstrap, raw body parser, helmet, CORS
├── app.module.ts                        # root module
│
├── config/
│   ├── database.config.ts               # DATABASE_URL
│   ├── jwt.config.ts                    # RS256 keys
│   ├── app.config.ts                    # port, CORS_ORIGIN
│   ├── ai.config.ts                     # AI_SERVICE_URL, INTERNAL_TOKEN
│   └── seed.config.ts                   # SEED_ADMIN_*
│
├── common/
│   ├── guards/
│   │   ├── jwt-auth.guard.ts            # validate access_token cookie
│   │   ├── roles.guard.ts               # admin/employee
│   │   └── internal-token.guard.ts      # X-Internal-Token
│   ├── decorators/
│   │   ├── public.decorator.ts          # @Public() skip JWT
│   │   ├── roles.decorator.ts           # @Roles('admin')
│   │   └── current-user.decorator.ts   # @CurrentUser() inject user
│   ├── filters/
│   │   └── http-exception.filter.ts     # uniform error response
│   ├── interceptors/
│   │   └── audit-log.interceptor.ts     # log all mutations
│   ├── pipes/
│   │   └── sanitize.pipe.ts             # strip XSS
│   └── ai/
│       ├── ai.module.ts                 # global AI client
│       ├── ai-client.service.ts         # HTTP to AI
│       ├── face-embedding.service.ts    # CRUD embeddings
│       ├── camera-fsm.service.ts        # state machine
│       └── preview.service.ts           # 10s TTL cache
│
├── database/
│   └── migrations/                      # numbered SQL files
│
└── modules/
    ├── auth/                           # /api/auth/*
    ├── users/                          # /api/users/*
    ├── attendance/                     # /api/attendance/*
    ├── leave/                          # /api/leaves/*
    ├── audit-log/                      # internal
    ├── camera/                         # /api/cameras/* (attendance)
    ├── security/                       # /api/security/* (server room) — NEW
    │   ├── security.module.ts
    │   ├── entities/
    │   │   ├── security-camera.entity.ts
    │   │   └── security-alert.entity.ts
    │   ├── services/
    │   │   ├── security-camera.service.ts
    │   │   ├── security-alert.service.ts
    │   │   └── webhook.service.ts       # Telegram/Discord/Slack
    │   ├── controllers/
    │   │   ├── security-camera.controller.ts
    │   │   └── security-alert.controller.ts
    │   └── gateways/
    │       └── security.gateway.ts     # WS /security namespace
    └── internal/                       # /internal/ai/* (callback)
```

---

## Database schema (target)

9 tables (lihat detail di `04-database.md`):

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Karyawan + admin | id, email (unique), username (unique, nullable), password_hash, full_name, role, is_active |
| `refresh_tokens` | JWT refresh storage | user_id, token_hash, expires_at, revoked |
| `attendances` | Check-in/out harian | user_id, date, check_in, check_out, status |
| `leaves` | Cuti/izin request | user_id, type, start_date, end_date, status |
| `audit_logs` | Semua aksi admin | user_id, action, resource, resource_id, details (JSON) |
| `cameras` | Konfigurasi kamera | name, source, rtsp_url, onvif_host, is_active, last_frame_at |
| `face_embeddings` | Wajah terdaftar | user_id, embedding (float[]), version, photo_url |

Migrations: numbered SQL files di `src/database/migrations/`.

---

## API endpoints (target)

### Auth (`/api/auth/*`)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/register` | `{email, username?, password, full_name}` | `{success, data: {id, email, username, full_name, role}}` |
| POST | `/login` | `{identifier, password}` | Sets cookies, `{success, data: {user, access_token_expires_in}}` |
| POST | `/refresh` | (cookie) | New cookies |
| POST | `/logout` | (cookie) | `{success}` |
| GET | `/me` | (JWT) | `{success, data: {id, email, username, full_name, role}}` |

### Users (`/api/users/*`) — admin only
- GET `/` (list + pagination)
- GET `/{id}`
- POST `/` (create)
- PATCH `/{id}`
- DELETE `/{id}` (soft delete)

### Attendance (`/api/attendance/*`)
- POST `/check-in` (JWT)
- POST `/check-out` (JWT)
- GET `/?from=&to=&page=&limit=` (JWT)
- GET `/today` (JWT)
- GET `/all?from=&to=&user_id=&status=` (admin)

### Leave (`/api/leaves/*`)
- POST `/` (JWT)
- GET `/`
- GET `/all`
- PATCH `/{id}` (admin: approve/reject)

### Camera (`/api/cameras/*`) — admin only
- GET `/` (list)
- POST `/` (create)
- PATCH `/{id}`
- DELETE `/{id}`
- GET `/{id}/preview.jpg` (live preview, JWT)
- POST `/{id}/start` (idempotent)
- POST `/{id}/stop` (idempotent)
- POST `/{id}/restart` (idempotent)
- POST `/{id}/reconnect` (idempotent)
- GET `/{id}/state`
- GET `/sources`
- GET `/usb/devices`
- POST `/discover` (ONVIF WS-Discovery)

### Face registration (`/api/cameras/faces/*`) — admin only
- POST `/{userId}` (register)
- GET `/{userId}`
- DELETE `/{userId}`

### Internal (`/internal/ai/*`) — `X-Internal-Token` only
- GET `/embeddings`
- POST `/recognition` (callback)
- POST `/frame` (binary JPEG, callback)
- POST `/state-change` (callback)

### Security (server room, `/api/security/*`) — admin only

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/security/cameras` | List security cameras (separate from attendance `cameras` table) |
| `POST` | `/api/security/cameras` | Register new security camera |
| `GET` | `/api/security/cameras/{id}` | Get single camera |
| `PATCH` | `/api/security/cameras/{id}` | Update config (push to AI) |
| `DELETE` | `/api/security/cameras/{id}` | Delete camera + stop pipeline |
| `POST` | `/api/security/cameras/{id}/start` | Idempotent start (delegates to AI) |
| `POST` | `/api/security/cameras/{id}/stop` | Idempotent stop |
| `POST` | `/api/security/cameras/{id}/restart` | Idempotent restart |
| `GET` | `/api/security/cameras/{id}/state` | Current FSM state |
| `GET` | `/api/security/cameras/{id}/preview.jpg` | Live preview (exempt from throttler) |
| `GET` | `/api/security/alerts` | List alerts (paginated, filter by camera/severity/reviewed) |
| `GET` | `/api/security/alerts/stats` | Count by severity + unreviewed count |
| `GET` | `/api/security/alerts/{id}` | Get single alert (with snapshot_jpeg) |
| `PATCH` | `/api/security/alerts/{id}/review` | Mark as reviewed (with notes) |

**Note**: security cameras are **completely separate** from attendance cameras (different table, different controller, different gateway). See `services/06-security.md` for full design.

### WebSocket namespaces
- `/realtime` — JWT cookie auth
  - `attendance.created`, `attendance.updated`
  - `camera.status`, `camera.registered`, `camera.deleted`
- `/preview` — JWT cookie auth
  - `camera.frame`, `camera.frame_error`
  - Client emits `watch(cameraId)` / `unwatch(cameraId)`
- `/security` — JWT cookie auth (admin only)
  - `security.alert` (camera_name, severity, snapshot_base64, matched_user_id, confidence, bounding_box)
  - Broadcast by `SecurityGateway` whenever `SecurityAlertService.processDetection()` runs

---

## Auth implementation

### Login flow
```
POST /api/auth/login { identifier, password }
1. @Public() — skip JwtAuthGuard
2. SanitizePipe — strip XSS
3. AuthService.login(identifier, password)
   a. Identifier detection:
      - contains '@' → find by email
      - else → find by username
   b. user.isActive check
   c. bcrypt.compare(password, user.passwordHash)
   d. Generate tokens (RS256 JWT)
   e. Save refresh token hash in DB
4. Set cookies via @Res():
   - access_token: HttpOnly, SameSite=Strict, Path=/, Max-Age=900
   - refresh_token: HttpOnly, SameSite=Strict, Path=/api/auth, Max-Age=604800
5. Return { user, access_token_expires_in }
```

### JWT keys
- `JWT_PRIVATE_KEY_PATH=/app/keys/private.pem` (sign)
- `JWT_PUBLIC_KEY_PATH=/app/keys/public.pem` (verify)
- Generated once via `cryptography` (2048-bit RSA)
- Mounted to backend container as volume or baked in

### Guards order
```
Request → JwtAuthGuard (skip if @Public) → RolesGuard (skip if @Public) → Handler
```

### Auto-refresh
- Frontend `axios` interceptor handles 401
- Calls `/api/auth/refresh` (cookie-based)
- Retries original request

---

## Preview cache

```ts
class PreviewService {
  private cache: Map<cameraId, PreviewEntry> = new Map();
  private timers: Map<cameraId, NodeJS.Timeout> = new Map();
  private lastBroadcast: Map<cameraId, number> = new Map();
  private ttlMs = 10000;

  set(cameraId, frame: Buffer) {
    this.cache.set(cameraId, { frame, capturedAt: new Date(), size: frame.length });
    
    // WS broadcast throttle to 3 FPS
    const now = Date.now();
    const last = this.lastBroadcast.get(cameraId) || 0;
    if (now - last >= 333) {
      this.lastBroadcast.set(cameraId, now);
      this.gateway.broadcastFrame(cameraId, frame.toString('base64'), new Date().toISOString());
    }
    
    // TTL: 10s
    setTimeout(() => {
      this.cache.delete(cameraId);
      this.gateway.broadcastFrameError(cameraId, 'no_frame');
    }, ttlMs);
  }

  get(cameraId): PreviewEntry | undefined {
    return this.cache.get(cameraId);
  }
}
```

**HTTP endpoint** (`@SkipThrottle()`):
```ts
@Get(':id/preview.jpg')
async getPreview(@Param('id') id, @Res() res) {
  const entry = this.previewService.get(id);
  if (!entry) {
    return res.status(404).json({ success: false, error: { code: 'NO_FRAME' } });
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Length', entry.size);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Captured-At', entry.capturedAt.toISOString());
  res.send(entry.frame);
}
```

---

## Camera FSM

States: `STOPPED | CONNECTING | RUNNING | STOPPING | RECONNECTING | ERROR`

```ts
class CameraFsmService {
  private states: Map<cameraId, CameraEntry> = new Map();

  transition(cameraId, newState, error?) {
    const entry = this.states.get(cameraId) || { state: 'STOPPED', error: null, updatedAt: Date.now() };
    // ... validation, audit log
    entry.state = newState;
    entry.error = error;
    entry.updatedAt = Date.now();
    this.states.set(cameraId, entry);
    
    // Broadcast to /realtime WS
    this.attendanceGateway.broadcastCameraStatus({ camera_id, state, error });
  }
}
```

State diagram di `services/03-ai-service.md`.

---

## AI client (delegation)

```ts
class AIClientService {
  async startCamera(cameraId, config: CameraStartPayload) {
    return this.client.post(`/internal/ai/cameras/${cameraId}/start`, config);
  }
  // ... stopCamera, restartCamera, reloadCamera, reconnectCamera
  // ... registerFace, syncEmbedding, getEmbeddings
  // ... discover, listUsbDevices
}
```

When source = `onvif`:
```ts
const payload = {
  rtsp_url: null,  // AI will resolve
  source: 'onvif',
  onvif_host: camera.onvifHost,
  onvif_port: camera.onvifPort,
  onvif_username: camera.onvifUsername,
  onvif_password: camera.onvifPassword,
  onvif_profile_index: 0,
};
```

---

## Admin seeder (on first boot)

```ts
@Injectable()
export class UsersSeeder implements OnApplicationBootstrap {
  async onApplicationBootstrap() {
    if (this.config.get('app.nodeEnv') === 'test') return;
    
    const adminEmail = this.config.get('seed.adminEmail', 'admin@absenface.local');
    const adminUsername = this.config.get('seed.adminUsername', 'admin');
    const adminPassword = this.config.get('seed.adminPassword', 'Admin@1234');
    
    const existing = await this.usersRepository.findOne({
      where: [{ email: adminEmail }, { username: adminUsername }],
    });
    
    if (existing) {
      this.logger.log(`[seed] Admin exists, skip.`);
      return;
    }
    
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await this.usersRepository.save({
      email: adminEmail,
      username: adminUsername,
      passwordHash,
      fullName: this.config.get('seed.adminFullName', 'System Administrator'),
      role: UserRole.ADMIN,
      isActive: true,
    });
    
    this.logger.log(`[seed] Admin created.`);
  }
}
```

**Idempotent**: runs every boot, checks for existing first.

---

## Body parser (binary frame)

NestJS by default parses JSON. For binary frame, need to disable + custom:

```ts
// main.ts
const app = await NestFactory.create(AppModule, { bodyParser: false });
const express = app.getHttpAdapter().getInstance();

express.use((req, res, next) => {
  if (req.path === '/internal/ai/frame' && req.method === 'POST') {
    raw({ type: () => true, limit: '10mb' })(req, res, next);
  } else {
    json({ limit: '1mb' })(req, res, () => {
      urlencoded({ extended: true, limit: '1mb' })(req, res, next);
    });
  }
});
```

---

## Throttling

```ts
ThrottlerModule.forRoot([{
  ttl: 60000,  // 1 minute
  limit: 100,  // 100 req/min per IP
}]),
```

**Exemptions**:
- `/internal/ai/*` (no throttler)
- `/api/cameras/:id/preview.jpg` (`@SkipThrottle()` — high-frequency polling)
- `/api/auth/refresh` (auto-refresh on 401)
- `/health` (Docker healthcheck)

---

## Env

| Var | Required | Example |
|---|---|---|
| `PORT` | no | `4000` |
| `NODE_ENV` | yes | `production` |
| `DATABASE_URL` | yes | `postgresql://user:pass@postgres:5432/absen` |
| `JWT_PRIVATE_KEY_PATH` | yes | `/app/keys/private.pem` |
| `JWT_PUBLIC_KEY_PATH` | yes | `/app/keys/public.pem` |
| `JWT_ACCESS_EXPIRY` | no | `900` (15m) |
| `JWT_REFRESH_EXPIRY` | no | `604800` (7d) |
| `CORS_ORIGIN` | yes | `http://localhost` |
| `AI_SERVICE_URL` | yes | `http://ai:8000` |
| `INTERNAL_TOKEN` | yes | `<random-32+chars>` |
| `THROTTLE_TTL` | no | `60` |
| `THROTTLE_LIMIT` | no | `100` |
| `SEED_ADMIN_EMAIL` | no | `admin@absenface.local` |
| `SEED_ADMIN_USERNAME` | no | `admin` |
| `SEED_ADMIN_PASSWORD` | no | `Admin@1234` |
| `SEED_ADMIN_FULL_NAME` | no | `System Administrator` |
| `WEBHOOK_TELEGRAM_ENABLED` | no | `false` |
| `WEBHOOK_TELEGRAM_BOT_TOKEN` | no | `<bot-token>` |
| `WEBHOOK_TELEGRAM_CHAT_ID` | no | `<chat-id>` |
| `WEBHOOK_DISCORD_ENABLED` | no | `false` |
| `WEBHOOK_DISCORD_WEBHOOK_URL` | no | `<discord-webhook-url>` |
| `WEBHOOK_SLACK_ENABLED` | no | `false` |
| `WEBHOOK_SLACK_WEBHOOK_URL` | no | `<slack-webhook-url>` |
| `WEBHOOK_MIN_SEVERITY` | no | `critical` (only this+ go to webhook) |

---

## Anti-pattern (JANGAN)

- ❌ Spawn ffmpeg (P4 — AI's job)
- ❌ Load ONNX model (P4 — AI's job)
- ❌ Query camera state from AI (push only, P8)
- ❌ WebSocket connection ke camera (no WS for camera control)
- ❌ Long-running sync work di controller (use queue/BullMQ if needed)
- ❌ Bypass throttler globally (only exempt specific routes)
- ❌ Log password, token, atau JWT

---

## Next step

→ Baca [`03-ai-service.md`](03-ai-service.md).
