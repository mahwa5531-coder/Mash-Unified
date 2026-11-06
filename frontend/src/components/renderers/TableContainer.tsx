"use client";

import React, { useMemo } from "react";

// ----------------------------------------------------------------------
// Clean Table Container for Chat & Markdown Viewers
// Pure minimalist responsive table matching useAgentMarkdownComponents
// Zero outer card box, subtle vertical hairlines, responsive horizontal scroll
// In chat mode: sticky headers with generous max-height ceiling (up to ~50 rows fit naturally)
// so normal and medium tables render fully in chat without inner scroll traps, while massive datasets roll cleanly.
// Table body matches the dark chat backdrop (--bg-app / #09090b) so the elevated
// sticky header ribbon (#1c1c1f) creates a distinct, crisp contrast.
// In document mode: uncapped full height for natural document reading.
// ----------------------------------------------------------------------
export default function TableContainer({ 
  children,
  isChat = false,
}: { 
  children?: React.ReactNode;
  isChat?: boolean;
}) {
  const keyedChildren = useMemo(() => {
    return React.Children.map(children, (child, idx) => {
      if (React.isValidElement(child) && !child.key) {
        return React.cloneElement(child, { key: `tbl_child_${idx}` } as any);
      }
      return child;
    });
  }, [children]);

  return (
    <div className={`my-3 overflow-x-auto select-text custom-scrollbar max-w-full rounded-lg border border-zinc-200/80 dark:border-white/[0.08] shadow-2xs bg-white dark:bg-[var(--bg-app)] ${isChat ? 'max-h-[1850px] overflow-y-auto' : ''}`}>
      <table className="w-full min-w-full text-[13.5px] border-collapse bg-transparent dark:bg-[var(--bg-app)] [&_thead]:border-b [&_thead]:border-zinc-300 dark:[&_thead]:border-white/[0.12] [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-zinc-100 dark:[&_th]:bg-[#1c1c1f] [&_th]:py-2.5 [&_th]:px-3.5 [&_th]:font-semibold [&_th]:text-zinc-900 dark:[&_th]:text-zinc-100 [&_th]:text-[13.5px] [&_th]:border-r [&_th]:border-zinc-200 dark:[&_th]:border-white/[0.08] [&_th:last-child]:border-r-0 [&_tbody]:divide-y [&_tbody]:divide-zinc-200/70 dark:[&_tbody]:divide-white/[0.06] [&_tbody_tr]:hover:bg-zinc-50/80 dark:[&_tbody_tr]:hover:bg-white/[0.03] [&_tbody_tr]:transition-colors [&_td]:border-r [&_td]:border-zinc-200/50 dark:[&_td]:border-white/[0.05] [&_td:last-child]:border-r-0 [&_td]:py-2.5 [&_td]:px-3.5 [&_td]:tabular-nums">
        {keyedChildren}
      </table>
    </div>
  );
}
