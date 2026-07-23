## Phase 6 — Security Module (Day 26-30)

> Server room access monitoring — COMPLETELY SEPARATE module from attendance.
> Detail lengkap di `services/06-security.md`.

### Phase 6.1 — Database (Day 26)

- [ ] Step 45: Migration `009_security_module.sql` — create `security_cameras` table + `security_alerts` table + indexes
- [ ] Step 46: TypeORM entities `SecurityCamera` + `SecurityAlert` (no changes to `Camera` entity)
- [ ] Verify: `psql -c "\d security_cameras"`, `psql -c "\d security_alerts"`

### Phase 6.2 — Backend security module (Day 26-27)

- [ ] Step 47: `src/modules/security/security.module.ts` — register entities + services + controller + gateway
- [ ] Step 48: `security-alert.service.ts` — processDetection (calculate severity, save alert)
- [ ] Step 49: `security-camera.service.ts` — CRUD for security_cameras + delegate to AI
- [ ] Step 50: `security-alert.controller.ts` — GET list/stats/:id, PATCH :id/review
- [ ] Step 51: `security-camera.controller.ts` — POST/GET/PATCH/DELETE for `/api/security/cameras/*`
- [ ] Step 52: `webhook.service.ts` — Telegram/Discord/Slack sender (httpx + photo)
- [ ] Step 53: Create `src/modules/security/gateways/security.gateway.ts` — `/security` namespace with `broadcastAlert()`
- [ ] Step 54: `ai-recognition.service.ts` — check if `camera_id` exists in `security_cameras` table; if yes → security pipeline, else → attendance
- [ ] Step 55: Update `internal.controller.ts` schema to accept `face_known`, `snapshot_base64`, `best_matched_*`
- [ ] Step 56: Env vars in `.env` (WEBHOOK_TELEGRAM_*, WEBHOOK_DISCORD_*, WEBHOOK_SLACK_*, WEBHOOK_MIN_SEVERITY)
- [ ] Verify: `curl /api/security/cameras` returns 200, `curl /api/security/alerts` returns 200

### Phase 6.3 — AI service dual pipeline (Day 28)

- [ ] Step 57: `models/schemas.py` — add `face_known`, `snapshot_base64`, `best_matched_*` to Detection
- [ ] Step 58: `embedding_store.py` — add `find_match_with_score()` returning best score even if < threshold
- [ ] Step 59: `services/recognition_pipeline.py` — check `camera_id in security_camera_ids` set. Security cam → report ALL faces with snapshot; attendance cam → existing behavior
- [ ] Step 60: `crop_and_encode_face(frame, bbox)` helper — crop with 20% padding, resize max 200x200, JPEG q=80
- [ ] Step 61: Boot sync update: backend sends `security_camera_ids` via `GET /internal/ai/boot-sync`. AI stores in `app_state.security_camera_ids: Set[str]`
- [ ] Step 62: `state.py` — init `security_camera_ids` set, populated at boot
- [ ] Verify: security camera reports ALL faces; attendance camera unchanged

### Phase 6.4 — Frontend (Day 29)

- [ ] Step 63: `types/index.ts` — add SecurityAlert, SecurityCamera, AlertSeverity, WsSecurityAlertEvent
- [ ] Step 64: `security-socket.ts` — connect to `/security` namespace, listen `security.alert`
- [ ] Step 65: `app/(dashboard)/admin/security/alerts/page.tsx` — alerts list + filters + review
- [ ] Step 66: `app/(dashboard)/admin/security/cameras/page.tsx` — security camera CRUD form (separate page)
- [ ] Step 67: `app-sidebar.tsx` — add "Security" nav item with unreviewed badge
- [ ] Step 68: `CriticalAlertModal` component — full-screen modal for severity=critical
- [ ] Verify: full flow (security camera → unknown face → modal popup → review)

### Phase 6.5 — Integration & polish (Day 30)

- [ ] Step 69: Configure Telegram webhook via env vars + restart
- [ ] Step 70: E2E test: known face on security cam → info; unknown → critical + webhook + modal
- [ ] Step 71: Commit + push

**Acceptance criteria**:
- Security cameras in `security_cameras` table (no `cameras.mode` column)
- Separate `/api/security/*` endpoints
- Dedicated `/security` WebSocket namespace
- Security camera reports ALL faces (known + unknown)
- Unknown face → critical alert + Telegram webhook + modal popup
- Known face → info log only
- Admin can manage security cameras + review alerts in `/admin/security/*`
- Snapshot JPEG saved for review
- Webhook works for Telegram (photo + caption)

---
