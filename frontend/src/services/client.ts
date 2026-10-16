// HTTP transport core: base URL + safe fetch wrapper shared by all services.

export const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

// ponytail: Eagerly purge legacy token from localStorage to guarantee zero browser token retention
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('nexau_access_token');
  } catch {}
}

// ponytail: Defensively sanitize caller init headers against Authorization leaks
function sanitizeInit(init?: RequestInit): RequestInit | undefined {
  if (!init || !init.headers) return init;
  if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
    const headers = new Headers(init.headers);
    headers.delete('Authorization');
    headers.delete('authorization');
    return { ...init, headers };
  } else if (Array.isArray(init.headers)) {
    return {
      ...init,
      headers: init.headers.filter(([k]) => k.toLowerCase() !== 'authorization')
    };
  } else if (typeof init.headers === 'object') {
    return {
      ...init,
      headers: Object.fromEntries(
        Object.entries(init.headers).filter(([k]) => k.toLowerCase() !== 'authorization')
      )
    };
  }
  return init;
}

// ponytail: safeFetch retries once on transient network drops ONLY for idempotent methods (GET, HEAD).
// Local connector daemon manages upstream auth; frontend sends no bearer tokens across trust boundary.
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  const sanitizedInit = sanitizeInit(init);
  const method = (sanitizedInit?.method || 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD';

  // ponytail: relative paths starting with / must target connector BASE_URL (:8000), not Next.js (:3000) (Blocker B-1)
  const targetUrl = url.startsWith('/') ? `${BASE_URL}${url}` : url;

  try {
    return await fetch(targetUrl, sanitizedInit);
  } catch {
    if (isIdempotent) {
      await new Promise((r) => setTimeout(r, 350));
      try {
        return await fetch(targetUrl, sanitizedInit);
      } catch {}
    }
    return new Response(JSON.stringify({ error: "Backend unavailable" }), {
      status: 503,
      statusText: "Backend unavailable",
      headers: { "Content-Type": "application/json" }
    });
  }
}
