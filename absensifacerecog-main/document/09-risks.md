# Risk Register

> Identified risks + mitigations. Update as project progresses.

---

## R1: Camera goes offline mid-recognition

**Severity**: Medium
**Likelihood**: High
**Impact**: Missed attendance for employees in that camera zone

**Mitigation**:
- Frontend shows `camera.frame_error: {error: "no_frame"}` after 10s
- Camera status badge shows "OFFLINE" instead of "RUNNING"
- Reconnect logic with exponential backoff (1s, 2s, 4s, 8s, 16s, 30s)
- Admin alert via Telegram/email (TODO)
- Employee can manual check-in via web (fallback)

**Status**: Partial — reconnect logic exists, alerts TODO

---

## R2: AI service crashes

**Severity**: High
**Likelihood**: Medium
**Impact**: No face recognition until restart

**Mitigation**:
- Docker `restart: unless-stopped` policy
- Health check `/health` every 30s
- UptimeRobot monitors `/health` from outside
- Frontend continues to show camera states (last known)
- Manual check-in fallback works (no AI needed)

**Status**: Mitigated by Docker restart policy

---

## R3: ONVIF camera returns wrong RTSP URI

**Severity**: Low
**Likelihood**: Medium
**Impact**: Some cameras fail to stream

**Mitigation**:
- Use ONVIF `GetStreamUri` (vendor-agnostic) instead of hardcoded paths
- Test multiple profile indices (0=main, 1=sub)
- Log resolved URI for debugging
- Fallback: manual RTSP URL in `PATCH /api/cameras/{id}`

**Status**: Mitigated by using ONVIF standard

---

## R4: ONVIF WS-Discovery doesn't work in container

**Severity**: Low
**Likelihood**: High (UDP multicast often blocked in Docker networks)
**Impact**: Admin must manually enter camera details

**Mitigation**:
- `POST /api/cameras/discover` is best-effort, doesn't fail if empty
- Admin can always add camera manually (POST /api/cameras)
- Future: run discovery from host (not container)

**Status**: Known limitation, manual fallback works

---

## R5: USB camera device passthrough

