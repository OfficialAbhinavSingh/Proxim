const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface MeResponse {
  authenticated: boolean;
  username?: string;
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await fetch(`${API_URL}/api/auth/me`, { credentials: "include" });
  if (!res.ok) return { authenticated: false };
  return (await res.json()) as MeResponse;
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Login failed");
  }
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
}
