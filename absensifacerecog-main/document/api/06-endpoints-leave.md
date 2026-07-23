# Leave Endpoints (`/api/leaves/*`)

> Employee requests leave, admin approves/rejects.

---

## POST /api/leaves

Employee submits leave request.

**Auth**: JWT (any role)

**Request**:
```json
{
  "type": "sick" | "personal" | "annual" | "other",
  "start_date": "2026-08-01",
  "end_date": "2026-08-03",
  "reason": "Family vacation"
}
```

**Validation**:
- `end_date >= start_date` (DB-level CHECK)
- `type` in enum
- `reason` non-empty

**Response 201**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "type": "annual",
    "start_date": "2026-08-01",
    "end_date": "2026-08-03",
    "reason": "Family vacation",
    "status": "pending",
    "approved_by": null,
    "approved_at": null,
    "created_at": "2026-07-23T..."
  }
}
```

**Status starts as `pending`**, admin reviews later.

---

## GET /api/leaves

Current user's leave history.

**Auth**: JWT

**Query params**:
| Param | Type |
|---|---|
| `page`, `limit` | int |
| `status` | enum |

**Response**: list of leave objects (filtered by current user).

---

## GET /api/leaves/all

**Admin only** — all leave requests.

**Auth**: JWT + admin

**Query params**: page, limit, status, user_id, type

**Response**: list of leave objects (all users).

---

## PATCH /api/leaves/{id}

**Admin only** — approve or reject.

**Auth**: JWT + admin

**Request**:
```json
{
  "status": "approved" | "rejected"
}
```

**Side effects**:
- `approved_by = currentAdmin.id`
- `approved_at = NOW()`
- WS broadcast `/realtime` (TODO)
- If `approved`, attendance check-in during leave period will be ignored (reason=`on_leave`)

**Response 200**: updated leave.

**Errors**:
- `403 FORBIDDEN` — non-admin
- `404 NOT_FOUND`
- `409 CONFLICT` — already approved/rejected (idempotent, returns current state)

---

## Leave types

| Type | Description |
|---|---|
| `sick` | Sakit, biasanya attach surat dokter |
| `personal` | Keperluan pribadi (keluarga, dll) |
| `annual` | Cuti tahunan (quota: TODO) |
| `other` | Lainnya |

---

## Leave quota (TODO)

Annual leave quota per year (e.g. 12 days). Track in separate `leave_quotas` table or compute on-the-fly.

For v1: no quota tracking, unlimited annual.
