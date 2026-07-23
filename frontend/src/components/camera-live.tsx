"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { CameraState } from "@/types";
import { useCameraStream } from "@/hooks/useCameraStream";

const stateColor: Record<CameraState, string> = {
  RUNNING: "bg-green-500",
  STOPPED: "bg-gray-500",
  CONNECTING: "bg-yellow-500",
  STOPPING: "bg-yellow-500",
  RECONNECTING: "bg-orange-500",
  ERROR: "bg-red-500",
};

interface CameraLiveProps {
  cameraId: string;
  name: string;
  state: CameraState;
  useWebSocket?: boolean;
}

export function CameraLive({ cameraId, name, state, useWebSocket = false }: CameraLiveProps) {
  const [tick, setTick] = useState(0);
  const { frame, error } = useCameraStream(useWebSocket ? cameraId : null);

  useEffect(() => {
    if (useWebSocket) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [useWebSocket]);

  const imgUrl = useWebSocket
    ? (frame ? `data:image/jpeg;base64,${frame.frame_base64}` : null)
    : `/api/cameras/${cameraId}/preview.jpg?t=${tick}`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-3">
        <CardTitle className="text-sm font-medium">{name}</CardTitle>
        <Badge variant="outline" className="gap-1.5">
          <span className={`size-2 rounded-full ${stateColor[state] ?? "bg-gray-500"}`} />
          {state}
        </Badge>
      </CardHeader>
      <CardContent className="p-0">
        <div className="relative aspect-video bg-muted">
          {imgUrl ? (
            <img
              key={useWebSocket ? undefined : tick}
              src={imgUrl}
              alt={name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Skeleton className="h-full w-full" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-white">
              {error === "camera_offline" ? "Camera offline" : "No signal"}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
