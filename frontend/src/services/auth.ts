// Authentication: current-user, logout.

import { BASE_URL, safeFetch } from './client';

export interface AuthUser {
  authenticated: boolean;
  email?: string;
  name?: string;
  plan?: string;
  credits_remaining?: number;
  accounts?: Array<{
    email: string;
    name: string;
    plan: string;
    credits_remaining: number;
  }>;
}

export async function fetchAuthMe(): Promise<AuthUser | null> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/auth/me`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to fetch auth state:", err);
    return null;
  }
}

export async function logoutUser(): Promise<boolean> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/auth/logout`, { method: "POST" });
    return res.ok;
  } catch (err) {
    console.warn("Failed to logout:", err);
    return false;
  }
}
