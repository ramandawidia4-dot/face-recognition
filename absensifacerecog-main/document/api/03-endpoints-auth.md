# Auth Endpoints (`/api/auth/*`)

> Public endpoints for register, login, refresh, logout, me.

---

## POST /api/auth/register

Register new employee account.

**Auth**: Public (no JWT required)

**Request**:
```json
{
  "email": "user@example.com",
  "username": "johndoe",          // optional, 3-50 chars
  "password": "SecureP@ss1",
  "full_name": "John Doe"
}
```

**Validation**:
- `email`: valid email, max 100, unique
- `username`: optional, 3-50 chars, `[a-zA-Z0-9_.-]+`, unique
- `password`: min 8, max 72, must contain upper/lower/digit/special
- `full_name`: 2-100 chars

**Response 201**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "johndoe",
    "full_name": "John Doe",
    "role": "employee",
    "created_at": "2026-07-23T..."
  }
}
```

**Errors**:
- `400 VALIDATION_ERROR` — bad input
- `409 CONFLICT` — email or username already taken

---

## POST /api/auth/login

Login with email OR username.

**Auth**: Public

**Request**:
```json
{
  "identifier": "user@example.com" | "johndoe",
  "password": "SecureP@ss1"
}
```

**Identifier detection**:
- Contains `@` → query by `email`
- Else → query by `username`

**Response 200** (sets cookies):
```
Set-Cookie: access_token=...; HttpOnly; SameSite=Strict; Path=/; Max-Age=900
Set-Cookie: refresh_token=...; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=604800
```

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "username": "johndoe",
      "full_name": "John Doe",
      "role": "admin" | "employee"
    },
    "access_token_expires_in": 900
  }
}
```

**Errors**:
- `400 VALIDATION_ERROR` — missing identifier/password
- `401 UNAUTHORIZED` — invalid credentials or user inactive

---

## POST /api/auth/refresh

Refresh access token using refresh token cookie.

**Auth**: Public (uses `refresh_token` cookie)

**Request**: (no body, just cookie)

**Response 200** (sets new cookies):
```json
{
  "success": true,
  "data": { "access_token_expires_in": 900 }
}
```

**Errors**:
- `401 UNAUTHORIZED` — no refresh token / invalid / expired / revoked

---

## POST /api/auth/logout

Revoke refresh token + clear cookies.

**Auth**: Public (idempotent)

**Request**: (no body)

**Response 200**:
```json
{
  "success": true,
  "data": null
}
```

**Side effects**:
- Refresh token marked `revoked = true` in DB
- Both cookies cleared

---

## GET /api/auth/me

Get current authenticated user.

**Auth**: JWT required (`access_token` cookie)

**Response 200**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "johndoe",
    "full_name": "John Doe",
    "role": "admin" | "employee"
  }
}
```

**Errors**:
- `401 UNAUTHORIZED` — no token / invalid / expired

---

## Auto-refresh flow (frontend)

```
1. Browser makes request
2. Server returns 401 (token expired)
3. axios interceptor catches 401
4. Calls POST /api/auth/refresh (auto-sends refresh_token cookie)
5. Server sets new access_token cookie
6. axios retries original request
7. User sees no interruption
```

If refresh fails (refresh token also expired):
- Frontend redirects to /login

---

## JWT structure

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "admin",
  "type": "access",
  "iat": 1700000000,
  "exp": 1700000900
}
```

Signed with RS256 (private key in `JWT_PRIVATE_KEY_PATH`).

---

## Security notes

- **Password storage**: bcrypt with 12 rounds
- **Refresh token storage**: SHA-256 hash (not plain UUID)
- **Cookies**: HttpOnly (not accessible to JS), SameSite=Strict (not sent cross-site)
- **In production**: `secure: true` (only over HTTPS)
- **No password in logs**: filtered by logger
- **Rate limit**: `POST /login` sebaiknya di-throttle lebih ketat (TODO: per-IP 5/min)
