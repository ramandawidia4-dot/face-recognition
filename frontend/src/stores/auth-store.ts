import { create } from "zustand";
import api from "@/lib/api";
import type { User } from "@/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  hydrated: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  hydrated: false,

  login: async (identifier: string, password: string) => {
    set({ loading: true });
    try {
      const res = await api.post("/auth/login", { identifier, password });
      set({ user: res.data.data.user, loading: false });
    } catch {
      set({ loading: false });
      throw new Error("Login failed");
    }
  },

  logout: async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      set({ user: null });
    }
  },

  getMe: async () => {
    try {
      const res = await api.get("/auth/me");
      set({ user: res.data.data, hydrated: true });
    } catch {
      set({ user: null, hydrated: true });
    }
  },
}));
