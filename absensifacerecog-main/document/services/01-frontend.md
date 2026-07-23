# Service: Frontend (Next.js 16)

> Single-page admin panel + employee portal. App Router, shadcn/ui, Zustand.

---

## Tujuan

Menyediakan UI untuk:
- **Karyawan**: dashboard absensi, request cuti, lihat rekap sendiri
- **Admin**: CRUD users, CRUD cameras, approve cuti, lihat rekap semua, register wajah baru

---

## Tech

| | Version |
|---|---|
| Next.js | 16.x |
| React | 19.x |
| TypeScript | 5.x strict |
| Tailwind CSS | 4.x |
| shadcn/ui | base-nova |
| Zustand | latest |
| axios | latest |
| socket.io-client | latest |
| lucide-react | latest |
| next-themes | latest |

---

## Struktur folder (target)

```
frontend/
├── package.json
├── next.config.ts                # output: "standalone"
├── tsconfig.json                 # strict mode
├── components.json               # shadcn config
├── Dockerfile                    # multi-stage build
├── .env / .env.example
├── .dockerignore
└── src/
    ├── globals.css               # Tailwind v4 + shadcn CSS vars
    ├── proxy.ts                  # auth redirect (Next.js 16)
    │
    ├── lib/
    │   ├── api.ts                # axios + withCredentials + auto-refresh
    │   ├── socket.ts             # socket.io singleton
    │   └── utils.ts              # cn() helper
    │
    ├── stores/                   # Zustand
    │   ├── auth-store.ts
    │   ├── realtime-store.ts
    │   ├── security-store.ts     # NEW: security alerts + critical modal state
    │   └── ui-store.ts
    │
    ├── hooks/
    │   ├── useAuth.ts
    │   ├── useRealtime.ts
    │   └── useCameraStream.ts
    │
    ├── types/
    │   └── index.ts              # User, Attendance, Leave, Camera, WS events
    │
    ├── components/
    │   ├── ui/                   # 60+ shadcn components
    │   ├── app-sidebar.tsx
    │   ├── camera-live.tsx
    │   └── theme-provider.tsx
    │
    └── app/
        ├── layout.tsx            # root: ThemeProvider + Toaster
        ├── page.tsx              # redirect → /dashboard
        ├── login/page.tsx
        └── (dashboard)/          # route group
            ├── layout.tsx        # SidebarProvider
            ├── dashboard/page.tsx
            ├── attendance/page.tsx
            ├── leave/page.tsx
            └── admin/
                ├── layout.tsx    # admin guard
                ├── users/page.tsx
                ├── cameras/page.tsx
                ├── leaves/page.tsx
                ├── reports/page.tsx
                └── register-face/page.tsx
```

---

## Routes

| Path | Auth | Halaman |
|---|---|---|
| `/login` | public | Login form (email/username + password) |
| `/dashboard` | JWT | Stats + recent activity |
| `/attendance` | JWT | Riwayat + check-in/out manual |
| `/leave` | JWT | List + request cuti |
| `/admin/users` | admin | CRUD users + username |
| `/admin/cameras` | admin | Live preview + control (attendance cameras) |
| `/admin/security/cameras` | admin | CRUD security cameras (server room) |
| `/admin/security/alerts` | admin | List + review security alerts |
| `/admin/leaves` | admin | Approve/reject |
| `/admin/reports` | admin | Filtered reports |
| `/admin/register-face` | admin | Webcam capture |

### Route groups
`(dashboard)` = share layout (sidebar). Tidak muncul di URL.

### Layouts
- `app/layout.tsx` — root: `ThemeProvider` + `Toaster` (sonner)
- `(dashboard)/layout.tsx` — `SidebarProvider` + `AppSidebar` + trigger + content
- `admin/layout.tsx` — guard role admin, redirect kalau bukan

---

## Auth flow

```
1. User buka /admin/cameras
2. proxy.ts (Next.js 16) — check access_token cookie
3. Tidak ada → redirect /login?redirect=/admin/cameras
4. Submit login → POST /api/auth/login { identifier, password }
5. Backend sets cookies: access_token (15m), refresh_token (7d)
6. Store user in Zustand auth-store
7. Redirect → original target
8. axios auto-attaches cookie (withCredentials: true)
9. On 401 → interceptor calls /api/auth/refresh → retry
```

**Identifier**: backend auto-detect `@` → email, else → username.

---

## State management

### Zustand stores (target)

