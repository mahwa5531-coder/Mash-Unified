"use client";

import { useState, useEffect, useRef, useId } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw, RefreshCw, AlertCircle } from "lucide-react";
import { useIsDarkMode } from "@/hooks/useIsDarkMode";
import { useTurnViewport } from "@/features/chat/context/TurnViewportContext";

interface MermaidRendererProps {
  chart: string;
  isStreaming?: boolean;
}

export function sanitizeSvg(svg: string): string {
  if (!svg) return "";
  return svg
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "")
    .replace(/href\s*=\s*(?:'javascript:[^']*'|"javascript:[^"]*")/gi, 'href="#"');
}

// Module-level Mermaid singleton loader and active theme tracking
let mermaidModulePromise: Promise<any> | null = null;
let activeTheme: "dark" | "default" | null = null;

// Sequential rendering queue to eliminate concurrent DOM layout collisions
let renderQueue: Promise<unknown> = Promise.resolve();

function enqueueRender<T>(fn: () => Promise<T>): Promise<T> {
  const next = renderQueue.then(fn, fn);
  renderQueue = next.then(
    () => {},
    () => {}
  );
  return next;
}

// Global orphan cleanup to sweep temporary DOM measurement nodes
function sweepMermaidOrphans(renderId?: string) {
  if (typeof document === "undefined") return;
  try {
    if (renderId) {
      document.getElementById(renderId)?.remove();
      document.getElementById(`d${renderId}`)?.remove();
    }
    // Sweep any dangling scratch sandbox divs created by Mermaid layout calculations
    const orphans = document.querySelectorAll('div[id^="dmermaid_"]');
    orphans.forEach((el) => el.remove());
  } catch {}
}

async function getInitializedMermaid(isDark: boolean) {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid").then((m) => m.default || m);
  }
  const mermaid = await mermaidModulePromise;

  const targetTheme = isDark ? "dark" : "default";
  if (activeTheme !== targetTheme) {
    mermaid.initialize({
      startOnLoad: false,
      theme: targetTheme,
      securityLevel: "strict",
      fontFamily: "inherit",
      themeVariables: {
        darkMode: isDark,
        background: isDark ? "#181818" : "#FFFFFF",
        primaryColor: isDark ? "#1e293b" : "#e0f2fe",
        primaryTextColor: isDark ? "#CCCCCC" : "#101010",
        primaryBorderColor: "#007ACC",
        lineColor: isDark ? "#858585" : "#6E6E6E",
        secondaryColor: isDark ? "#222222" : "#F9F9F9",
        tertiaryColor: isDark ? "#2A2A2A" : "#EFEFEF",
      },
    });
    activeTheme = targetTheme;
  }
  return mermaid;
}

