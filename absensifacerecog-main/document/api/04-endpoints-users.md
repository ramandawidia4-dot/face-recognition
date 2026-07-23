# User Endpoints (`/api/users/*`)

> Admin-only user CRUD.

All endpoints require `admin` role (enforced by `@Roles('admin')` + `RolesGuard`).

---

## GET /api/users

List users with pagination + filter.

**Auth**: JWT + admin

**Query params**:
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | int | 1 | Page number |
| `limit` | int | 20 | Items per page (max 100) |
| `search` | string | — | Search email, username, or full_name (ILIKE) |
| `role` | enum | — | `admin` \| `employee` |
| `is_active` | bool | — | Filter by active status |

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "username": "johndoe",
      "full_name": "John Doe",
      "role": "admin",
      "avatar_url": null,
      "is_active": true,
      "last_login_at": "2026-07-23T...",
      "created_at": "2026-07-20T...",
      "updated_at": "2026-07-23T..."
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1 }
}
```

---

## GET /api/users/{id}

Get single user by ID.

**Response 200**: same shape as list item.

**Errors**:
- `404 NOT_FOUND`

---

## POST /api/users

Create new user (admin only — used to create other admins or pre-create employees).

**Request**:
```json
{
  "email": "user@example.com",
  "username": "johndoe",          // optional
  "password": "SecureP@ss1",
  "full_name": "John Doe",
  "role": "employee"               // "admin" | "employee"
}
```

**Response 201**: user object (no password_hash).

**Errors**:
- `400 VALIDATION_ERROR`
- `409 CONFLICT` — email or username exists

---

## PATCH /api/users/{id}

Update user fields.

**Request** (all fields optional):
```json
{
  "full_name": "New Name",
  "username": "newusername",
  "role": "admin",
  "is_active": false
}
```

**Response 200**: updated user.

**Errors**:
- `400 VALIDATION_ERROR`
- `404 NOT_FOUND`
- `409 CONFLICT` — username already taken

---

## DELETE /api/users/{id}

**Soft delete** — sets `is_active = false`. User cannot login but historical data preserved.

**Response**: 204 No Content

**Side effects**:
- `audit_logs` entry created
- Cascading tables (attendances, leaves, embeddings) NOT deleted (history preserved)
- User can be re-activated via PATCH `is_active: true`

---

## Self-update pattern

Regular users CANNOT call these endpoints (403 Forbidden). To change own profile, separate `/api/users/me` endpoint (TODO).

For now: admin can update any user (including themselves).
