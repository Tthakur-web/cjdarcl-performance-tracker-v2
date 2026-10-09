import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";
export const AUTH_TOKEN_KEY = "sales_crm_session_token";

async function authHeader(): Promise<Record<string, string>> {
  const token = await storage.secureGet<string>(AUTH_TOKEN_KEY, "");
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(await authHeader()),
    ...((init.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers });
  if (res.status === 401) {
    await storage.secureRemove(AUTH_TOKEN_KEY);
    throw new Error("UNAUTHORIZED");
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return (await res.json()) as T;
}

type Period = "day" | "month";

function qs(params: Record<string, string | undefined>): string {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return p.length ? "?" + p.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&") : "";
}

export const api = {
  googleSession: (session_id: string) =>
    request<{ session_token: string; user: any }>("/auth/google-session", {
      method: "POST", body: JSON.stringify({ session_id }),
    }),
  devLogin: (email: string, name?: string) =>
    request<{ session_token: string; user: any }>("/auth/dev-login", {
      method: "POST", body: JSON.stringify({ email, name }),
    }),
  me: () => request<any>("/auth/me"),
  logout: () => request<any>("/auth/logout", { method: "POST" }),
  dashboard: (period: Period = "month", ref_date?: string) =>
    request<any>(`/dashboard${qs({ period, ref_date })}`),
  demands: (period: Period = "month", ref_date?: string, category?: string) =>
    request<any[]>(`/demands${qs({ period, ref_date, category })}`),
  customers: (period: Period = "month", ref_date?: string) =>
    request<any[]>(`/customers${qs({ period, ref_date })}`),
  needsReview: (period: Period = "month", ref_date?: string) =>
    request<any[]>(`/needs-review${qs({ period, ref_date })}`),
  pipeline: (period: Period = "month", ref_date?: string) =>
    request<any>(`/pipeline${qs({ period, ref_date })}`),
  updatePipelineStage: (id: string, stage: string) =>
    request<any>(`/pipeline/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) }),
  payments: (status?: string) =>
    request<any[]>(`/payments${status ? `?status=${status}` : ""}`),
  markReminder: (id: string) =>
    request<any>(`/payments/${id}/reminder`, { method: "PATCH" }),
  syncSheets: () => request<any>("/sync", { method: "POST" }),
  syncStatus: () => request<any>("/sync/status"),
};
