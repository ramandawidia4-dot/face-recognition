"use client";

import { useEffect } from "react";
import { getRealtimeSocket } from "@/lib/socket";
import { useRealtimeStore } from "@/stores/realtime-store";
import type { WsAttendanceCreated, WsCameraStatus } from "@/types";

export function useRealtime() {
  const { addAttendance, setCameraStatus } = useRealtimeStore();

  useEffect(() => {
    const socket = getRealtimeSocket();

    socket.on("attendance.created", (event: WsAttendanceCreated) => {
      addAttendance(event);
    });

    socket.on("camera.status", (event: WsCameraStatus) => {
      setCameraStatus(event);
    });

    return () => {
      socket.off("attendance.created");
      socket.off("camera.status");
    };
  }, [addAttendance, setCameraStatus]);
}
