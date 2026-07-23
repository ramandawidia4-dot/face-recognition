# WebSocket Protocol

> Three namespaces: `/realtime`, `/preview`, and `/security`. All use Socket.IO 4.x.

---

## Connection

```js
// Browser
import { io } from 'socket.io-client';

const socket = io('http://localhost/socket.io/', {
  withCredentials: true,  // send cookies
  transports: ['websocket', 'polling'],  // prefer WS, fallback to long-polling
});
```

**Important**:
- Connect to `/socket.io/` (with trailing slash) — proxied by nginx to backend
- `withCredentials: true` for JWT cookies
- JWT cookie sent automatically (browser handles it)

**Auth**: validated by `JwtAuthGuard` di NestJS gateway (cookie-based).

**Reconnection**: Socket.IO client auto-reconnects with exponential backoff (1s, 2s, 4s, 8s, max 30s).

---

## Namespace 1: `/realtime`

For low-frequency events: attendance, camera status, system alerts.

### Events FROM server

#### `attendance.created`
```json
{
  "user_id": "uuid",
  "full_name": "John Doe",
  "status": "present" | "late" | "half_day",
  "timestamp": "2026-07-23T08:55:00Z",
  "attendance_id": "uuid"
}
```

**Subscribers**: dashboard (admin + user), attendance page.

#### `attendance.updated`
```json
{
  "attendance_id": "uuid",
  "user_id": "uuid",
  "check_out": "2026-07-23T17:30:00Z",
  "timestamp": "2026-07-23T17:30:00Z"
}
```

#### `camera.status`
```json
{
  "camera_id": "uuid",
  "state": "RUNNING" | "STOPPED" | "CONNECTING" | "STOPPING" | "RECONNECTING" | "ERROR",
  "error": "string or null"
}
```

**Subscribers**: admin cameras page (state badge).

#### `camera.registered`
```json
{
  "camera_id": "uuid",
  "name": "Entrance",
  "source": "onvif"
}
```

#### `camera.deleted`
```json
{
  "camera_id": "uuid"
}
```

#### `leave.approved` / `leave.rejected` (TODO)
```json
{
  "leave_id": "uuid",
  "user_id": "uuid",
  "approved_by": "uuid"
}
```

### Events FROM client

Client tidak perlu emit apa-apa. Server broadcast ke semua connected clients.

(TODO: bisa tambahkan per-user room jika perlu privacy)

---

## Namespace 2: `/preview`

For high-frequency frame broadcast (1 FPS per camera).

### Events FROM server

#### `camera.frame`
```json
{
  "camera_id": "uuid",
  "frame_base64": "/9j/4AAQSkZ...",  // JPEG 640x480, q=70
  "captured_at": "2026-07-23T08:00:00Z"
}
```

**Subscribers**: admin cameras page (live preview).

**Frequency**: throttled to 3 FPS at backend (multiple cameras = multiplexed).

#### `camera.frame_error`
```json
{
  "camera_id": "uuid",
  "error": "no_frame" | "ai_offline" | "camera_offline"
}
```

Triggered when:
- `no_frame` — 10s without new frame in cache (AI died)
- `ai_offline` — AI service disconnected
- `camera_offline` — RTSP connection lost

### Events FROM client

#### `watch` (subscribe to specific camera)
```js
socket.emit('watch', 'camera-uuid');
```

**Effect**: join room `camera:{id}`. Now receive `camera.frame` only for this camera.

#### `unwatch` (unsubscribe)
```js
socket.emit('unwatch', 'camera-uuid');
```

**Effect**: leave room. No more frames received.

---

## Server-side implementation

### NestJS gateway

