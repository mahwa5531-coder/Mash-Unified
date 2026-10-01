"use client";

import React, { useState, useRef } from "react";
import { Copy, Check, Download, Table as TableIcon } from "lucide-react";

// ----------------------------------------------------------------------
// Financial & Audit Workpaper Table Container for CAs, CPAs, and Auditors
// Supports: Copy to Excel (TSV), Export CSV, Zebra striping, Numeric alignment
// ----------------------------------------------------------------------
export default function TableContainer({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState<boolean>(false);
  const tableRef = useRef<HTMLTableElement>(null);

  const handleCopyTsv = () => {
    if (!tableRef.current) return;
    const rows = Array.from(tableRef.current.querySelectorAll("tr"));
    const tsv = rows
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("th, td"));
        return cells.map((c) => c.textContent?.trim() || "").join("\t");
      })
      .join("\n");

    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((err) => {
      console.warn("Failed to copy table TSV:", err);
    });
  };

  const handleDownloadCsv = () => {
    if (!tableRef.current) return;
    const rows = Array.from(tableRef.current.querySelectorAll("tr"));
    const csv = rows
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("th, td"));
        return cells
          .map((c) => {
            const text = (c.textContent?.trim() || "").replace(/"/g, '""');
            return `"${text}"`;
          })
          .join(",");
      })
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "audit_table.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-4 rounded-xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#111113] shadow-xs overflow-hidden group/table">
      {/* Table Action Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-zinc-50/50 dark:bg-white/[0.02] border-b border-zinc-200/70 dark:border-white/[0.06] text-xs text-zinc-500 select-none">
        <div className="flex items-center gap-1.5 font-medium text-[11px] text-zinc-600 dark:text-zinc-400">
          <TableIcon size={12} className="text-zinc-500 shrink-0" />
          <span>Table Data</span>
        </div>

        <div className="flex items-center gap-1 opacity-80 group-hover/table:opacity-100 transition-opacity">
          {/* Copy Table for Excel (TSV) */}
          <button
            type="button"
            onClick={handleCopyTsv}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Copy formatted table to paste into Microsoft Excel or Google Sheets"
          >
            {copied ? (
              <>
                <Check size={11} className="text-emerald-500 shrink-0" />
                <span className="text-emerald-500 font-medium">Copied</span>
              </>
            ) : (
              <>
                <Copy size={11} className="shrink-0" />
                <span>Copy for Excel</span>
              </>
            )}
          </button>

          {/* Export CSV */}
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Download table as .csv"
          >
            <Download size={11} className="shrink-0" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Scrollable Table Body */}
      <div className="overflow-x-auto select-text custom-scrollbar">
        <table
          ref={tableRef}
          className="w-full text-[12.5px] border-collapse [&_thead]:bg-zinc-100/90 dark:[&_thead]:bg-white/[0.06] [&_th]:bg-zinc-100/90 dark:[&_th]:bg-white/[0.06] [&_th]:border-b [&_th]:border-zinc-200 dark:[&_th]:border-white/[0.08] [&_th]:py-2.5 [&_th]:px-3.5 [&_th]:font-semibold [&_th]:text-zinc-800 dark:[&_th]:text-zinc-200 [&_th]:text-[11.5px] [&_th]:uppercase [&_th]:tracking-wider [&_tbody_tr]:bg-transparent [&_tbody_tr]:border-b [&_tbody_tr]:border-zinc-100 dark:[&_tbody_tr]:border-white/[0.04] [&_tbody_tr:last-child]:border-b-0 [&_tbody_tr]:hover:bg-zinc-50/50 dark:[&_tbody_tr]:hover:bg-white/[0.02] [&_tbody_tr]:transition-colors [&_td]:py-2.5 [&_td]:px-3.5 [&_td]:text-zinc-800 dark:[&_td]:text-zinc-200"
        >
          {children}
        </table>
      </div>
    </div>
  );
}
