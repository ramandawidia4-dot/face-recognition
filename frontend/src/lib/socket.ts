import { io, Socket } from "socket.io-client";

const WS_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost";

let realtimeSocket: Socket | null = null;
let previewSocket: Socket | null = null;
let securitySocket: Socket | null = null;

export function getRealtimeSocket(): Socket {
  if (!realtimeSocket) {
    realtimeSocket = io(`${WS_BASE}/socket.io/`, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
  }
  return realtimeSocket;
}

export function getPreviewSocket(): Socket {
  if (!previewSocket) {
    previewSocket = io(`${WS_BASE}/socket.io/`, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
  }
  return previewSocket;
}

export function getSecuritySocket(): Socket {
  if (!securitySocket) {
    securitySocket = io(`${WS_BASE}/socket.io/`, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
  }
  return securitySocket;
}

export function disconnectAll(): void {
  realtimeSocket?.disconnect();
  previewSocket?.disconnect();
  securitySocket?.disconnect();
  realtimeSocket = null;
  previewSocket = null;
  securitySocket = null;
}
