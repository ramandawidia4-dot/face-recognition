"use client";

import { useEffect, useState } from "react";
import { getPreviewSocket } from "@/lib/socket";
import type { WsCameraFrame } from "@/types";

interface UseCameraStreamResult {
  frame: WsCameraFrame | null;
  error: string | null;
}

export function useCameraStream(cameraId: string | null): UseCameraStreamResult {
  const [frame, setFrame] = useState<WsCameraFrame | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cameraId) return;

    const socket = getPreviewSocket();

    const handleConnect = () => {
      socket.emit("watch", cameraId);
    };

    const handleFrame = (data: WsCameraFrame) => {
      setFrame(data);
      setError(null);
    };

    const handleError = (data: { error: string }) => {
      setError(data.error);
    };

    socket.on("connect", handleConnect);
    socket.on("camera.frame", handleFrame);
    socket.on("camera.frame_error", handleError);

    if (socket.connected) {
      socket.emit("watch", cameraId);
    }

    return () => {
      socket.emit("unwatch", cameraId);
      socket.off("connect", handleConnect);
      socket.off("camera.frame", handleFrame);
      socket.off("camera.frame_error", handleError);
    };
  }, [cameraId]);

  return { frame, error };
}
