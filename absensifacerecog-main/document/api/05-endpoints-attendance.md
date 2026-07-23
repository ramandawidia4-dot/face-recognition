# Attendance Endpoints (`/api/attendance/*`)

> Check-in / check-out / history.

---

## POST /api/attendance/check-in

Manual check-in via web (fallback if camera down).

**Auth**: JWT (any role)

**Request** (all fields optional):
```json
{
  "location_lat": -6.2,
  "location_lng": 106.8,
  "photo": "data:image/jpeg;base64,...",  // optional
  "notes": "Forgot to bring phone"          // optional
}
```

**Business rules** (backend validates):
- User `is_active = true`
- No `pending` or `approved` leave for today
- No existing `check_in` today (or UPSERT pattern)
- If time > 09:00 → status = `late`
- Else → status = `present`

**Response 201**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "date": "2026-07-23",
    "check_in": "2026-07-23T08:55:00Z",
    "check_out": null,
    "status": "present",
    ...
  }
}
```

**Errors**:
- `403 FORBIDDEN` — user on leave / inactive
- `409 CONFLICT` — already checked in today (use PUT/check-out instead, or idempotent upsert)

---

## POST /api/attendance/check-out

Manual check-out.

**Auth**: JWT

**Request**: same as check-in (optional location/photo/notes)

**Business rules**:
- Must have existing `check_in` today
- If `check_out < 14:00` → status = `half_day`
- Else status unchanged

**Response 201**: attendance object.

**Errors**:
- `404 NOT_FOUND` — no check-in today

---

## GET /api/attendance

Current user's attendance history.

**Auth**: JWT

**Query params**:
| Param | Type | Description |
|---|---|---|
| `from` | date | YYYY-MM-DD |
| `to` | date | YYYY-MM-DD |
| `page` | int | default 1 |
| `limit` | int | default 20, max 100 |

**Response 200**:
```json
{
  "success": true,
  "data": [ /* attendance[] */ ],
  "meta": { "page": 1, "limit": 20, "total": 100 }
}
```

**Scope**: Only current user's data (filtered by `user_id = currentUser.id`).

---

## GET /api/attendance/today

Current user's attendance today.

**Auth**: JWT

**Response 200**:
```json
{
  "success": true,
  "data": {
    "checked_in": true,
    "checked_out": false,
    "attendance": {
      "id": "uuid",
      "check_in": "2026-07-23T08:55:00Z",
      "check_out": null,
      "status": "present"
    }
  }
}
```

If no attendance today: `checked_in: false, checked_out: false, attendance: null`.

---

## GET /api/attendance/all

**Admin only** — all users' attendance.

**Auth**: JWT + admin

**Query params**:
| Param | Type | Description |
|---|---|---|
| `from`, `to` | date | Date range |
| `user_id` | UUID | Filter by user |
| `status` | enum | `present` \| `late` \| `absent` \| `half_day` |
| `page`, `limit` | int | Pagination |

**Response**: same as GET /api/attendance but includes `user` relation.

---

## Auto check-in via camera (AI callback)

When AI detects face:
```
AI: POST /internal/ai/recognition {camera_id, detections: [{user_id, confidence}]}
Backend:
  1. Look up user, check is_active
  2. Check leave (active approved leave today?)
  3. Check existing attendance today
  4. Validate work hours (08:00-09:00 = present, > 09:00 = late)
  5. Check confidence >= threshold (defense in depth)
  6. UPSERT attendances (user_id, date) row
  7. WS broadcast /realtime: attendance.created
  8. Return {action: "check_in" | "ignored", reason}
```

**Possible actions + reasons**:

| Action | Reason | When |
|---|---|---|
| `check_in` | null | First detection today & valid |
| `check_out` | null | Already checked in, not yet checked out |
| `ignored` | `already_checked_in` | Already checked in & out |
| `ignored` | `low_confidence` | Confidence < threshold |
| `ignored` | `on_leave` | Active leave today |
| `ignored` | `outside_work_hours` | Outside configured window |
| `ignored` | `user_inactive` | User is_active = false |

---

## Cooldown

To prevent rapid duplicate check-ins from same camera:
- After successful check-in via camera → cooldown 60 seconds
- If face detected again within cooldown → ignore
- (TODO: implement per-user-per-camera cooldown)