// Auto-repair common LLM Mermaid syntax flaws
export function repairMermaidSyntax(raw: string): string {
  if (!raw) return "";
  let cleaned = raw
    .replace(/```(?:mermaid)?/gi, "")
    .replace(/```/g, "")
    .trim();

  // 1. Replace C/C++ style // comments with Mermaid %% comments
  cleaned = cleaned.replace(/^\s*\/\/(.*)$/gm, "%%$1");

  // 2. Remove trailing dangling connectors (e.g. "A --> " at end of line)
  cleaned = cleaned.replace(/(-->|---|==>|-\.->|--\s*\|[^|]*\|\s*-->?)\s*$/gm, "");

  // 3. Auto-detect missing diagram declaration (e.g. LLM directly outputs "Client --> Server")
  const nonCommentLines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("%%"));
  if (nonCommentLines.length > 0) {
    const firstLine = nonCommentLines[0].toLowerCase();
    const validHeaders = [
      "graph",
      "flowchart",
      "sequencediagram",
      "classdiagram",
      "statediagram",
      "erdiagram",
      "gantt",
      "pie",
      "gitgraph",
      "journey",
      "mindmap",
      "quadrantchart",
      "timeline",
      "zenuml",
      "sankey-beta",
      "xychart-beta",
      "block-beta",
      "architecture-beta",
    ];
    if (!validHeaders.some((h) => firstLine.startsWith(h))) {
      cleaned = "flowchart TD\n" + cleaned;
    }
  }

  // 4. Fix arrows pointing directly into bracket without node id (e.g. "Z -->[Complete]")
  let autoId = 1;
  cleaned = cleaned.replace(/(-->|---|==>|-\.->)\s*\[([^"\]\n]+)\]/g, (_, arrow, inner) => {
    return `${arrow} n_${autoId++}["${inner.replace(/"/g, "'").trim()}"]`;
  });

  // 5. Ensure bracket labels [...] containing special characters ()[]&:$#/\ are safely quoted
  cleaned = cleaned.replace(/\[([^"\]\n]+)\]/g, (match, inner) => {
    if (/[()&:$#\/]|[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(inner)) {
      const escaped = inner.replace(/"/g, "'").trim();
      return `["${escaped}"]`;
    }
    return match;
  });

  // 6. Ensure parenthesis labels (...) containing special characters are safely quoted
  cleaned = cleaned.replace(/\(([^"()\n]+)\)/g, (match, inner) => {
    if (/[\[\]&:$#\/]/.test(inner)) {
      const escaped = inner.replace(/"/g, "'").trim();
      return `("${escaped}")`;
    }
    return match;
  });

  return cleaned;
}

// Fallback aggressive repair pass for diagrams that fail initial parse
export function fallbackSanitize(chart: string): string {
  // Convert flowchart to graph for looser edge parsing
  let s = chart.replace(/\bflowchart\b/i, "graph");
  s = s.replace(/\[([^\]]*?)\]/g, (match, inner) => {
    if (inner.includes('"')) {
      const stripped = inner.replace(/^"|"$/g, "").replace(/"/g, "'");
      return `["${stripped}"]`;
    }
    return match;
  });
  return s;
}

const LAYOUT_TIMEOUT_MS = 6000;

export default function MermaidRenderer({ chart, isStreaming = false }: MermaidRendererProps) {
  const [svgContent, setSvgContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [retryKey, setRetryKey] = useState<number>(0);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalZoom, setModalZoom] = useState<number>(1);
  const isDark = useIsDarkMode();
  const { isNearViewport } = useTurnViewport();
  const uniqueId = useId().replace(/[^a-zA-Z0-9]/g, "_");
  const renderCountRef = useRef<number>(0);

  useEffect(() => {
    // ponytail: Defer Mermaid layout calculation until within viewport or already rendered
    if (!isNearViewport && !svgContent) return;

    let isMounted = true;
    renderCountRef.current += 1;
    const renderId = `mermaid_${uniqueId}_${renderCountRef.current}`;
    let abortTimer: NodeJS.Timeout | null = null;

    async function renderChart() {
      if (!chart.trim()) return;
      setLoading(true);
      setError(null);

      try {
        await enqueueRender(async () => {
          if (!isMounted) return;
          const mermaid = await getInitializedMermaid(isDark);
          sweepMermaidOrphans(renderId);

          const repairedChart = repairMermaidSyntax(chart);

          // 6-second timeout race to prevent infinite hanging on dagre layout loops
          const timeoutPromise = new Promise<never>((_, reject) => {
            abortTimer = setTimeout(() => {
              reject(new Error("Diagram layout timed out (exceeded 6s threshold)"));
            }, LAYOUT_TIMEOUT_MS);
          });

          const renderPromise = (async () => {
            try {
              return await mermaid.render(renderId, repairedChart);
            } catch (firstErr) {
              // Attempt self-healing fallback pass before failing
              sweepMermaidOrphans(renderId);
              const fallbackChart = fallbackSanitize(repairedChart);
              return await mermaid.render(renderId, fallbackChart);
            }
          })();

          const { svg } = await Promise.race([renderPromise, timeoutPromise]);
          if (abortTimer) clearTimeout(abortTimer);

          if (isMounted) {
            setSvgContent(svg);
            setError(null);
            setLoading(false);
          }
        });
      } catch (err: any) {
        if (abortTimer) clearTimeout(abortTimer);
        sweepMermaidOrphans(renderId);
        console.warn("Mermaid render error:", err);

        if (isMounted) {
          setError(err?.message || "Failed to render diagram");
          setLoading(false);
        }
      }
    }

    renderChart();

    return () => {
      isMounted = false;
      if (abortTimer) clearTimeout(abortTimer);
      sweepMermaidOrphans(renderId);
    };
  }, [chart, isDark, uniqueId, isNearViewport, retryKey]);

  // Handle escape key to close modal
  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsModalOpen(false);
        setModalZoom(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isModalOpen]);

  if (error) {
    if (isStreaming) {
      return (
        <div className="my-2 p-2.5 bg-muted/30 border border-border/50 rounded-lg text-xs font-mono text-muted-foreground flex items-center gap-2 select-none">
          <span className="w-3 h-3 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
          <span>Generating diagram...</span>
        </div>
      );
    }
    return (
      <div className="my-2 rounded-lg border border-amber-500/20 bg-amber-500/5 dark:bg-amber-950/20 p-3 text-xs font-mono">
        <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-amber-500/10 text-amber-600 dark:text-amber-400">
          <div className="flex items-center gap-1.5">
            <AlertCircle size={14} />
            <span className="font-semibold text-[11px] uppercase tracking-wider">Mermaid Syntax Preview</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError(null);
              setRetryKey((k) => k + 1);
            }}
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-amber-500/30 hover:bg-amber-500/10 transition-colors cursor-pointer text-amber-600 dark:text-amber-300"
            title="Retry diagram render"
          >
            <RefreshCw size={11} />
            <span>Retry</span>
          </button>
        </div>
        <pre className="whitespace-pre-wrap text-foreground/80 overflow-x-auto text-[11px] leading-relaxed">
          {chart}
        </pre>
      </div>
    );
  }

  return (
    <>
      {/* Inline Naked Diagram Container */}
      <div
        onClick={() => {
          if (!loading && svgContent) {
            setIsModalOpen(true);
            setModalZoom(1);
          }
        }}
        title="Click to expand diagram"
        className="my-3 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#111113] p-4 flex justify-center items-center overflow-x-auto cursor-pointer hover:border-zinc-300 dark:hover:border-white/[0.16] transition-all group/mermaid"
      >
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-mono py-4 select-none">
            {isNearViewport ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
                <span>Rendering diagram...</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-zinc-400/60" />
                <span>Diagram deferred</span>
              </>
            )}
          </div>
        )}

        {!loading && svgContent && (
          <div
            className="w-full flex justify-center items-center select-none"
            dangerouslySetInnerHTML={{ __html: sanitizeSvg(svgContent) }}
          />
        )}
      </div>

      {/* Enlarged Modal Window ("su window") */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setIsModalOpen(false);
            setModalZoom(1);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 sm:p-8 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden"
          >
            {/* Modal Header Bar with Close Button in Corner */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 text-xs select-none">
              <span className="font-sans font-medium text-foreground">Diagram View</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setModalZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(1)))}
                  className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="font-mono text-[11px] text-muted-foreground px-1 select-none">
                  {Math.round(modalZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setModalZoom((z) => Math.min(3, +(z + 0.2).toFixed(1)))}
                  className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setModalZoom(1)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors cursor-pointer"
                  title="Reset Zoom"
                >
                  <RotateCcw size={13} />
                </button>
                <div className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-800 mx-1" />
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setModalZoom(1);
                  }}
                  className="p-1 rounded-md text-zinc-500 hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  title="Close (Esc)"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Body with Enlarged SVG */}
            <div className="flex-1 overflow-auto p-6 flex items-center justify-center custom-scrollbar">
              <div
                style={{
                  transform: `scale(${modalZoom})`,
                  transformOrigin: "center",
                  transition: "transform 0.15s ease",
                }}
                className="max-w-full flex justify-center items-center select-none"
                dangerouslySetInnerHTML={{ __html: sanitizeSvg(svgContent) }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
