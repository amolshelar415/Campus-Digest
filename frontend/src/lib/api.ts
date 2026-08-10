/**
 * Campus Digest — API Client
 * Talks to the FastAPI backend at NEXT_PUBLIC_API_URL
 */

const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/$/, "");
const TOKEN_KEY = "campus_digest_token";

// ── Token helpers ────────────────────────────────────────────────────
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeAuthToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

// ── Generic fetch ────────────────────────────────────────────────────
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  const token = getAuthToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> || {}),
  };

  try {
    const res = await fetch(`${API}${path}`, { ...options, headers });
    if (res.status === 401) {
      removeAuthToken();
      return null;
    }
    if (!res.ok) {
      console.error(`[API] ${path} → ${res.status} ${res.statusText}`);
      return null;
    }
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (err) {
    console.error(`[API] fetch error for ${path}:`, err);
    return null;
  }
}

// ── Auth ─────────────────────────────────────────────────────────────
export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  roll_no?: string;
  branch?: string;
  year?: number;
}

export async function fetchCurrentUser(): Promise<UserProfile | null> {
  return apiFetch<UserProfile>("/auth/me");
}

export async function exchangeCodeForToken(code: string, state: string): Promise<{ access_token: string } | null> {
  const params = new URLSearchParams({ code, state });
  return apiFetch<{ access_token: string }>(`/auth/callback?${params.toString()}`);
}

// ── Messages / Board ─────────────────────────────────────────────────
export interface BoardResponse {
  today: unknown[];
  week: unknown[];
  later: unknown[];
  flagged: unknown[];
  [key: string]: unknown[];
}

export async function fetchBoard(): Promise<BoardResponse | null> {
  return apiFetch<BoardResponse>("/messages/board");
}

export async function fetchMessages(params?: {
  category?: string;
  urgency?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<unknown[] | null> {
  const q = new URLSearchParams();
  if (params?.category) q.set("category", params.category);
  if (params?.urgency)  q.set("urgency",  params.urgency);
  if (params?.search)   q.set("search",   params.search);
  if (params?.page)     q.set("page",     String(params.page));
  if (params?.limit)    q.set("limit",    String(params.limit));
  const qs = q.toString();
  return apiFetch<unknown[]>(`/messages${qs ? `?${qs}` : ""}`);
}

export async function fetchMessage(id: string): Promise<unknown | null> {
  return apiFetch<unknown>(`/messages/${id}`);
}

export async function markAsRead(id: string): Promise<boolean> {
  const res = await apiFetch<unknown>(`/messages/${id}/read`, { method: "POST" });
  return res !== null;
}

export async function dismissMessage(id: string): Promise<boolean> {
  const res = await apiFetch<unknown>(`/messages/${id}/dismiss`, { method: "POST" });
  return res !== null;
}

// ── Feedback ─────────────────────────────────────────────────────────
export async function submitFeedback(
  messageId: string,
  correctedCategory: string,
  feedbackType: "wrong_category" | "mark_spam" | "not_spam" = "wrong_category"
): Promise<boolean> {
  const res = await apiFetch<unknown>("/feedback", {
    method: "POST",
    body: JSON.stringify({ message_id: messageId, corrected_category: correctedCategory, feedback_type: feedbackType }),
  });
  return res !== null;
}

// ── Calendar ─────────────────────────────────────────────────────────
export async function addToCalendar(messageId: string): Promise<unknown | null> {
  return apiFetch<unknown>("/calendar/add", {
    method: "POST",
    body: JSON.stringify({ message_id: messageId }),
  });
}

// ── User Settings ────────────────────────────────────────────────────
export interface NotificationPrefs {
  placement_enabled: boolean;
  faculty_enabled: boolean;
  department_enabled: boolean;
  push_enabled: boolean;
  telegram_digest_enabled: boolean;
  dnd_start?: string;
  dnd_end?: string;
  digest_time?: string;
}

export async function fetchUserSettings(): Promise<NotificationPrefs | null> {
  return apiFetch<NotificationPrefs>("/user/settings");
}

export async function updateUserSettings(prefs: Partial<NotificationPrefs>): Promise<boolean> {
  const res = await apiFetch<unknown>("/user/settings", {
    method: "PUT",
    body: JSON.stringify(prefs),
  });
  return res !== null;
}

// ── Analytics ────────────────────────────────────────────────────────
export async function fetchAnalytics(): Promise<unknown | null> {
  return apiFetch<unknown>("/analytics");
}
