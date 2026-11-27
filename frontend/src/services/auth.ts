// Authentication: current-user, logout.

import { BASE_URL, safeFetch } from './client';

export interface QuotaWindow {
  window: "5h" | "weekly" | string;
  quota_tokens?: number;
  used_tokens?: number;
  percent?: number;
  used_percent?: number;
  resets_at?: string;
}

export interface QuotaInfo {
  currency?: string;
  windows?: QuotaWindow[];
}

export interface UsageInfo {
  user_id?: string;
  tenant_id?: string;
  period?: string;
  used_tokens?: number;
  quota_tokens?: number;
  used_percent?: number;
  remaining_percent?: number;
}

export interface AuthUser {
  authenticated: boolean;
  offline?: boolean;
  sync_error?: string;
  auth_expired?: boolean;
  email?: string;
  name?: string;
  plan?: string;
  subscription_status?: string;
  quota?: QuotaInfo;
  usage?: UsageInfo;
  limits?: Record<string, number>;
  credits_remaining?: number;
  accounts?: Array<{
    email: string;
    name: string;
    plan: string;
    credits_remaining: number;
  }>;
}

export async function fetchAuthMe(fresh = false): Promise<AuthUser | null> {
  try {
    const url = fresh ? `${BASE_URL}/api/auth/me?fresh=true` : `${BASE_URL}/api/auth/me`;
    const res = await safeFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.auth_expired && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mash:auth_expired'));
    }
    return data;
  } catch (err) {
    console.warn("Failed to fetch auth state:", err);
    return null;
  }
}

export async function fetchAuthConfig(): Promise<{ website_url?: string; pricing_url?: string } | null> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/auth/config`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function syncAuthUsage(): Promise<AuthUser | null> {
  try {
    await safeFetch(`${BASE_URL}/api/auth/sync`, { method: "POST" });
    return await fetchAuthMe(true);
  } catch (err) {
    console.warn("Failed to sync auth usage:", err);
    return null;
  }
}

export async function logoutUser(): Promise<boolean> {
  try {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('nexau_access_token');
      } catch {}
    }
    const res = await safeFetch(`${BASE_URL}/api/auth/logout`, { method: "POST" });
    return res.ok;
  } catch (err) {
    console.warn("Failed to logout:", err);
    return false;
  }
}
