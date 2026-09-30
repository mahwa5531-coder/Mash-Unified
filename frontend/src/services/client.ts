// HTTP transport core: base URL + safe fetch wrapper shared by all services.

export const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

/** Read stored access token from localStorage (if in browser) */
export function getStoredAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('nexau_access_token');
  } catch {
    return null;
  }
}

// ponytail: safeFetch automatically attaches Bearer token to all outgoing API calls
// and retries once on transient network drops ONLY for idempotent methods (GET, HEAD).
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD';

  // Auto-inject Bearer token if present and not already provided
  const token = getStoredAccessToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const effectiveInit: RequestInit = {
    ...init,
    headers,
  };

  try {
    return await fetch(url, effectiveInit);
  } catch {
    if (isIdempotent) {
      await new Promise((r) => setTimeout(r, 350));
      try {
        return await fetch(url, effectiveInit);
      } catch {}
    }
    return new Response(JSON.stringify({ error: "Backend unavailable" }), {
      status: 503,
      statusText: "Backend unavailable",
      headers: { "Content-Type": "application/json" }
    });
  }
}
