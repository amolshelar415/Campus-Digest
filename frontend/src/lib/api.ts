/**
 * Campus Digest — API Client
 * All calls to the FastAPI backend at NEXT_PUBLIC_API_URL
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

export function isLoggedIn(): boolean {
  return !!getAuthToken();
}

// ── Generic fetch ────────────────────────────────────────────────────
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
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

export function getLoginUrl(): string {
  return `${API}/auth/login`;
}

// ── Messages / Board ─────────────────────────────────────────────────
export interface ApiMessage {
  id: string;
  user_id: string;
  source: "gmail" | "telegram";
  category: "placement" | "faculty" | "department" | "spam";
  urgency: "high" | "medium" | "low";
  sender: string;
  subject: string;
  body_text: string;
  received_at: string;
  deadline: string | null;
  is_read: boolean;
  is_dismissed: boolean;
  calendar_event_id: string | null;
  confidence?: number;
}

export interface BoardResponse {
  today: ApiMessage[];
  week: ApiMessage[];
  later: ApiMessage[];
  flagged: ApiMessage[];
}

export async function fetchBoard(): Promise<BoardResponse | null> {
  return apiFetch<BoardResponse>("/messages/board");
}

export async function markAsRead(id: string): Promise<void> {
  await apiFetch<unknown>(`/messages/${id}/read`, { method: "POST" });
}

export async function dismissMessage(id: string): Promise<void> {
  await apiFetch<unknown>(`/messages/${id}/dismiss`, { method: "POST" });
}

// ── Feedback ─────────────────────────────────────────────────────────
export async function submitFeedback(
  messageId: string,
  correctedCategory: string,
  feedbackType: "wrong_category" | "mark_spam" | "not_spam" = "wrong_category"
): Promise<boolean> {
  const res = await apiFetch<unknown>(`/messages/${messageId}/feedback`, {
    method: "POST",
    body: JSON.stringify({
      corrected_category: correctedCategory,
      feedback_type: feedbackType,
      message_id: messageId,
    }),
  });
  return res !== null;
}

// ── Calendar ─────────────────────────────────────────────────────────
export interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  htmlLink: string;
}

export async function addToCalendar(
  messageId: string
): Promise<{ status: string; event_id?: string; event_link?: string; summary?: string } | null> {
  return apiFetch<{ status: string; event_id?: string; event_link?: string; summary?: string }>(
    "/calendar/add",
    { method: "POST", body: JSON.stringify({ message_id: messageId }) }
  );
}

export async function getCalendarEvents(): Promise<CalendarEvent[]> {
  const res = await apiFetch<{ events: CalendarEvent[] }>("/calendar/events");
  return res?.events ?? [];
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
  gmail_connected?: boolean;
  calendar_connected?: boolean;
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

export async function registerFCMToken(token: string): Promise<boolean> {
  const res = await apiFetch<unknown>("/user/fcm-token", {
    method: "POST",
    body: JSON.stringify({ fcm_token: token }),
  });
  return res !== null;
}

export async function triggerPollNow(): Promise<{ status: string; message: string } | null> {
  return apiFetch<{ status: string; message: string }>("/user/poll-now", { method: "POST" });
}
