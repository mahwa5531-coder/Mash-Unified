"use client";

import React, { useEffect, useRef, useState } from "react";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import { Loader2, AlertCircle } from "lucide-react";

interface UniverExcelViewerInnerProps {
  workbookData: any;
  filename: string;
  path?: string;
}

export default function UniverExcelViewerInner({
  workbookData,
  filename,
}: UniverExcelViewerInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    // Create a dedicated inner DOM node for Univer to mount its canvas and UI into
    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.position = "relative";
    container.style.overflow = "hidden";
    host.appendChild(container);

    let univerInstance: any = null;
    let isDisposed = false;

    try {
      const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

      // Initialize Univer with read-only viewer configuration
      const { univer, univerAPI } = createUniver({
        darkMode: isDark,
        locale: LocaleType.EN_US,
        locales: {
          [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS),
        },
        presets: [
          UniverSheetsCorePreset({
            container,
            header: false, // Hides top title header
            toolbar: false, // Hides formula ribbon & edit toolbar
            contextMenu: false, // Disables right click edit menu
            formulaBar: true, // Enables formula bar for cell coordinate & formula audit inspection
            footer: { sheetBar: true }, // Keeps sheet tabs visible at the bottom
          }),
        ],
      });

      univerInstance = univer;

      // Load pre-parsed workbook snapshot
      if (workbookData && Object.keys(workbookData).length > 0) {
        univerAPI.createWorkbook(workbookData);

        // Enforce view-only restrictions
        try {
          const activeWb = univerAPI.getActiveWorkbook();
          if (activeWb) {
            const perm = activeWb.getWorkbookPermission?.();
            if (perm && typeof perm.setReadOnly === "function") {
              perm.setReadOnly();
            }
          }
        } catch {
          // Non-critical: core UI toolbar/formulaBar are already hidden
        }
      }

      setIsInitializing(false);
    } catch (err: any) {
      if (!isDisposed) {
        console.error("Failed to initialize Univer:", err);
        setError(err?.message || "Failed to initialize spreadsheet canvas.");
        setIsInitializing(false);
      }
    }

    return () => {
      isDisposed = true;
      if (univerInstance) {
        try {
          univerInstance.dispose();
        } catch (e) {
          console.warn("Univer disposal warning:", e);
        }
      }
      try {
        if (container.parentNode === host) {
          host.removeChild(container);
        }
      } catch {}
    };
  }, [workbookData, filename]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center text-red-500">
        <AlertCircle size={28} className="mb-2" />
        <p className="text-xs font-semibold">Error rendering spreadsheet in Univer</p>
        <p className="text-[11px] text-zinc-500 mt-1 max-w-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative overflow-hidden bg-white dark:bg-[#121212] flex flex-col">
      {isInitializing && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/75 dark:bg-[#121212]/75 backdrop-blur-[2px]">
          <Loader2 size={24} className="animate-spin text-emerald-500 mb-2" />
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Rendering Excel Canvas...
          </span>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full flex-1 relative overflow-hidden" />
    </div>
  );
}
