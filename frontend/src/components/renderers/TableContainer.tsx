"use client";

import React from "react";

// ----------------------------------------------------------------------
// Clean Table Container for Chat & Markdown Viewers
// Zero clutter: stripped header layer, pure scrollable responsive table
// ----------------------------------------------------------------------
export default function TableContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 rounded-lg border border-zinc-200 dark:border-white/[0.08] overflow-hidden bg-white dark:bg-[#111113]">
      <div className="overflow-x-auto select-text custom-scrollbar">
        <table className="w-full text-[12.5px] border-collapse [&_thead]:bg-zinc-100/90 dark:[&_thead]:bg-white/[0.06] [&_th]:bg-zinc-100/90 dark:[&_th]:bg-white/[0.06] [&_th]:border-b [&_th]:border-zinc-200 dark:[&_th]:border-white/[0.08] [&_th]:py-2 [&_th]:px-3.5 [&_th]:font-semibold [&_th]:text-zinc-800 dark:[&_th]:text-zinc-200 [&_th]:text-[11.5px] [&_th]:uppercase [&_th]:tracking-wider [&_tbody_tr]:bg-transparent [&_tbody_tr]:border-b [&_tbody_tr]:border-zinc-100 dark:[&_tbody_tr]:border-white/[0.04] [&_tbody_tr:last-child]:border-b-0 [&_tbody_tr]:hover:bg-zinc-50/50 dark:[&_tbody_tr]:hover:bg-white/[0.02] [&_tbody_tr]:transition-colors [&_td]:py-2 [&_td]:px-3.5 [&_td]:text-zinc-800 dark:[&_td]:text-zinc-200">
          {children}
        </table>
      </div>
    </div>
  );
}
