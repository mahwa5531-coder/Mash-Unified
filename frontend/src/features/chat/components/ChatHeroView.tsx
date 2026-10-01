"use client";

import React from 'react';
import { Sparkles } from 'lucide-react';

export function ChatHeroView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center my-auto py-24 select-none opacity-90 mt-16">
      <div className="w-12 h-12 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center mb-5 text-[var(--accent)] shadow-md">
        <Sparkles size={22} />
      </div>
      <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2 tracking-tight">MASH Statutory Audit AI</h2>
      <p className="text-[13.5px] text-[var(--text-secondary)] max-w-md leading-relaxed">
        Specialized in Indian Statutory Audit, CA Firm Workpapers, Benford's Law, Monetary Unit Sampling, and Data Analytics.
      </p>
    </div>
  );
}
