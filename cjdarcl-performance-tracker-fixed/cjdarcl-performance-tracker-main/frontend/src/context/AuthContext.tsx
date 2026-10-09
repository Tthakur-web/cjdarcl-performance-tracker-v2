import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { storage } from "@/src/utils/storage";
import { api, AUTH_TOKEN_KEY } from "@/src/api/client";

type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  role: "manager" | "rep";
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  processSessionId: (session_id: string) => Promise<void>;
  devLogin: (email: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    try {
      const token = await storage.secureGet<string>(AUTH_TOKEN_KEY, "");
      if (!token) {
        setUser(null);
        return;
      }
      const me = await api.me();
      setUser(me);
    } catch {
      await storage.secureRemove(AUTH_TOKEN_KEY);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const processSessionId = useCallback(async (session_id: string) => {
    setLoading(true);
    try {
      const { session_token, user: u } = await api.googleSession(session_id);
      await storage.secureSet(AUTH_TOKEN_KEY, session_token);
      setUser(u);
    } finally {
      setLoading(false);
    }
  }, []);

  const devLogin = useCallback(async (email: string, name?: string) => {
    setLoading(true);
    try {
      const { session_token, user: u } = await api.devLogin(email, name);
      await storage.secureSet(AUTH_TOKEN_KEY, session_token);
      setUser(u);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {}
    await storage.secureRemove(AUTH_TOKEN_KEY);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, processSessionId, devLogin, signOut }),
    [user, loading, processSessionId, devLogin, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
