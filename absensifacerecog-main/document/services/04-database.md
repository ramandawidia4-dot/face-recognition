# Service: Database (PostgreSQL 16)

> 9 tables. ACID. Snake case. TypeORM entities mirror tables.

---

## Tujuan

Persistensi:
- User accounts + credentials
- Daily attendance records
- Leave requests
- Camera configurations
- Face embeddings (vector 512-dim)
- Audit logs (semua aksi admin)

---

## Tech

| | Version |
|---|---|
| PostgreSQL | 16-alpine |
| TypeORM | latest (di backend) |
| Naming strategy | `snake_case` (TypeORM SnakeNamingStrategy) |

---

## Schema overview

**9 tables** (7 attendance + 2 security), semua relasional, semua pakai UUID primary key:

```
users ─┬─ refresh_tokens (1:N)
       ├─ attendances (1:N)
       ├─ leaves (1:N, as requester)
       ├─ leaves (1:N, as approver, optional)
       ├─ face_embeddings (1:N)
       └─ audit_logs (1:N, as actor)

cameras            ──── (attendance cameras, no FK to attendances)
security_cameras   ─┬─ security_alerts (1:N)
                    └─ (alerts.matched_user_id → users)
```

**Security is a separate module**: `security_cameras` is its own table, not a `mode` column on `cameras`. See `06-security.md`.

```
users ─┬─ refresh_tokens (1:N)
       ├─ attendances (1:N)
       ├─ leaves (1:N, as requester)
       ├─ leaves (1:N, as approver, optional)
       ├─ face_embeddings (1:N)
       └─ audit_logs (1:N, as actor)

cameras ──── (no direct FK to attendances, but camera_id UUID referenced in AI service)
```

---

## Tables

### `users`

Karyawan + admin.

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(100) UNIQUE NOT NULL,
    username        VARCHAR(50) UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(100) NOT NULL,
    role            user_role NOT NULL DEFAULT 'employee',
    avatar_url      VARCHAR(255),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email    ON users(email);
CREATE INDEX idx_users_username ON users(username) WHERE username IS NOT NULL;
CREATE INDEX idx_users_role     ON users(role);
CREATE INDEX idx_users_is_active ON users(is_active);
```

**Enum**: `user_role = 'admin' | 'employee'`

**TypeORM entity**: `User` di `backend/src/modules/users/entities/user.entity.ts`

---

### `refresh_tokens`

JWT refresh token storage (hashed).

```sql
CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
```

**Flow**:
- User login → backend generate random UUID, hash with SHA-256, store `token_hash` + `expires_at`
- Cookie stores raw UUID
- Refresh → hash raw UUID, lookup `token_hash`, check not revoked + not expired
- Logout → mark `revoked = true`

**Security**: even if DB is leaked, attacker only sees SHA-256 hashes.

---

### `attendances`

Daily check-in / check-out.

```sql
CREATE TABLE attendances (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    check_in        TIMESTAMPTZ NOT NULL,
    check_out       TIMESTAMPTZ,
    status          attendance_status NOT NULL,
    check_in_photo  VARCHAR(255),
    check_out_photo VARCHAR(255),
    location_lat    DECIMAL(10, 8),
    location_lng    DECIMAL(11, 8),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, date)  -- one attendance per user per day
);

CREATE INDEX idx_attendances_user_id ON attendances(user_id);
CREATE INDEX idx_attendances_date    ON attendances(date);
CREATE INDEX idx_attendances_status  ON attendances(status);
```

**Enum**: `attendance_status = 'present' | 'late' | 'absent' | 'half_day'`

**Business rule** (di backend, bukan AI):
- `late` jika `check_in > 09:00`
- `half_day` jika `check_out < 14:00`
- `absent` jika ada row tapi `check_in IS NULL` (untuk manual absent oleh admin)

**Unique constraint**: 1 attendance per user per day. Backend handle ini dengan UPSERT pattern (kalau ada existing row, update `check_in`/`check_out` saja).

---

### `leaves`

Cuti/izin request.

```sql
CREATE TABLE leaves (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type         leave_type NOT NULL,
    start_date   DATE NOT NULL,
    end_date     DATE NOT NULL,
    reason       TEXT NOT NULL,
    status       leave_status NOT NULL DEFAULT 'pending',
    approved_by  UUID REFERENCES users(id),
    approved_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date)
);

