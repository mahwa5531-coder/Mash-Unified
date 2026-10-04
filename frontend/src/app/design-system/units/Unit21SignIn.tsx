"use client";

import React, { useState } from 'react';
import DesktopSignInView from '@/features/auth/components/DesktopSignInView';

export function Unit21SignIn() {
  const [authResult, setAuthResult] = useState<string | null>(null);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">21</span>
          <span>Desktop Sign-In View (`&lt;DesktopSignInView /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/features/auth/components/DesktopSignInView.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed space-y-1">
          <div><strong className="text-[var(--m-text-primary)]">Minimal Clean Sign-In Flow:</strong> Zero top logo, centered heading, royal blue Google button, dark business account button, and bottom workflow controls.</div>
          <div className="text-[11.5px] font-mono text-zinc-400">
            • <strong>Continue with Google</strong>: Opens browser Google OAuth and initiates background loopback polling.
            <br />
            • <strong>Previous</strong>: Instantly cancels pending authorization / SSO inputs and resets view back to fresh sign-in.
            <br />
            • <strong>Next</strong>: Disabled by default; lights up white once authenticated to enter the audit workspace.
          </div>
        </div>

        {authResult && (
          <div className="p-3 text-xs rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono">
            ✓ Authenticated successfully: {authResult}
          </div>
        )}

        {/* Embedded Interactive Container matching dark window frame */}
        <div className="rounded-2xl border border-[var(--m-border-subtle)] overflow-hidden bg-[#0e0e11] shadow-2xl">
          <DesktopSignInView
            className="min-h-[520px] py-12"
            onAuthSuccess={(user) => {
              setAuthResult(user.email || user.name || 'auditor@firm.com');
            }}
          />
        </div>
      </div>
    </section>
  );
}
