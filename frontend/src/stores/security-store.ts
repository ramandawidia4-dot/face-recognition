import { create } from "zustand";
import type { WsSecurityAlertEvent } from "@/types";

interface SecurityState {
  alerts: WsSecurityAlertEvent[];
  unacknowledgedCritical: WsSecurityAlertEvent | null;
  addAlert: (event: WsSecurityAlertEvent) => void;
  acknowledgeCritical: () => void;
}

export const useSecurityStore = create<SecurityState>((set) => ({
  alerts: [],
  unacknowledgedCritical: null,

  addAlert: (event) =>
    set((state) => ({
      alerts: [event, ...state.alerts].slice(0, 100),
      unacknowledgedCritical:
        event.severity === "critical" && !state.unacknowledgedCritical
          ? event
          : state.unacknowledgedCritical,
    })),

  acknowledgeCritical: () => set({ unacknowledgedCritical: null }),
}));