CREATE INDEX idx_leaves_user_id  ON leaves(user_id);
CREATE INDEX idx_leaves_status   ON leaves(status);
CREATE INDEX idx_leaves_dates    ON leaves(start_date, end_date);
```

**Enums**:
- `leave_type = 'sick' | 'personal' | 'annual' | 'other'`
- `leave_status = 'pending' | 'approved' | 'rejected'`

**Business rule** (di backend, AI tidak tahu):
- Saat AI detect face, backend check: ada leave aktif untuk user+date? Kalau ya, action=`ignored`, reason=`on_leave`

---

### `audit_logs`

Semua aksi admin (CREATE, READ, UPDATE, DELETE, LOGIN, LOGOUT).

```sql
CREATE TABLE audit_logs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id),
    action       audit_action NOT NULL,
    resource     VARCHAR(50) NOT NULL,  -- e.g. 'user', 'camera', 'leave'
    resource_id  UUID,
    details      JSONB,                  -- before/after, IP, user agent, etc
    ip_address   INET,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id    ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource   ON audit_logs(resource, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```

**Enum**: `audit_action = 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT'`

**Implementation**: `AuditLogInterceptor` di backend, global, captures semua `@Post/@Patch/@Delete` handler. GET di-skip (terlalu noisy).

**Storage**: `details` JSONB untuk flexible schema. Contoh:
```json
{
  "before": {"name": "old", "email": "x@y.z"},
  "after": {"name": "new", "email": "x@y.z"},
  "changed_fields": ["name"]
}
```

---

### `cameras`

Konfigurasi kamera.

```sql
CREATE TABLE cameras (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name               VARCHAR(100) NOT NULL,
    source             camera_source NOT NULL,
    rtsp_url           VARCHAR(500),
    usb_device_path    VARCHAR(100),
    onvif_host         VARCHAR(100),
    onvif_port         INTEGER DEFAULT 80,
    onvif_username     VARCHAR(100),
    onvif_password     VARCHAR(100),
    is_active          BOOLEAN NOT NULL DEFAULT true,
    location           VARCHAR(100),
    last_frame_at      TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cameras_name      ON cameras(name);
CREATE INDEX idx_cameras_source    ON cameras(source);
CREATE INDEX idx_cameras_is_active ON cameras(is_active);
```

**Enum**: `camera_source = 'onvif' | 'rtsp' | 'usb'`

**Required fields by source**:
- `rtsp` → `rtsp_url` required
- `onvif` → `onvif_host`, `onvif_port`, `onvif_username`, `onvif_password` required
- `usb` → `usb_device_path` required

**Note**: `last_frame_at` untuk monitoring (kalau > 10s tanpa update → kamera offline).

---

### `face_embeddings`

Wajah terdaftar untuk recognition.

```sql
CREATE TABLE face_embeddings (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    embedding   REAL[] NOT NULL,        -- 512-dimensional float array
    version     INTEGER NOT NULL DEFAULT 1,
    photo_url   VARCHAR(255),            -- reference photo (untuk visual review)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id)  -- one embedding per user (latest version)
);

CREATE INDEX idx_face_embeddings_user_id  ON face_embeddings(user_id);
CREATE INDEX idx_face_embeddings_version  ON face_embeddings(version);
```

**Vector storage**:
- `REAL[]` (PostgreSQL native array)
- 512 dimensions (ArcFace standard)
- Cosine similarity computed in app (PostgreSQL `<=>` pgvector not used — overhead not worth it for our scale)

**Why REAL[] and not pgvector**:
- Our scale: ~100-1000 users, ~10 cameras
- pgvector adds extension dependency
- In-memory scan of 1000 embeddings takes < 1ms anyway
- If scale grows > 10k, switch to pgvector

**Versioning**:
- `version` field untuk future model migrations
- Bump version when re-registering all faces
- AI service filter by `version` to avoid stale embeddings

### `security_cameras`

Konfigurasi kamera untuk server room / ruangan terbatas. Completely separate from `cameras` (attendance).

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

CREATE INDEX idx_security_cameras_name ON security_cameras(name);
CREATE INDEX idx_security_cameras_is_active ON security_cameras(is_active);
```

**Required fields by source**: same as `cameras` (rtsp_url / onvif_* / usb_device_path).

### `security_alerts`

Log of every face detection on a security camera. Used for review + audit.

```sql
CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');

CREATE TABLE security_alerts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    camera_id       UUID NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE,
    face_known      BOOLEAN NOT NULL,
    matched_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    confidence      REAL NOT NULL,            -- best cosine similarity score
    bounding_box    JSONB NOT NULL,           -- {x, y, w, h}
    snapshot_jpeg   TEXT NOT NULL,            -- base64 face crop, max 200x200
    severity        alert_severity NOT NULL,  -- info | warning | critical
    reviewed        BOOLEAN NOT NULL DEFAULT false,
    reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    notes           TEXT,
    captured_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_security_alerts_camera_id   ON security_alerts(camera_id);
CREATE INDEX idx_security_alerts_severity    ON security_alerts(severity);
CREATE INDEX idx_security_alerts_reviewed    ON security_alerts(reviewed);
CREATE INDEX idx_security_alerts_captured_at ON security_alerts(captured_at DESC);
```

**Severity calculation** (in `SecurityAlertService`):
- `info` — face_known=true (registered user, just log)
- `warning` — face_known=false AND confidence >= 0.3 (partial match)
- `critical` — face_known=false AND confidence < 0.3 (no known matches, stranger)

**Cascade behavior**:
- Camera deleted → alerts deleted (CASCADE) — alert is meaningless without camera
- User deleted → matched_user_id SET NULL — preserve alert history, anonymize user

---

## Migrations

Numbered SQL files di `backend/src/database/migrations/`:

```
001_enums.sql
002_users.sql
003_attendances.sql
004_leaves.sql
005_audit_logs.sql
006_cameras.sql
007_face_embeddings_versioning.sql
008_security_module.sql    # NEW: security_cameras + security_alerts
```

**Strategy**:
- `synchronize: true` di dev (TypeORM auto-sync entities → DB)
- **Production WAJIB pakai migrations** (TypeORM CLI atau raw SQL files)
- Never destructive changes (always add columns, never drop in prod)

**Idempotent**:
- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `ALTER TABLE ADD COLUMN IF NOT EXISTS`

---

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- digest(), crypt()
```

---

## Enums

```sql
CREATE TYPE user_role              AS ENUM ('admin', 'employee');
CREATE TYPE attendance_status      AS ENUM ('present', 'late', 'absent', 'half_day');
CREATE TYPE leave_type             AS ENUM ('sick', 'personal', 'annual', 'other');
CREATE TYPE leave_status           AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE audit_action           AS ENUM ('CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT');
CREATE TYPE camera_source          AS ENUM ('onvif', 'rtsp', 'usb');
CREATE TYPE security_camera_source AS ENUM ('onvif', 'rtsp', 'usb');  -- NEW (Phase 6)
CREATE TYPE alert_severity         AS ENUM ('info', 'warning', 'critical');  -- NEW (Phase 6)
```

---

## Constraints & relationships

| Constraint | Purpose |
|---|---|
| `users.email UNIQUE` | No duplicate email |
| `users.username UNIQUE` (nullable) | No duplicate username |
| `refresh_tokens.user_id REFERENCES users(id) ON DELETE CASCADE` | Cleanup on user delete |
| `attendances.user_id REFERENCES users(id) ON DELETE CASCADE` | Cleanup on user delete |
| `attendances UNIQUE(user_id, date)` | One row per day |
| `leaves.user_id REFERENCES users(id) ON DELETE CASCADE` | Cleanup on user delete |
| `leaves.approved_by REFERENCES users(id)` (nullable, no CASCADE) | Preserve approval history |
| `leaves CHECK (end_date >= start_date)` | Date sanity |
| `face_embeddings.user_id REFERENCES users(id) ON DELETE CASCADE` | Cleanup on user delete |
| `face_embeddings UNIQUE(user_id)` | One face per user (latest version) |
| `audit_logs.user_id REFERENCES users(id)` (no CASCADE) | Preserve audit trail |

**Why some CASCADE and some not**:
- Personal data (attendances, leaves, embeddings): CASCADE (right to be forgotten)
- Audit logs: NO CASCADE (preserve trail even if user deleted — important for forensics)

---

## Backup strategy (TODO)

```bash
# Daily cron at 02:00
docker exec absen-postgres pg_dump -U absen_user absen | gzip > /backup/absen-$(date +%Y%m%d).sql.gz

# Retention: 30 days
find /backup -name "absen-*.sql.gz" -mtime +30 -delete
```

**Restore**:
```bash
zcat /backup/absen-20260723.sql.gz | docker exec -i absen-postgres psql -U absen_user -d absen
```

**Encryption**: GPG encrypt before offsite upload (rclone to S3/Backblaze).

---

## Performance considerations

- **Indexes**: every foreign key + frequently-queried column
- **Partitioning**: not needed for v1 (< 10k users). Reconsider at 1M rows
- **Connection pool**: TypeORM default 10 connections. Increase if needed
- **Read replica**: not needed for v1. Add later if dashboard slow
- **Materialized view**: not needed. If reports slow, add `mv_daily_attendance`

---

## Next step

→ Baca [`api/`](../api/) untuk HTTP + WebSocket contracts.
