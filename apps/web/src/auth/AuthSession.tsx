import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { fetchMe, getAccessToken, type MeResponse } from "../api";

type AuthSessionContextValue = {
  me: MeResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getAccessToken()) {
      setMe(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const current = await fetchMe();
      setMe(current);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      me,
      loading,
      refresh,
      hasPermission: (permission: string) =>
        me?.role === "admin" || Boolean(me?.permissions.includes(permission)),
    }),
    [loading, me, refresh],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  const ctx = useContext(AuthSessionContext);
  if (!ctx) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }
  return ctx;
}
