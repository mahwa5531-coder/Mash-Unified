/**
 * Canonical error classification module for MASH.
 * Provides a single source of truth for categorizing runtime, network,
 * quota, and model errors into human-friendly, actionable diagnostic cards.
 */

export type AppErrorCategory =
  | 'offline'          // Device has no internet / WiFi turned off
  | 'network_lost'     // Connection interrupted / server disconnected mid-stream
  | 'timeout'          // Agent / model response timed out
  | 'quota'            // Rate limit / 429 / quota exceeded (triggers QuotaBanner)
  | 'auth'             // 401 / unauthorized / session token expired
  | 'tool_failure'     // Tool execution / file access / sandbox error
  | 'service_error'    // 500 / 502 / 503 / upstream model provider error
  | 'general';         // Uncategorized execution interruption

export interface ClassifiedError {
  category: AppErrorCategory;
  title: string;
  description: string;
  rawDetails: string;
  errorId?: string;
  actionType: 'retry' | 'continue' | 'auth' | 'quota' | 'dismiss';
  iconType: 'offline' | 'network' | 'timeout' | 'quota' | 'auth' | 'tool' | 'error';
}

/**
 * Cleanly extract meaningful message from JSON error envelopes or provider payloads.
 */
function extractInnerErrorMessage(raw: string): string {
  if (!raw) return "";

  // Try parsing raw string as JSON (e.g. {"error": {"message": "..."}})
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) return String(parsed.error.message);
    if (parsed?.message) return String(parsed.message);
    if (parsed?.detail) return String(parsed.detail);
  } catch {}

  // Regex extract common nested message patterns
  const match = raw.match(/['"]message['"]:\s*['"]([^'"]+)['"]/);
  if (match && match[1]) return match[1];

  // Strip Python exception prefix if present
  return raw.replace(/^(?:Error|Exception|RuntimeError|ValueError|HTTPException):\s*/i, '').trim();
}

/**
 * Classifies any error string into a structured, user-facing error model.
 */
export function classifyError(
  rawError: string | null | undefined,
  errorId?: string | null
): ClassifiedError | null {
  if (!rawError && !errorId) return null;

  const raw = String(rawError || "").trim();
  const lower = raw.toLowerCase();
  const cleaned = extractInnerErrorMessage(raw);

  // 1. OFFLINE (Device WiFi / Internet disconnect)
  const isOffline = (typeof navigator !== 'undefined' && !navigator.onLine) ||
    lower.includes("wifi disconnected") ||
    lower.includes("offline") ||
    lower.includes("no internet connection");

  if (isOffline) {
    return {
      category: 'offline',
      title: 'No Internet Connection',
      description: 'Your computer appears to be offline. Please verify your Wi-Fi or network connection and reconnect.',
      rawDetails: raw,
      errorId: errorId || undefined,
      actionType: 'retry',
      iconType: 'offline',
    };
  }

  // 2. NETWORK CONNECTION LOST (Mid-stream disconnect, broken pipe, connector reset)
  const isNetworkLost =
    lower.includes("failed to fetch") ||
    lower.includes("network connection lost") ||
    lower.includes("networkerror") ||
    lower.includes("connection reset") ||
    lower.includes("connection closed") ||
    lower.includes("backend server unreachable") ||
    lower.includes("connection refused") ||
    lower.includes("socket disconnect");

  if (isNetworkLost) {
    return {
      category: 'network_lost',
      title: 'Network Connection Lost',
      description: 'The connection to the agent runtime was lost mid-execution. Your partial progress has been preserved.',
      rawDetails: raw,
      errorId: errorId || undefined,
      actionType: 'continue',
      iconType: 'network',
    };
  }

  // 3. TIMEOUT (Stream stalled, model response took too long)
  const isTimeout =
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("deadline exceeded") ||
    lower.includes("504 gateway") ||
    lower.includes("stream connection timed out");

  if (isTimeout) {
    return {
      category: 'timeout',
      title: 'Agent Execution Timed Out',
      description: 'The model took too long to complete its response. This can occur during peak upstream load or on very large tasks.',
      rawDetails: raw,
      errorId: errorId || undefined,
      actionType: 'retry',
      iconType: 'timeout',
    };
  }

  // 4. QUOTA & RATE LIMIT (429, insufficient quota, burst / weekly allocation)
  const isQuota =
    lower.includes("quota exceeded") ||
    lower.includes("rate limit") ||
    lower.includes("quota reached") ||
    lower.includes("insufficient_quota") ||
    lower.includes("too many requests") ||
    lower.includes("429");

  if (isQuota) {
    return {
      category: 'quota',
      title: 'Baseline Model Quota Reached',
      description: 'Your plan has reached its rolling baseline token allocation. Check the quota banner for refresh time.',
      rawDetails: raw,
      errorId: errorId || undefined,
      actionType: 'quota',
      iconType: 'quota',
    };
  }

  // 5. AUTHENTICATION & SESSION EXPIRED (401)
  const isAuth =
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("authentication required") ||
    lower.includes("invalid bearer token") ||
    lower.includes("token expired");

  if (isAuth) {
    return {
      category: 'auth',
      title: 'Authentication Required',
      description: 'Your session has expired or requires authorization. Please sign in to MASH to continue.',
      rawDetails: raw,
      errorId: errorId || undefined,
      actionType: 'auth',
      iconType: 'auth',
    };
  }

  // 6. LOCAL TOOL / WORKSPACE PERMISSION FAILURE
  const isToolFailure =
    lower.includes("filenotfounderror") ||
    lower.includes("permissiondenied") ||
    lower.includes("permission denied") ||
    lower.includes("schema validation failed") ||
    lower.includes("command failed with exit code");

  if (isToolFailure) {
    return {
      category: 'tool_failure',
      title: 'Tool Execution Interrupted',
      description: cleaned || 'A local workspace tool encountered an unexpected file access or permission restriction.',
      rawDetails: raw,
      errorId: errorId || undefined,
      actionType: 'retry',
      iconType: 'tool',
    };
  }

  // 7. UPSTREAM SERVICE / 502 / 503 / OVERLOAD
  const isServiceError =
    lower.includes("500 internal") ||
    lower.includes("502 bad gateway") ||
    lower.includes("503 service unavailable") ||
    lower.includes("model is overloaded") ||
    lower.includes("server error");

  if (isServiceError) {
    return {
      category: 'service_error',
      title: 'Model Service Temporarily Unavailable',
      description: cleaned || 'The upstream model provider reported a temporary service error. Please try again shortly.',
      rawDetails: raw,
      errorId: errorId || undefined,
      actionType: 'retry',
      iconType: 'error',
    };
  }

  // 8. GENERAL / UNCATEGORIZED
  return {
    category: 'general',
    title: 'Agent Execution Interrupted',
    description: cleaned && cleaned.length < 180 ? cleaned : 'Agent execution was interrupted or encountered an unexpected error.',
    rawDetails: raw,
    errorId: errorId || undefined,
    actionType: 'retry',
    iconType: 'error',
  };
}