**Severity**: Low
**Likelihood**: High (Docker Desktop doesn't support USB)
**Impact**: USB cameras don't work

**Mitigation**:
- Document `devices:` in docker-compose.yml for Linux hosts
- Document `usbip` for Windows hosts
- ONVIF/RTSP cameras work without device passthrough
- Recommend IP cameras over USB

**Status**: Documented

---

## R6: Performance — InsightFace slow on CPU

**Severity**: Medium
**Likelihood**: High
**Impact**: Face recognition > 2s latency

**Mitigation**:
- Acceptable for low-traffic (1-2 FPS per camera = OK for 5-10 cameras)
- GPU support (ONNX runtime GPU) available, env-toggled
- Model `buffalo_l` is fastest (vs buffalo_s/m/x for higher accuracy)
- Reduce detection size: `det_size=(320, 320)` (vs 640x640)
- Run preview + recognition at 1 FPS, not full video FPS

**Status**: Acceptable for current scale, GPU available if needed

---

## R7: InsightFace model download on first run

**Severity**: Low
**Likelihood**: High (first run only)
**Impact**: First boot takes ~5-10 min downloading ~300MB

**Mitigation**:
- Volume mount `/root/.insightface` to host
- Or: bake model into Docker image (~1.5GB image, but instant first boot)
- Document first-boot wait time

**Status**: Mitigated by volume mount

---

## R8: Internal token leak via logs

**Severity**: High
**Likelihood**: Low
**Impact**: Service-to-service auth bypass

**Mitigation**:
- Filter logger to mask `X-Internal-Token` header in all logs
- Don't log request body verbatim (might contain token)
- Use helmet (security headers)
- Rotate `INTERNAL_TOKEN` regularly (TODO: automation)

**Status**: Partial — manual filtering needed

---

## R9: Race condition — 2 detections concurrent

**Severity**: Medium
**Likelihood**: Medium
**Impact**: Double check-in, missed check-in, or duplicate attendances

**Mitigation**:
- DB-level UNIQUE constraint on `attendances(user_id, date)` — prevents duplicates
- UPSERT pattern in backend (single SQL statement)
- Per-user lock during create (TODO: use Redis or in-memory lock)
- WebSocket broadcasts go to all clients, but each is idempotent

**Status**: DB constraint prevents corruption

---

## R10: Camera config drift between NestJS DB and Python memory

**Severity**: Medium
**Likelihood**: Medium
**Impact**: AI service runs with stale config

**Mitigation**:
- Backend is single source of truth (DB)
- All changes push to AI via `POST /internal/ai/cameras/{id}/reload` (per P8)
- AI service reloads config on each request, not from cache
- Boot sync: AI loads fresh embeddings from backend on startup
- (TODO) Periodic health check: compare DB config vs AI in-memory

**Status**: Push-only by design

---

## R11: Memory leak in AI service over long uptime

**Severity**: Medium
**Likelihood**: Medium
**Impact**: OOM after days/weeks

**Mitigation**:
- Each camera has dedicated thread (bounded, not growing)
- Embedding store loads once on boot (fixed size)
- Preview cache bounded (TTL 10s expires entries)
- Use `lru_cache` where appropriate
- Restart service weekly (TODO: cron or watchdog)

**Status**: Bounded, but no automated restart

---

## R12: False positive — wrong person matched

**Severity**: High
**Likelihood**: Low (with good threshold)
**Impact**: Someone else's attendance recorded

**Mitigation**:
- `RECOGNITION_CONFIDENCE_THRESHOLD=0.6` (tunable)
- Defense in depth: backend also checks threshold
- Per-user cooldown (60s) prevents rapid repeat
- Audit log allows forensics
- Manual override by admin (delete attendance row, re-mark)

**Status**: Mitigated by threshold

---

## R13: Reconnect loop without backoff

**Severity**: Medium
**Likelihood**: High
**Impact**: CPU/network overload

**Mitigation**:
- Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
- Max attempts: 5 (configurable)
- After max → state = ERROR, requires admin intervention
- Admin notified (TODO)

**Status**: Backoff implemented

---

## R14: Database corruption (power loss, etc)

**Severity**: High
**Likelihood**: Low
**Impact**: Data loss

**Mitigation**:
- PostgreSQL ACID (no partial writes)
- Daily backup automation (Phase 2)
- WAL archiving (TODO: continuous backup to S3)
- UPSERT pattern in app (recoverable from inconsistency)
- Test restore monthly (TODO)

**Status**: Backup automation TODO

---

## R15: WebSocket disconnects for many clients

**Severity**: Medium
**Likelihood**: Medium
**Impact**: Real-time updates missed

**Mitigation**:
- Socket.IO client auto-reconnect (exponential backoff)
- Re-emit `watch(cameraId)` after reconnect
- Frontend falls back to HTTP polling for preview
- Server can scale horizontally with Redis adapter (Phase 4)

**Status**: Auto-reconnect works

---

## R16: Time zone bugs

**Severity**: Medium
**Likelihood**: Medium
**Impact**: Wrong attendance times

**Mitigation**:
- All timestamps stored as `timestamptz` (UTC in DB, displayed in local TZ)
- Backend uses `new Date()` (JS Date, always UTC internally)
- Frontend uses `toLocaleString()` (respects user TZ)
- Server TZ: UTC (set in Dockerfile: `ENV TZ=UTC`)
- Docker: `TZ=UTC` env var

**Status**: Use `timestamptz` everywhere

---

## R17: Network congestion (frame flood)

**Severity**: Medium
**Likelihood**: Medium
**Impact**: Backend overload, preview lag

**Mitigation**:
- Backend throttle WS broadcast to 3 FPS (multiple cameras = multiplexed)
- AI service `PREVIEW_FPS=1` (single frame per camera per second)
- JPEG quality 70 (~30KB/frame)
- 10 cameras * 30KB/s = 300KB/s, well within LAN capacity

**Status**: Mitigated

---

## R18: Secret rotation downtime

**Severity**: Low
**Likelihood**: Low
**Impact**: Re-login required for all users

**Mitigation**:
- JWT keys rotation: 2 keys active (old + new), overlap period 24h
- `INTERNAL_TOKEN` rotation: 2 tokens active, overlap period
- `JWT_ACCESS_EXPIRY=900` (15 min) means user re-login is brief

**Status**: Manual rotation possible

---

## R19: NUC hardware failure

**Severity**: High
**Likelihood**: Low
**Impact**: Complete system down

**Mitigation**:
- Daily backup to offsite (S3) — restore on new hardware
- Document: "Buy replacement NUC, install Docker, restore DB"
- RTO: ~2 hours (procure + setup + restore)

**Status**: Backup is critical

---

## R20: Compliance — biometric data privacy

**Severity**: High (legal)
**Likelihood**: Medium
**Impact**: Legal liability (GDPR, Indonesian UU PDP)

**Mitigation**:
- Face embeddings stored as numbers, NOT photos
- Photo reference stored only for admin review (separate `photo_url` field, optional)
- Encryption at rest (TODO: enable PostgreSQL TDE)
- Audit log of all face data access
- Employee consent form before registration (TODO)
- Right to deletion: `DELETE /api/cameras/faces/{userId}` removes all data

**Status**: Partial — legal review needed

---

## R21: Security room has false alarm (known person misidentified)

**Severity**: Medium
**Likelihood**: Low (high threshold 0.3 for warning, 0.6 for known)
**Impact**: Alert spam, admin alert fatigue

**Mitigation**:
- 3 severity levels (info/warning/critical) — only critical triggers modal + webhook
- Admin can mark as reviewed + add notes (no auto-resolve)
- Thresholds tunable via env (`RECOGNITION_CONFIDENCE_THRESHOLD`)
- Telegram webhook configurable: only fires for critical by default
- If too many false positives in practice: raise threshold to 0.4 or 0.5

**Status**: Mitigated by severity tiering

## R22: Webhook provider down (Telegram/Discord/Slack outage)

**Severity**: Low
**Likelihood**: Low
**Impact**: Critical alerts not sent to admin's phone

**Mitigation**:
- Fire-and-forget (don't block UI)
- Webhook failures logged but don't retry (avoid duplicate alerts)
- Multiple providers supported (can enable all 3)
- WS broadcast to browser still works as fallback
- Critical alert modal in browser still shows even if webhook fails
- `WEBHOOK_TELEGRAM_BOT_TOKEN` rotates — no data loss

**Status**: Multi-channel fallback already implemented

## R23: AI service misses security camera update (stale set)

**Severity**: Medium
**Likelihood**: Medium
**Impact**: New security camera registered, but AI service doesn't know → still uses attendance flow → unknown face not alerted

**Mitigation**:
- Backend pushes `POST /internal/ai/security-cameras/sync` whenever admin adds/removes security camera
- AI service updates `app_state.security_camera_ids` set
- Periodic re-fetch: every 5 min (TODO) + on boot
- If sync fails: AI logs error, admin sees stale state in UI
- Critical: AI service restart triggers fresh boot sync (always pulls latest)

**Status**: Push sync on add/remove, periodic refresh TODO

## R24: Snapshot JPEG storage growth (unbounded)

**Severity**: Medium
**Likelihood**: High (each critical alert = ~30KB, daily growth)
**Impact**: DB size growth, slow queries

**Mitigation**:
- Snapshot only 200x200 max (q=80 JPEG, ~10-30KB per image)
- Partition by month: `security_alerts_2026_07`, `_2026_08`, etc. (TODO)
- Auto-delete alerts older than 90 days (cron, TODO)
- For longer retention: archive to S3 cold storage
- Add index on `created_at DESC` for cleanup queries

**Status**: Mitigated by small snapshot size, partition TODO

---

## Risk priority matrix

```
Severity →     Low             Medium            High
─────────────────────────────────────────────────────
Likelihood
│
High          R5, R4, R7,    R1, R13, R16,    R20
│             R24             R17, R11, R23
│
Medium        R3, R6, R22    R2, R8, R9,     R12
│                            R10, R15, R21
│
Low           R18           R14, R19
```

**Top 5 risks to address first**:
1. R1 (Camera offline) — needs auto-recovery + alert
2. R2 (AI service crash) — restart policy OK, add monitoring
3. R20 (Compliance) — needs legal review
4. R23 (Stale security camera set) — needs periodic re-sync
5. R12 (False positive) — already mitigated, monitor

---

## Next step

→ Lihat [`00-readme.md`](00-readme.md) untuk navigasi lengkap.
