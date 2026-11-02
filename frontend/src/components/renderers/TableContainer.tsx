"use client";

import React from "react";

// ----------------------------------------------------------------------
// Clean Table Container for Chat & Markdown Viewers
// Pure minimalist responsive table matching useAgentMarkdownComponents
// Zero outer card box, subtle vertical hairlines, responsive horizontal scroll
// ----------------------------------------------------------------------
export default function TableContainer({ children }: { children?: React.ReactNode }) {
  return (
    <div className="my-3 overflow-x-auto select-text custom-scrollbar">
      <table className="w-full text-[13px] border-collapse [&_thead]:border-b [&_thead]:border-zinc-200 dark:[&_thead]:border-white/[0.1] [&_thead]:bg-zinc-50/50 dark:[&_thead]:bg-white/[0.02] [&_th]:border-b [&_th]:border-zinc-200 dark:[&_th]:border-white/[0.08] [&_th]:border-r [&_th]:border-zinc-200/60 dark:[&_th]:border-white/[0.05] [&_th:last-child]:border-r-0 [&_th]:py-2 [&_th]:px-3.5 [&_th]:font-semibold [&_th]:text-zinc-900 dark:[&_th]:text-zinc-100 [&_th]:text-[12px] [&_th]:uppercase [&_th]:tracking-wider [&_tbody]:divide-y [&_tbody]:divide-zinc-200/60 dark:[&_tbody]:divide-white/[0.06] [&_tbody_tr]:hover:bg-zinc-50/50 dark:[&_tbody_tr]:hover:bg-white/[0.02] [&_tbody_tr]:transition-colors [&_td]:border-r [&_td]:border-zinc-200/40 dark:[&_td]:border-white/[0.04] [&_td:last-child]:border-r-0 [&_td]:py-2 [&_td]:px-3.5 [&_td]:tabular-nums [&_td]:text-zinc-900 dark:[&_td]:text-zinc-100">
        {children}
      </table>
    </div>
  );
}
