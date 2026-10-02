"use client";

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchAuthMe, AuthUser } from '@/services/auth';
import { BASE_URL, safeFetch } from '@/services/client';
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardAction, 
  CardContent, 
  CardFooter 
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DesktopSignInViewProps {
  onAuthSuccess: (user: AuthUser) => void;
}

export default function DesktopSignInView({ onAuthSuccess }: DesktopSignInViewProps) {
  const [email, setEmail] = useState('');
  const [isPolling, setIsPolling] = useState(false);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  // Background polling: when browser sign-in is launched, poll /api/auth/me for completion
  // The Cloud API sends the single-use mcode via localhost loopback or deep link,
  // the Desktop backend exchanges it with Cloud for real JWT tokens, and this poller unlocks.
  useEffect(() => {
    if (!isPolling) return;
    const startTime = Date.now();
    const interval = setInterval(async () => {
      // Auto-stop after 3 minutes to prevent infinite polling
      if (Date.now() - startTime > 180000) {
        setIsPolling(false);
        setNoticeMsg("Browser sign-in session timed out. Please try again.");
        return;
      }

      try {
        const user = await fetchAuthMe();
        if (user && user.authenticated) {
          setIsPolling(false);
          onAuthSuccess(user);
        }
      } catch {
        // keep polling silently until Cloud authentication completes
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [isPolling, onAuthSuccess]);

  // ALL authentication delegates strictly to Google OAuth via Cloud Gateway.
  // Nothing is authenticated or stored locally on the desktop.
  const handleCloudGoogleAuth = async (hintEmail?: string) => {
    let cloudGatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL;
    if (!cloudGatewayUrl) {
      try {
        const res = await safeFetch(`${BASE_URL}/api/auth/config`);
        if (res.ok) {
          const cfg = await res.json();
          if (cfg.gateway_url) cloudGatewayUrl = cfg.gateway_url;
        }
      } catch {}
    }
    cloudGatewayUrl = (cloudGatewayUrl || "https://api.mash.ai").replace(/\/+$/, "");
    const emailParam = hintEmail ? `?login_hint=${encodeURIComponent(hintEmail)}` : '';
    try {
      window.open(`${cloudGatewayUrl}/v1/auth/oauth/google${emailParam}`, '_blank');
    } catch (err) {
      console.warn("Failed to open browser:", err);
    }
    setIsPolling(true);
    setNoticeMsg("Connecting to Cloud & Google OAuth... Complete sign-in in your browser to unlock desktop.");
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleCloudGoogleAuth(email.trim());
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#0a0a0c] text-white p-4 font-sans select-none">
      <Card className="w-full max-w-[400px] rounded-2xl bg-[#161618] border border-zinc-800/90 shadow-2xl py-6 gap-5">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-white">
            Sign in to MASH
          </CardTitle>
          <CardDescription className="text-sm text-zinc-400 mt-1 leading-snug">
            Authenticate securely with your Google Workspace account via Cloud Gateway to access your audit workspace.
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleLoginSubmit}>
          <CardContent className="space-y-4">
            {noticeMsg && (
              <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-xs text-blue-400 text-left">
                {noticeMsg}
              </div>
            )}

            <div className="space-y-1.5 text-left">
              <Label htmlFor="email" className="text-sm font-medium text-white">
                Work Email (Optional)
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="auditor@firm.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10 rounded-lg bg-[#1c1c1f] border-zinc-800 text-white placeholder:text-zinc-500 focus-visible:ring-1 focus-visible:ring-zinc-700"
              />
            </div>
          </CardContent>

          <CardFooter className="pt-4 border-t border-zinc-800/80 flex flex-col gap-2.5">
            <button
              type="submit"
              disabled={isPolling}
              className="w-full h-10 rounded-xl bg-white hover:bg-zinc-100 text-zinc-900 font-medium text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
            >
              {isPolling ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-zinc-900" />
                  Connecting to Cloud...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                  Continue with Google
                </span>
              )}
            </button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