```ts
// auth-store
{
  user: User | null,
  loading: boolean,
  hydrated: boolean,
  login(identifier: string, password: string): Promise<void>,
  logout(): Promise<void>,
  getMe(): Promise<void>,
}

// realtime-store
{
  recentAttendances: WsAttendanceCreated[],
  cameraStates: Record<string, WsCameraStatus>,
  addAttendance(event): void,
  setCameraStatus(event): void,
}

// ui-store
{
  sidebarOpen: boolean,
  toggleSidebar(): void,
  setSidebarOpen(open: boolean): void,
}
```

### Future: React Query
Untuk server state caching + auto refetch. Sekarang pakai plain `useEffect + useState + api`.

---

## Live preview

### HTTP polling (initial implementation)
```tsx
const [tick, setTick] = useState(0);
useEffect(() => {
  if (!isLive) return;
  const t = setInterval(() => setTick(n => n + 1), 1000);
  return () => clearInterval(t);
}, [isLive]);

<img key={tick} src={`/api/cameras/${id}/preview.jpg?t=${tick}`} />
```

- 1 FPS polling
- `@SkipThrottle()` di backend
- 60 req/min per camera
- Simple, easy to debug

### WebSocket (future, hook ready)
```tsx
const { frame, error } = useCameraStream(cameraId);
{frame && <img src={`data:image/jpeg;base64,${frame.frame_base64}`} />}
```

---

## shadcn/ui setup

```bash
# Init (one-time)
npx shadcn@latest init

# Add components as needed
npx shadcn@latest add sidebar card button input ...
```

**Config (`components.json`)**:
```json
{
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "neutral"
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui"
  },
  "iconLibrary": "lucide"
}
```

**Available components** (~60): layout (sidebar, sheet, breadcrumb, separator), forms (button, input, textarea, select, checkbox, radio-group, switch, slider, form, label, field), display (card, badge, avatar, table, tabs, accordion, collapsible), overlay (dialog, alert-dialog, drawer, popover, tooltip, hover-card, dropdown-menu, context-menu, menubar, command, combobox), feedback (alert, sonner, progress, skeleton, spinner, empty), data (chart, calendar, carousel, pagination).

---

## Build & deploy

### Dev
```bash
cd frontend
npm install
npm run dev          # localhost:3000
```

### Prod (Docker)
```yaml
# docker-compose.yml
frontend:
  build:
    context: ./frontend
    args:
      NEXT_PUBLIC_API_BASE: ${NEXT_PUBLIC_API_BASE}
      NEXT_PUBLIC_BACKEND_URL: ${NEXT_PUBLIC_BACKEND_URL}
  environment:
    NEXT_PUBLIC_API_BASE: ${NEXT_PUBLIC_API_BASE}
    NEXT_PUBLIC_BACKEND_URL: ${NEXT_PUBLIC_BACKEND_URL}
```

**Build args WAJIB** karena `NEXT_PUBLIC_*` di-inline saat build, bukan runtime.

### Dockerfile (multi-stage)
```dockerfile
FROM node:24-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE
ARG NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
```

---

## Env

| Var | Required | Default | Build-time? |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE` | yes | `http://localhost/api` | **YES** (build arg) |
| `NEXT_PUBLIC_BACKEND_URL` | yes | `http://localhost` | **YES** (build arg) |

**PENTING**: `NEXT_PUBLIC_*` di-inline ke client bundle **saat build**. Set via build args atau hardcode di `.env` sebelum `npm run build`. Tidak bisa di-set saat container runtime.

---

## Anti-pattern (JANGAN)

- ❌ Pakai `useEffect` untuk fetch tanpa cleanup function (memory leak)
- ❌ Hardcode API URL di component (pakai `api.ts`)
- ❌ Simpan token di localStorage (XSS risk) — pakai HttpOnly cookie
- ❌ Bypass TypeScript (`any` everywhere) — strict mode enforced
- ❌ Inline style banyak (pakai Tailwind classes)
- ❌ Pakai shadcn component yang tidak ada di `components.json` (install dulu)
- ❌ Import dari `@/components/ui/X` langsung di banyak file (pakai wrapper component di `@/components/`)
- ❌ Pakai `useState` untuk derived value (pakai `useMemo` atau compute inline)

---

## Testing (TODO)

- **Unit**: Vitest + Testing Library (component logic)
- **E2E**: Playwright (login → add camera → start → see preview)
- **Visual**: Chromatic atau Percy (shadcn component regression)

---

## Next step

→ Baca [`02-backend.md`](02-backend.md) untuk service backend.
