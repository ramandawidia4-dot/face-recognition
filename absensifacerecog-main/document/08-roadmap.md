# Roadmap — Phased Delivery Plan

> 4 phase dari MVP sampai production-ready.

---

## Phase 1: MVP (Local dev, single user)

**Goal**: 1 admin, 1 camera, 1 user, manual test end-to-end.

**Scope**:
- [x] DB schema (9 tables: 7 attendance + 2 security)
- [x] Backend skeleton: NestJS, TypeORM, modules
- [x] AI service skeleton: FastAPI, InsightFace, ffmpeg
- [x] Frontend skeleton: Next.js 16, shadcn/ui
- [x] Auth: register, login, JWT, refresh
- [x] User CRUD (admin only)
- [x] Camera CRUD (admin only)
- [x] ONVIF support (auto resolve RTSP)
- [x] Live preview (HTTP polling)
- [x] Admin seeder (default user)
- [x] Docker Compose (5 services)
- [x] nginx reverse proxy

**Out of scope (Phase 2+)**:
- HTTPS
- Backup automation
- Multi-camera scale test
- Performance optimization

**Acceptance criteria**:
- ✅ docker compose up works
- ✅ Admin can login
- ✅ Admin can add ONVIF camera
- ✅ Admin can start camera, see live preview
- ✅ User can register face, get auto check-in

**Timeline**: 2-3 minggu (1 dev full-time)

---

## Phase 2: Production hardening

**Goal**: Deploy ke NUC di kantor, HTTPS, monitoring.

**Scope**:
- [ ] HTTPS via Cloudflare (Tunnel atau Origin cert)
- [ ] Production env vars (real passwords, real INTERNAL_TOKEN)
- [ ] Backup automation (daily pg_dump + offsite)
- [ ] Log rotation
- [ ] Uptime monitoring (UptimeRobot)
- [ ] Error tracking (Sentry)
- [ ] Performance: warm model cache, connection pooling
- [ ] Stale frame detection + auto-recovery
- [ ] Health check endpoint + Docker healthcheck
- [ ] Rate limit on `/api/auth/login` (anti-brute-force)
- [ ] Security headers (CSP, HSTS)
- [ ] Disable server_tokens in nginx
- [ ] Fail2ban integration

**Out of scope**:
- Horizontal scaling
- High availability

**Acceptance criteria**:
- ✅ HTTPS works
- ✅ Daily backup runs automatically
- ✅ Server up for 30 days without manual intervention
- ✅ Admin notified on downtime

**Timeline**: 2-3 minggu

---

## Phase 3: Feature expansion

**Goal**: Complete feature set for v1.

**Scope**:
- [ ] Leave quota tracking (annual: 12 days/year)
- [ ] Cooldown for check-in (60s per user-camera)
- [ ] Manual absent (admin can mark absent)
- [ ] Bulk operations (bulk import users from CSV)
- [ ] Reports export (CSV, PDF)
- [ ] Email/SMS notifications (forgot to check-in)
- [ ] Multi-shift support (if needed)
- [ ] Geo-fencing (absen must be at location) — optional
- [ ] Mobile responsive improvements
- [ ] Dark mode (theme provider ready)
- [ ] i18n (English + Indonesian)

**Acceptance criteria**:
- ✅ All basic features working in production
- ✅ HR can generate monthly report
- ✅ User gets reminder if forgot to check-in

**Timeline**: 4-6 minggu

---

## Phase 4: Scale & optimize

**Goal**: 10+ cameras, 100+ users, performance.

**Scope**:
- [ ] Multi-camera scale test (benchmark)
- [ ] GPU support (ONNX runtime GPU) for faster inference
- [ ] Redis for cache (replaces in-memory preview cache)
- [ ] Database optimization (materialized views, partitioning)
- [ ] CDN for static assets
- [ ] WebSocket scaling (Redis adapter for Socket.IO)
- [ ] Monitoring: Prometheus + Grafana
- [ ] Tracing: OpenTelemetry
- [ ] CI/CD pipeline
- [ ] Automated tests (unit + E2E + load)
- [ ] Documentation site (Docusaurus)

