// Authentication: current-user, logout.

import { BASE_URL, safeFetch } from './client';

export interface QuotaWindow {
  window: "5h" | "weekly" | string;
  quota_tokens?: number;
  used_tokens?: number;
  percent: number;
  resets_at?: string;
}

export interface QuotaInfo {
  currency?: string;
  windows?: QuotaWindow[];
}

export interface AuthUser {
  authenticated: boolean;
  email?: string;
  name?: string;
  plan?: string;
  subscription_status?: string;
  quota?: QuotaInfo;
  limits?: Record<string, number>;
  models?: string[];
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

export async function syncAuthMe(): Promise<AuthUser | null> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/auth/sync`, { method: "POST" });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data || null;
  } catch (err) {
    console.warn("Failed to sync auth state:", err);
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
