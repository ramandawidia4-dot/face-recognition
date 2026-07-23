"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";

export function useAuth() {
  const { user, loading, hydrated, login, logout, getMe } = useAuthStore();

  useEffect(() => {
    if (!hydrated) {
      getMe();
    }
  }, [hydrated, getMe]);

  return { user, loading, hydrated, login, logout };
}
