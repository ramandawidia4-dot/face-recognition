import { create } from "zustand";
import type { WsAttendanceCreated, WsCameraStatus } from "@/types";

interface RealtimeState {
  recentAttendances: WsAttendanceCreated[];
  cameraStates: Record<string, WsCameraStatus>;
  addAttendance: (event: WsAttendanceCreated) => void;
  setCameraStatus: (event: WsCameraStatus) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  recentAttendances: [],
  cameraStates: {},

  addAttendance: (event) =>
    set((state) => ({
      recentAttendances: [event, ...state.recentAttendances].slice(0, 50),
    })),

  setCameraStatus: (event) =>
    set((state) => ({
      cameraStates: { ...state.cameraStates, [event.camera_id]: event },
    })),
}));
