"use client";

import React from "react";

// ----------------------------------------------------------------------
// Clean Table Container for Chat & Markdown Viewers
// Pure minimalist responsive table matching useAgentMarkdownComponents
// Zero outer card box, subtle vertical hairlines, responsive horizontal scroll
// ----------------------------------------------------------------------
export default function TableContainer({ children }: { children?: React.ReactNode }) {
  return (
    <div className="my-3 overflow-x-auto select-text custom-scrollbar max-w-full rounded-lg border border-zinc-200/80 dark:border-white/[0.08] shadow-2xs">
      <table className="min-w-full w-max text-[13px] border-collapse bg-white dark:bg-[#141416] [&_thead]:bg-zinc-100/90 dark:[&_thead]:bg-zinc-800/70 [&_thead]:border-b [&_thead]:border-zinc-300 dark:[&_thead]:border-white/[0.12] [&_th]:py-2.5 [&_th]:px-3.5 [&_th]:font-semibold [&_th]:text-zinc-700 dark:[&_th]:text-zinc-300 [&_th]:text-[11.5px] [&_th]:uppercase [&_th]:tracking-wider [&_th]:border-r [&_th]:border-zinc-200 dark:[&_th]:border-white/[0.08] [&_th:last-child]:border-r-0 [&_tbody]:divide-y [&_tbody]:divide-zinc-200/70 dark:[&_tbody]:divide-white/[0.06] [&_tbody_tr]:hover:bg-zinc-50/80 dark:[&_tbody_tr]:hover:bg-white/[0.03] [&_tbody_tr]:transition-colors [&_td]:border-r [&_td]:border-zinc-200/50 dark:[&_td]:border-white/[0.05] [&_td:last-child]:border-r-0 [&_td]:py-2 [&_td]:px-3.5 [&_td]:tabular-nums">
        {children}
      </table>
    </div>
  );
}
