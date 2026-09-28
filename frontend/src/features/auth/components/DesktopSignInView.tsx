"use client";

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchAuthMe, AuthUser } from '@/services/auth';
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
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
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
  const handleCloudGoogleAuth = (hintEmail?: string) => {
    const cloudGatewayUrl = (process.env.NEXT_PUBLIC_GATEWAY_URL || "https://api.mash.ai").replace(/\/+$/, "");
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
    // Every login goes straight to Google OAuth and Cloud API
    handleCloudGoogleAuth(email.trim());
  };

  const handleForgotPassword = (e: React.MouseEvent) => {
    e.preventDefault();
    // Password management is handled by Google / Cloud
    handleCloudGoogleAuth(email.trim());
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#0a0a0c] text-white p-4 font-sans select-none">
      <Card className="w-full max-w-[400px] rounded-2xl bg-[#161618] border border-zinc-800/90 shadow-2xl py-6 gap-5">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-white">
            {isSignUp ? "Create an account" : "Login to your account"}
          </CardTitle>
          <CardDescription className="text-sm text-zinc-400 mt-1 leading-snug">
            {isSignUp 
              ? "Enter your email below to create your account" 
              : "Enter your email below to login to your account"}
          </CardDescription>
          <CardAction>
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setNoticeMsg(null);
              }}
              className="text-sm font-medium text-zinc-200 hover:text-white transition-colors cursor-pointer"
            >
              {isSignUp ? "Login" : "Sign Up"}
            </button>
          </CardAction>
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
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="m@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10 rounded-lg bg-[#1c1c1f] border-zinc-800 text-white placeholder:text-zinc-500 focus-visible:ring-1 focus-visible:ring-zinc-700"
              />
            </div>

            <div className="space-y-1.5 text-left">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium text-white">
                  Password
                </Label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-sm font-normal text-zinc-200 hover:text-white transition-colors cursor-pointer"
                >
                  Forgot your password?
                </button>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 rounded-lg bg-[#1c1c1f] border-zinc-800 text-white placeholder:text-zinc-500 focus-visible:ring-1 focus-visible:ring-zinc-700"
              />
            </div>
          </CardContent>

          <CardFooter className="pt-4 border-t border-zinc-800/80 flex flex-col gap-2.5">
            <button
              type="submit"
              className="w-full h-10 rounded-xl bg-[#e4e4e7] hover:bg-white text-zinc-900 font-medium text-sm transition-colors flex items-center justify-center cursor-pointer"
            >
              {isPolling ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-zinc-900" />
                  Connecting to Cloud...
                </span>
              ) : isSignUp ? (
                "Sign Up"
              ) : (
                "Login"
              )}
            </button>

            <button
              type="button"
              onClick={() => handleCloudGoogleAuth()}
              className="w-full h-10 rounded-xl bg-[#1c1c1f] hover:bg-[#252528] border border-zinc-800 text-white font-medium text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              {isPolling ? (
                <span className="flex items-center gap-2 text-zinc-400">
                  <Loader2 size={15} className="animate-spin text-zinc-400" />
                  Waiting for browser sign-in...
                </span>
              ) : (
                "Login with Google"
              )}
            </button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