```ts
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: CORS_ORIGIN, credentials: true },
})
export class AttendanceGateway {
  @WebSocketServer() server: Server;
  
  @SubscribeMessage('camera.frame')  // (just an example)
  handleFrame() {
    // Client doesn't emit frame
  }
  
  broadcastCameraStatus(payload: { camera_id, state, error }) {
    this.server.emit('camera.status', payload);
  }
}

@WebSocketGateway({
  namespace: '/preview',
  cors: { origin: CORS_ORIGIN, credentials: true },
})
export class PreviewGateway {
  @WebSocketServer() server: Server;
  private subscriptions = new Map<string, Set<string>>();
  
  @SubscribeMessage('watch')
  handleWatch(client: Socket, cameraId: string) {
    if (!this.subscriptions.has(client.id)) {
      this.subscriptions.set(client.id, new Set());
    }
    this.subscriptions.get(client.id)!.add(cameraId);
    client.join(`camera:${cameraId}`);
  }
  
  @SubscribeMessage('unwatch')
  handleUnwatch(client: Socket, cameraId: string) {
    const subs = this.subscriptions.get(client.id);
    if (subs) subs.delete(cameraId);
    client.leave(`camera:${cameraId}`);
  }
  
  broadcastFrame(cameraId: string, frameBase64: string, capturedAt: string) {
    this.server.to(`camera:${cameraId}`).emit('camera.frame', {
      camera_id: cameraId,
      frame_base64: frameBase64,
      captured_at: capturedAt,
    });
  }
  
  broadcastFrameError(cameraId: string, error: string) {
    this.server.to(`camera:${cameraId}`).emit('camera.frame_error', {
      camera_id: cameraId,
      error,
    });
  }
}
```

---

## Auth via cookies

```ts
// In gateway
handleConnection(client: Socket) {
  // JWT cookie auto-sent by browser
  // NestJS can extract from client.handshake.headers.cookie
  const cookie = client.handshake.headers.cookie;
  // ... validate JWT ...
}
```

Or: validate in middleware before WebSocket upgrade.

**For Socket.IO**: use `withCredentials: true` in client, server has `cors: { credentials: true }`.

---

## Connection lifecycle

```
Browser                    nginx                    Backend
   │                          │                          │
   │  GET /socket.io/ (WS)    │                          │
   ├─────────────────────────►│  WS upgrade              │
   │                          ├─────────────────────────►│
   │                          │                          │  JwtAuthGuard
   │                          │                          │  validate cookie
   │                          │◄─────────────────────────┤
   │  101 Switching Protocols  │                          │
   │◄─────────────────────────┤                          │
   │                          │                          │
   │  emit('connect')         │                          │
   │                          │                          │
   │  ... later ...            │                          │
   │                          │                          │
   │  WS disconnect           │                          │
   │  (browser close,         │                          │
   │   network error,         │                          │
   │   or server close)       │                          │
```

---

## Error handling

Server errors → `connect_error` event on client:
```js
socket.on('connect_error', (err) => {
  console.error('WS connect error:', err.message);
  // Common errors: 401 (auth), network unreachable
});
```

Server can emit `error` event:
```js
socket.on('error', (err) => {
  // Server-side error
});
```

---

## Reconnection

Socket.IO client auto-reconnects:
- Default: 1s, 2s, 4s, 8s, 16s, 30s (capped)
- After reconnect, must re-`emit('watch', cameraId)` for each camera
- Use `socket.io-client`'s `reconnection: true` (default)

**Frontend pattern**:
```ts
useEffect(() => {
  const socket = getPreviewSocket();
  
  socket.on('connect', () => {
    socket.emit('watch', cameraId);
  });
  
  return () => {
    socket.emit('unwatch', cameraId);
  };
}, [cameraId]);
```

---

## Performance notes

- **Max clients**: 1000s OK (Socket.IO scales)
- **Max frame rate**: 3 FPS per camera (throttled at backend)
- **Bandwidth**: 30KB/frame * 3 FPS = 90 KB/s per camera, 10 cameras = 900 KB/s. Acceptable for LAN.
- **Memory**: gateway holds `subscriptions` map. O(N clients * M cameras) = manageable.
