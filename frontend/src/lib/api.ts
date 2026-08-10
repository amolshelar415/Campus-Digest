const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function setAuthToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("token", token);
  }
}

export function removeAuthToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("token");
  }
}

async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      removeAuthToken();
    }

    if (!res.ok) {
      throw new Error(`API error: ${res.statusText}`);
    }

    return await res.json();
  } catch (err) {
    console.warn("Backend API call failed, falling back to local mode:", err);
    return null;
  }
}

export async function fetchBoard() {
  return await apiFetch("/messages/board");
}

export async function fetchMessages(category?: string) {
  const query = category && category !== "all" ? `?category=${category}` : "";
  return await apiFetch(`/messages${query}`);
}

export async function markAsRead(id: string) {
  return await apiFetch(`/messages/${id}/read`, { method: "PATCH" });
}

export async function dismissMessage(id: string) {
  return await apiFetch(`/messages/${id}/dismiss`, { method: "PATCH" });
}

export async function submitFeedback(id: string, correctedCategory: string, type: string = "wrong_category") {
  return await apiFetch(`/messages/${id}/feedback`, {
    method: "POST",
    body: JSON.stringify({ corrected_category: correctedCategory, feedback_type: type }),
  });
}

export async function fetchCurrentUser() {
  return await apiFetch("/auth/me");
}