**Out of scope**:
- Multi-tenant (multiple companies in one instance)
- Kubernetes migration (still single-node)
- Cloud AI integration (InsightFace is good enough)

**Acceptance criteria**:
- ✅ 10 cameras, 100 users, < 80% CPU
- ✅ P95 face recognition < 1s
- ✅ Zero data loss over 90 days

**Timeline**: 8-12 minggu

---

## Out of v1 (post-v1 features)

- ❌ Mobile app (native iOS/Android)
- ❌ SSO/LDAP/SAML
- ❌ Cloud AI fallback (AWS Rekognition)
- ❌ Multi-tenant (multiple companies)
- ❌ Payroll integration
- ❌ Shift bidding
- ❌ Overtime calculation
- ❌ Performance review

---

## Milestone checklist

| # | Milestone | Status |
|---|---|---|
| M1 | Docker stack up + admin can login | ⏳ |
| M2 | One camera live preview works | ⏳ |
| M3 | One user can register face + auto check-in | ⏳ |
| M4 | 5 cameras concurrently, no degradation | ⏳ |
| M5 | Production deploy (HTTPS + backups) | ⏳ |
| M6 | All Phase 3 features done | ⏳ |
| M7 | Phase 4 perf done | ⏳ |
| M8 | Security Room module: unknown face alert + webhook | ⏳ |

---

## Phase 6: Security Room Module (Day 26-30, after Phase 4)

**Scope**:
- Separate `security_cameras` table (NOT `cameras.mode` column)
- Separate `/api/security/*` endpoints + `/security` WebSocket namespace
- AI service dual pipeline (report ALL faces on security cameras, only matched on attendance)
- Severity levels: `info` (known), `warning` (partial), `critical` (stranger)
- Webhook: Telegram/Discord/Slack with photo attachment
- Frontend: separate `/admin/security/*` pages + critical alert modal

**Why this matters**: server room access monitoring is fundamentally different from attendance. Mixing them via `mode` column would couple unrelated business logic. Separate module = cleaner code, easier maintenance, future flexibility (e.g., different retention policies).

**Acceptance criteria**:
- Admin can register security cameras
- Unknown face on security camera → critical alert
- Telegram webhook receives alert with face photo
- Critical alert modal in browser blocks UI until acknowledged
- Admin can review alerts + add notes
- Attendance cameras unchanged (regression test)
| M7 | Phase 4 perf done | ⏳ |

---

## Decision log (high-impact only)

| Date | Decision | Reason |
|---|---|---|
| 2026-07 | NestJS over Express+SOA | Modular, decorator-based, faster dev |
| 2026-07 | TypeORM over Prisma | Native NestJS DI, sync with decorators |
| 2026-07 | FastAPI over Go/Rust | Python face recognition libs more mature |
| 2026-07 | shadcn/ui over Material UI | Modern, copy-paste, no lock-in |
| 2026-07 | Zustand over Redux | Less boilerplate, sufficient for our state |
| 2026-07 | insightsface/buffalo_l | Best accuracy/effort tradeoff for face rec |
| 2026-07 | nginx over Traefik | Battle-tested, smaller image, sufficient |
| 2026-07 | Standalone Next.js build | Smaller Docker image, no node_modules in runtime |
| 2026-07 | Sync `requests` from worker threads | asyncio.run() in thread is broken |
| 2026-07 | Binary JPEG frames (Content-Type: image/jpeg) | 30% smaller than base64 JSON |
| 2026-07 | @SkipThrottle on preview endpoint | 1 FPS polling, don't rate-limit legitimate traffic |
| 2026-07 | shadcn base-nova (not new-york) | Modern, neutral colors |

---

## Next step

→ Baca [`09-risks.md`](../09-risks.md) untuk risk register.
