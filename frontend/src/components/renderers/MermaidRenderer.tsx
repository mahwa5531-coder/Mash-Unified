"use client";

import { useState, useEffect, useRef, useId } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

interface MermaidRendererProps {
  chart: string;
  isStreaming?: boolean;
}

function sanitizeSvg(svg: string): string {
  if (!svg) return '';
  return svg
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*(?:'javascript:[^']*'|"javascript:[^"]*")/gi, 'href="#"');
}

// auto-repair common LLM Mermaid syntax flaws (unquoted parentheses, special chars, dangling arrows)
function repairMermaidSyntax(raw: string): string {
  if (!raw) return '';
  let cleaned = raw
    .replace(/```mermaid/gi, '')
    .replace(/```/g, '')
    .trim();

  // 1. Remove trailing dangling connectors (e.g. "A --> " at end of line)
  cleaned = cleaned.replace(/(-->|--\s*\|[^|]*\|\s*-->?)\s*$/gm, '');

  // 1b. Fix arrows pointing directly into bracket without node id (e.g. "Z -->[✅ Complete Answer]")
  let autoId = 1;
  cleaned = cleaned.replace(/(-->|---|==>)\s*\[([^"\]\n]+)\]/g, (_, arrow, inner) => {
    return `${arrow} n_${autoId++}["${inner.replace(/"/g, "'").trim()}"]`;
  });

  // 2. Ensure unquoted bracket labels [...] containing special characters ()[]&:$# are safely quoted
  cleaned = cleaned.replace(/\[([^"\]\n]+)\]/g, (match, inner) => {
    if (/[()&:$#\/]|[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(inner)) {
      const escaped = inner.replace(/"/g, "'").trim();
      return `["${escaped}"]`;
    }
    return match;
  });

  // 3. Ensure unquoted parenthesis labels (...) containing special characters are safely quoted
  cleaned = cleaned.replace(/\(([^"()\n]+)\)/g, (match, inner) => {
    if (/[\[\]&:$#\/]/.test(inner)) {
      const escaped = inner.replace(/"/g, "'").trim();
      return `("${escaped}")`;
    }
    return match;
  });

  return cleaned;
}

export default function MermaidRenderer({ chart, isStreaming = false }: MermaidRendererProps) {
  const [svgContent, setSvgContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalZoom, setModalZoom] = useState<number>(1);
  const uniqueId = useId().replace(/[^a-zA-Z0-9]/g, "_");
  const chartIdRef = useRef<string>(`mermaid_${uniqueId}`);

  useEffect(() => {
    let isMounted = true;

    async function renderChart() {
      if (!chart.trim()) return;
      setLoading(true);
      setError(null);

      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default || mermaidModule;

        const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? "dark" : "default",
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

        const repairedChart = repairMermaidSyntax(chart);
        const id = chartIdRef.current;

        const { svg } = await mermaid.render(id, repairedChart);
        if (isMounted) {
          setSvgContent(svg);
          setError(null);
          setLoading(false);
        }
      } catch (err: any) {
        console.warn("Mermaid render error:", err);
        try {
          const id = chartIdRef.current;
          const orphan = document.getElementById(id);
          if (orphan) orphan.remove();
          const dOrphan = document.getElementById(`d${id}`);
          if (dOrphan) dOrphan.remove();
        } catch {}

        if (isMounted) {
          setError(err?.message || "Failed to render diagram");
          setLoading(false);
        }
      }
    }

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [chart]);

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
      <div className="my-2 p-3 rounded-lg border border-rose-500/20 bg-rose-500/5 text-xs font-mono text-rose-500 whitespace-pre-wrap">
        {chart}
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
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-mono py-4">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
            <span>Rendering diagram...</span>
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
