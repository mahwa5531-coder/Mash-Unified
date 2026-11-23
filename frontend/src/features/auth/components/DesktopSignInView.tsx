"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { fetchAuthMe, AuthUser } from '@/services/auth';
import { BASE_URL, safeFetch } from '@/services/client';
import { cn } from '@/lib/utils';

export interface DesktopSignInViewProps {
  onAuthSuccess: (user: AuthUser) => void;
  className?: string;
}

type SignInMode = 'idle' | 'business' | 'authenticated';

export default function DesktopSignInView({ onAuthSuccess, className }: DesktopSignInViewProps) {
  const [mode, setMode] = useState<SignInMode>('idle');
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [businessEmail, setBusinessEmail] = useState('');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Stop polling helper
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setIsAuthorizing(false);
  }, []);

  // Check auth status with backend
  const checkAuthStatus = useCallback(async () => {
    try {
      const user = await fetchAuthMe();
      if (user && user.authenticated) {
        stopPolling();
        setAuthUser(user);
        setMode('authenticated');
        setAuthError(null);
        // Automatically transition into the workspace without forcing manual Next click!
        setTimeout(() => {
          onAuthSuccess(user);
        }, 400);
        return true;
      }
    } catch {
      // Backend request error
    }
    return false;
  }, [stopPolling, onAuthSuccess]);

  // Window focus listener: immediately check if user signed in when returning from browser
  useEffect(() => {
    const handleWindowFocus = () => {
      if (mode !== 'authenticated') {
        checkAuthStatus();
      }
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [mode, checkAuthStatus]);

  // Background polling while authorizing in browser
  useEffect(() => {
    if (!isAuthorizing) return;

    const startTime = Date.now();
    pollTimerRef.current = setInterval(async () => {
      // Auto-timeout after 3 minutes
      if (Date.now() - startTime > 180000) {
        stopPolling();
        setAuthError("Sign-in timed out or was not completed in the browser. Please try again.");
        return;
      }

      const succeeded = await checkAuthStatus();
      if (succeeded) {
        stopPolling();
      }
    }, 1500);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isAuthorizing, checkAuthStatus, stopPolling]);

  // Launch Google OAuth in browser via Cloud Gateway
  const handleLaunchGoogleAuth = async (hintEmail?: string) => {
    setAuthError(null);
    let cloudGatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL;
    if (!cloudGatewayUrl) {
      try {
        const res = await safeFetch(`${BASE_URL}/api/auth/config`);
        if (res.ok) {
          const cfg = await res.json();
          if (cfg.gateway_url) cloudGatewayUrl = cfg.gateway_url;
        }
      } catch {
        setAuthError("Unable to reach local MASH connector. Ensure backend is running.");
      }
    }

    cloudGatewayUrl = (cloudGatewayUrl || "https://api.mash.ai").replace(/\/+$/, "");
    const emailParam = hintEmail ? `?login_hint=${encodeURIComponent(hintEmail)}` : '';

    try {
      window.open(`${cloudGatewayUrl}/v1/auth/oauth/google${emailParam}`, '_blank');
    } catch (err) {
      console.warn("Failed to open browser:", err);
    }

    setIsAuthorizing(true);
  };

  // Previous button handler: resets state back to fresh default signin
  const handlePrevious = () => {
    stopPolling();
    setMode('idle');
    setBusinessEmail('');
    setAuthError(null);
  };

  // Next button handler: enters the workspace when authenticated
  const handleNext = () => {
    if (authUser && authUser.authenticated) {
      onAuthSuccess(authUser);
    }
  };

  // Keyboard shortcut: Enter key triggers Next if authenticated
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && mode === 'authenticated' && authUser) {
        onAuthSuccess(authUser);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, authUser, onAuthSuccess]);

  return (
    <div className={cn("flex flex-col min-h-screen w-full items-center justify-between bg-[#0e0e11] text-white p-6 sm:p-10 font-sans select-none", className)}>
      
      {/* Spacer to balance vertical centering */}
      <div className="h-6 w-full shrink-0" />

      {/* Main Centered Content */}
      <div className="flex flex-col items-center justify-center w-full max-w-[360px] my-auto space-y-6">
        
        {/* Welcome Heading (Pure typography, zero logo) */}
        <h1 className="text-[23px] sm:text-[25px] font-semibold text-white tracking-tight text-center">
          Welcome to MASH
        </h1>

        {/* Centered Modal Card */}
        <div className="w-full rounded-2xl bg-[#17171a] border border-zinc-800/80 p-5 sm:p-6 shadow-2xl flex flex-col gap-3.5 transition-all">
          
          {/* STATE 1: AUTHENTICATED SUCCESS */}
          {mode === 'authenticated' && authUser ? (
            <div className="py-2 flex flex-col items-center text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
                <CheckCircle2 size={22} />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-white">Signed in successfully</div>
                <div className="text-xs text-zinc-400 font-mono truncate max-w-[260px]">
                  {authUser.email || authUser.name}
                </div>
              </div>
              <p className="text-[11px] text-zinc-500">
                Click <strong>Next</strong> below to enter your workspace.
              </p>
            </div>
          ) : mode === 'business' ? (
            /* STATE 2: BUSINESS ACCOUNT DOMAIN */
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (businessEmail.trim()) handleLaunchGoogleAuth(businessEmail.trim());
              }}
              className="space-y-3"
            >
              <div className="text-xs font-medium text-zinc-400 text-center mb-0.5">
                Business SSO
              </div>
              <input
                type="email"
                autoFocus
                required
                placeholder="auditor@firm.com"
                value={businessEmail}
                onChange={(e) => setBusinessEmail(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[#202024] border border-zinc-800 text-white placeholder:text-zinc-500 text-xs sm:text-[13px] focus:outline-none focus:border-blue-500 transition-colors"
              />
              <button
                type="submit"
                disabled={isAuthorizing}
                className="w-full h-10 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs sm:text-[13px] font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-70"
              >
                {isAuthorizing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Waiting for SSO in browser...</span>
                  </>
                ) : (
                  <span>Continue with SSO</span>
                )}
              </button>
            </form>
          ) : (
            /* STATE 3: DEFAULT SIGN IN (Always stays visible even after clicking Google!) */
            <>
              <div className="text-xs font-medium text-zinc-400 text-center mb-0.5">
                Sign in
              </div>

              {/* Primary Blue: Continue with Google */}
              <button
                type="button"
                onClick={() => {
                  if (isAuthorizing) {
                    handlePrevious();
                  } else {
                    handleLaunchGoogleAuth();
                  }
                }}
                className={cn(
                  "w-full h-10 rounded-xl text-white text-xs sm:text-[13px] font-medium transition-colors flex items-center justify-center gap-2.5 cursor-pointer shadow-sm active:scale-[0.99]",
                  isAuthorizing ? "bg-[#1d4ed8]" : "bg-[#2563eb] hover:bg-[#1d4ed8]"
                )}
                title={isAuthorizing ? "Click to cancel browser authorization" : "Continue with Google"}
              >
                {isAuthorizing ? (
                  <>
                    <Loader2 size={14} className="animate-spin text-white shrink-0" />
                    <span>Authorizing in browser...</span>
                  </>
                ) : (
                  <>
                    {/* Official Google 4-Color G icon on white badge */}
                    <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center shrink-0 shadow-xs">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                        />
                      </svg>
                    </div>
                    <span>Continue with Google</span>
                  </>
                )}
              </button>

              {/* Secondary Dark: Use business account */}
              <button
                type="button"
                disabled={isAuthorizing}
                onClick={() => {
                  stopPolling();
                  setMode('business');
                }}
                className={cn(
                  "w-full h-10 rounded-xl bg-[#262629] text-zinc-200 text-xs sm:text-[13px] font-medium transition-colors flex items-center justify-center select-none",
                  isAuthorizing ? "opacity-50 cursor-not-allowed" : "hover:bg-[#303035] cursor-pointer active:scale-[0.99]"
                )}
              >
                Use business account
              </button>

              {/* Subtle status notice while waiting for browser */}
              {isAuthorizing && (
                <div className="pt-1 text-center animate-in fade-in duration-150">
                  <div className="text-[11px] text-zinc-400">
                    Browser window opened. Sign in there, or{' '}
                    <button
                      type="button"
                      onClick={handlePrevious}
                      className="text-blue-400 hover:underline cursor-pointer font-medium"
                    >
                      cancel
                    </button>
                    .
                  </div>
                </div>
              )}
            </>
          )}

          {/* Connection Error Message if backend unreachable */}
          {authError && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] leading-tight text-center">
              {authError}
            </div>
          )}

        </div>
      </div>

      {/* Bottom Footer Controls: Previous & Next */}
      <div className="flex flex-col items-center gap-2.5 pb-2 shrink-0">
        <button
          type="button"
          onClick={handlePrevious}
          disabled={mode === 'idle' && !isAuthorizing}
          className={cn(
            "text-xs transition-colors select-none",
            (mode !== 'idle' || isAuthorizing)
              ? "text-zinc-400 hover:text-white cursor-pointer"
              : "text-zinc-600 cursor-default opacity-50"
          )}
        >
          Previous
        </button>

        <button
          type="button"
          disabled={mode !== 'authenticated'}
          onClick={handleNext}
          className={cn(
            "w-44 h-8 rounded-lg text-xs font-medium transition-all flex items-center justify-center select-none",
            mode === 'authenticated'
              ? "bg-white text-zinc-900 hover:bg-zinc-100 cursor-pointer shadow-md"
              : "bg-zinc-800/60 text-zinc-500 cursor-not-allowed border border-zinc-800/40"
          )}
        >
          Next
        </button>
      </div>

    </div>
  );
}
