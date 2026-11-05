"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut, RotateCcw, RefreshCw, AlertCircle } from "lucide-react";
import Panzoom, { type PanzoomObject } from "@panzoom/panzoom";
import { useTurnViewport } from "@/features/chat/context/TurnViewportContext";
import { cn } from "@/lib/utils";

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

  // 5. Safely preserve and quote compound Mermaid shapes before general brackets
  // Cylinder/Database: [("...")] or [(...)]
  cleaned = cleaned.replace(/\[\(\s*"?([^"\n]*?)"?\s*\)\]/g, (_, inner) => {
    return `[("${inner.trim()}")]`;
  });

  // Stadium: (["..."]) or ([...])
  cleaned = cleaned.replace(/\(\[\s*"?([^"\n]*?)"?\s*\]\)/g, (_, inner) => {
    return `(["${inner.trim()}"])`;
  });

  // Subroutine: [["..."]] or [[...]]
  cleaned = cleaned.replace(/\[\[\s*"?([^"\n]*?)"?\s*\]\]/g, (_, inner) => {
    return `[["${inner.trim()}"]]`;
  });

  // Circle: (("...")) or ((...))
  cleaned = cleaned.replace(/\(\(\s*"?([^"\n]*?)"?\s*\)\)/g, (_, inner) => {
    return `(("${inner.trim()}"))`;
  });

  // Rhombus/Diamond: {"..."} or {...}
  cleaned = cleaned.replace(/\{\s*"?([^"{}\n]*?)"?\s*\}/g, (_, inner) => {
    return `{"${inner.trim()}"}`;
  });

  // 6. Ensure simple bracket labels [...] containing special characters ()[]&:$#/ are safely quoted
  cleaned = cleaned.replace(/\[([^"\]\n]+)\]/g, (match, inner) => {
    // Preserve compound shapes like [("...")]
    if (inner.startsWith("(") && inner.endsWith(")")) return match;
    if (/[()&:$#\/]|[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(inner)) {
      const escaped = inner.replace(/"/g, "'").trim();
      return `["${escaped}"]`;
    }
    return match;
  });

  // 7. Ensure simple parenthesis labels (...) containing special characters are safely quoted
  cleaned = cleaned.replace(/\(([^"()\n]+)\)/g, (match, inner) => {
    if (inner.startsWith("[") && inner.endsWith("]")) return match;
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

// Lazy singleton loader for Pele engine
let pelePromise: Promise<typeof import("pele")> | null = null;
function getPele() {
  if (!pelePromise) {
    pelePromise = import("pele");
  }
  return pelePromise;
}

export default function MermaidRenderer({ chart, isStreaming = false }: MermaidRendererProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [retryKey, setRetryKey] = useState<number>(0);
  const [isRendered, setIsRendered] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalZoomPercent, setModalZoomPercent] = useState<number>(100);

  const { isNearViewport } = useTurnViewport();

  const inlineContainerRef = useRef<HTMLDivElement>(null);
  const inlineMountedRef = useRef<{ destroy: () => void } | null>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const modalDiagramRef = useRef<HTMLDivElement>(null);
  const modalMountedRef = useRef<any>(null);
  const panzoomRef = useRef<PanzoomObject | null>(null);
  const fitScaleRef = useRef<number>(1);
  const cleanupListenersRef = useRef<(() => void) | null>(null);

  // Mount inline static diagram (strictly no zoom gestures to prevent chat scroll traps)
  useEffect(() => {
    // Defer diagram rendering until within viewport (unless already loaded)
    if (!isNearViewport && !isRendered) return;

    let isCancelled = false;
    const trimmed = chart?.trim() || "";
    if (!trimmed) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    getPele().then((pele) => {
      if (isCancelled || !inlineContainerRef.current) return;

      inlineMountedRef.current?.destroy();
      inlineMountedRef.current = null;

      let sourceToMount = trimmed;
      if (!pele.detectType(sourceToMount) && (sourceToMount.includes("-->") || sourceToMount.includes("---"))) {
        sourceToMount = "flowchart TD\n" + sourceToMount;
      }

      try {
        inlineMountedRef.current = pele.mount(inlineContainerRef.current, sourceToMount, {
          zoom: false, // strictly disabled in chat stream: 2-finger touchpad scrolls message transcript naturally
          links: false,
          images: false,
          onError: (err) => {
            if (isCancelled) return;
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
          },
        });
        if (!isCancelled) {
          setIsRendered(true);
          setLoading(false);
        }
      } catch {
        try {
          const repaired = repairMermaidSyntax(sourceToMount);
          inlineMountedRef.current = pele.mount(inlineContainerRef.current, repaired, {
            zoom: false,
            links: false,
            images: false,
            onError: (err) => {
              if (isCancelled) return;
              setError(err instanceof Error ? err.message : String(err));
              setLoading(false);
            },
          });
          if (!isCancelled) {
            setIsRendered(true);
            setLoading(false);
          }
        } catch (finalErr: any) {
          if (!isCancelled) {
            console.warn("Pele diagram render error:", finalErr);
            setError(finalErr?.message || "Failed to render diagram");
            setLoading(false);
          }
        }
      }
    }).catch((err) => {
      if (!isCancelled) {
        setError(err?.message || "Failed to load diagram engine");
        setLoading(false);
      }
    });

    return () => {
      isCancelled = true;
      inlineMountedRef.current?.destroy();
      inlineMountedRef.current = null;
    };
  }, [chart, isNearViewport, isRendered, retryKey]);

  // Mount modal lightbox diagram powered by @panzoom/panzoom (infinite canvas, wheel zoom, pinch, 2D fit)
  useEffect(() => {
    if (!isModalOpen) {
      cleanupListenersRef.current?.();
      cleanupListenersRef.current = null;
      panzoomRef.current?.destroy();
      panzoomRef.current = null;
      modalMountedRef.current?.destroy();
      modalMountedRef.current = null;
      return;
    }

    let isCancelled = false;
    const trimmed = chart?.trim() || "";
    if (!trimmed) return;

    getPele().then((pele) => {
      if (isCancelled || !modalDiagramRef.current || !modalContainerRef.current) return;

      cleanupListenersRef.current?.();
      cleanupListenersRef.current = null;
      panzoomRef.current?.destroy();
      panzoomRef.current = null;
      modalMountedRef.current?.destroy();
      modalMountedRef.current = null;

      let sourceToMount = trimmed;
      if (!pele.detectType(sourceToMount) && (sourceToMount.includes("-->") || sourceToMount.includes("---"))) {
        sourceToMount = "flowchart TD\n" + sourceToMount;
      }

      const mountModalInstance = (src: string) => {
        return pele.mount(modalDiagramRef.current!, src, {
          zoom: false, // Pele renders pure SVG; Panzoom owns 100% of gestures & canvas transformations
          links: false,
          images: false,
          onError: (err) => console.warn("Modal Pele diagram error:", err),
        });
      };

      try {
        modalMountedRef.current = mountModalInstance(sourceToMount);
      } catch {
        try {
          modalMountedRef.current = mountModalInstance(repairMermaidSyntax(sourceToMount));
        } catch (modalErr) {
          console.warn("Failed to mount diagram in modal:", modalErr);
          return;
        }
      }

      if (isCancelled || !modalDiagramRef.current || !modalContainerRef.current) return;

      const container = modalContainerRef.current;
      const diagramEl = modalDiagramRef.current;

      // Wire @panzoom/panzoom with canvas mode for infinite drag & pan
      const panzoom = Panzoom(diagramEl, {
        canvas: true,
        minScale: 0.1,
        maxScale: 6,
        cursor: "grab",
      });
      panzoomRef.current = panzoom;

      // 2D Auto-Fit: fit both width and height within container viewport
      const svgEl = diagramEl.querySelector("svg");
      if (svgEl) {
        const svgRect = svgEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const padding = 64;
        const availW = Math.max(100, containerRect.width - padding);
        const availH = Math.max(100, containerRect.height - padding);
        const naturalW = svgRect.width || parseFloat(svgEl.getAttribute("width") || "1") || 1;
        const naturalH = svgRect.height || parseFloat(svgEl.getAttribute("height") || "1") || 1;
        const fitScale = Math.min(availW / naturalW, availH / naturalH, 1);
        fitScaleRef.current = fitScale;

        panzoom.zoom(fitScale, { animate: false });
        setModalZoomPercent(Math.round(fitScale * 100));
      } else {
        fitScaleRef.current = 1;
        setModalZoomPercent(100);
      }

      // Natural mouse wheel zooming to cursor focal point
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        panzoom.zoomWithWheel(e, { step: 0.15 });
      };
      container.addEventListener("wheel", onWheel, { passive: false });

      // Real-time zoom percentage tracking via native panzoomchange event
      const onPanzoomChange = (e: any) => {
        if (e?.detail?.scale) {
          setModalZoomPercent(Math.round(e.detail.scale * 100));
        }
      };
      diagramEl.addEventListener("panzoomchange", onPanzoomChange);

      // Keyboard escape
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setIsModalOpen(false);
        }
      };
      window.addEventListener("keydown", onKeyDown);

      cleanupListenersRef.current = () => {
        container.removeEventListener("wheel", onWheel);
        diagramEl.removeEventListener("panzoomchange", onPanzoomChange);
        window.removeEventListener("keydown", onKeyDown);
      };
    });

    return () => {
      isCancelled = true;
      cleanupListenersRef.current?.();
      cleanupListenersRef.current = null;
      panzoomRef.current?.destroy();
      panzoomRef.current = null;
      modalMountedRef.current?.destroy();
      modalMountedRef.current = null;
    };
  }, [isModalOpen, chart]);

  const handleZoomIn = useCallback(() => {
    panzoomRef.current?.zoomIn({ step: 0.25 });
  }, []);

  const handleZoomOut = useCallback(() => {
    panzoomRef.current?.zoomOut({ step: 0.25 });
  }, []);

  const handleResetZoom = useCallback(() => {
    if (panzoomRef.current) {
      panzoomRef.current.reset({ animate: true });
      if (fitScaleRef.current) {
        panzoomRef.current.zoom(fitScaleRef.current, { animate: true });
        setModalZoomPercent(Math.round(fitScaleRef.current * 100));
      }
    }
  }, []);

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
          if (!loading && !error) {
            setIsModalOpen(true);
            setModalZoomPercent(100);
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

        <div
          ref={inlineContainerRef}
          className={cn(
            "mash-mermaid w-full flex justify-center items-center select-none overflow-hidden",
            loading ? "hidden" : "block"
          )}
        />
      </div>

      {/* Enlarged Modal Window ("su window") */}
      {isModalOpen && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setIsModalOpen(false);
            setModalZoomPercent(100);
          }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 sm:p-8 animate-in fade-in duration-150"
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
                  onClick={handleZoomOut}
                  className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="font-mono text-[11px] text-muted-foreground px-1 select-none">
                  {modalZoomPercent}%
                </span>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>
                <button
                  type="button"
                  onClick={handleResetZoom}
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
                    setModalZoomPercent(100);
                  }}
                  className="p-1 rounded-md text-zinc-500 hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  title="Close (Esc)"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Body: Infinite Canvas Viewport */}
            <div
              ref={modalContainerRef}
              className="flex-1 w-full min-h-[420px] max-h-[75vh] overflow-hidden p-6 relative flex items-center justify-center select-none bg-zinc-50/50 dark:bg-zinc-900/40"
              style={{ touchAction: "none" }}
            >
              <div
                ref={modalDiagramRef}
                className="mash-mermaid inline-flex justify-center items-center select-none origin-center"
              />
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
