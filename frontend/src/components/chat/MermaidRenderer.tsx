"use client";

import { useState, useEffect, useRef, useId } from "react";
import { Copy, Check, ZoomIn, ZoomOut, RotateCcw, Code2, Eye, AlertCircle } from "lucide-react";

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

export default function MermaidRenderer({ chart, isStreaming = false }: MermaidRendererProps) {
  const [svgContent, setSvgContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [showCode, setShowCode] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const containerRef = useRef<HTMLDivElement>(null);
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

        // Clean any markdown formatting or excess whitespace
        const cleanChart = chart.replace(/```mermaid/g, "").replace(/```/g, "").trim();
        const id = chartIdRef.current;

        const { svg } = await mermaid.render(id, cleanChart);
        if (isMounted) {
          setSvgContent(svg);
          setError(null);
          setLoading(false);
        }
      } catch (err: any) {
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
    };
  }, [chart]);

  const handleCopySvg = async () => {
    if (!svgContent) return;
    try {
      await navigator.clipboard.writeText(svgContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy SVG:", e);
    }
  };

  const handleZoomIn = () => setZoom((z) => Math.min(2.5, +(z + 0.2).toFixed(1)));
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(1)));
  const handleResetZoom = () => setZoom(1);

  if (error) {
    if (isStreaming) {
      return (
        <div className="my-3 p-3 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl text-xs font-mono text-[var(--text-muted)] flex items-center gap-2 select-none">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
          <span>Generating diagram...</span>
        </div>
      );
    }
    return (
      <div className="my-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
        <div className="flex items-center gap-2 text-amber-500 font-mono mb-2">
          <AlertCircle size={14} />
          <span>Mermaid Diagram (Syntax Fallback)</span>
        </div>
        <pre className="p-3 bg-[var(--bg-surface)] rounded border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono overflow-x-auto text-[12px] leading-relaxed">
          {chart}
        </pre>
      </div>
    );
  }

  return (
    <div className="my-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-md overflow-hidden group">
      {/* Controls Header */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-xs font-mono text-[var(--text-secondary)]">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]/60 inline-block animate-pulse" />
          <span className="font-medium text-[var(--text-primary)] tracking-wide text-[11px] uppercase">Diagram View</span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Zoom controls */}
          {!showCode && (
            <div className="flex items-center bg-[var(--bg-hover)] rounded-md border border-[var(--border-subtle)] px-1 py-0.5 mr-2">
              <button
                type="button"
                onClick={handleZoomOut}
                className="p-1 hover:text-[var(--text-primary)] text-[var(--text-secondary)] transition-colors cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut size={13} />
              </button>
              <span className="text-[10px] px-1.5 text-[var(--text-muted)] font-mono select-none">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={handleZoomIn}
                className="p-1 hover:text-[var(--text-primary)] text-[var(--text-secondary)] transition-colors cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn size={13} />
              </button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="p-1 hover:text-[var(--text-primary)] text-[var(--text-secondary)] border-l border-[var(--border-subtle)] ml-0.5 pl-1 transition-colors cursor-pointer"
                title="Reset Zoom"
              >
                <RotateCcw size={12} />
              </button>
            </div>
          )}

          {/* Toggle Code/Diagram */}
          <button
            type="button"
            onClick={() => setShowCode(!showCode)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] text-[11px] transition-colors cursor-pointer"
            title={showCode ? "View Visual Diagram" : "View Mermaid Source"}
          >
            {showCode ? <Eye size={12} /> : <Code2 size={12} />}
            <span>{showCode ? "Visual" : "Code"}</span>
          </button>

          {/* Copy SVG / Copy Code */}
          <button
            type="button"
            onClick={handleCopySvg}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] text-[11px] transition-colors cursor-pointer"
            title="Copy SVG to Clipboard"
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            <span>{copied ? "Copied" : "SVG"}</span>
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div 
        ref={containerRef}
        className="relative p-6 overflow-x-auto flex justify-center items-center min-h-[140px] bg-[var(--bg-surface)]"
      >
        {loading && (
          <div className="flex items-center gap-2 text-[var(--text-muted)] text-xs font-mono py-8">
            <span className="w-4 h-4 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
            <span>Rendering diagram...</span>
          </div>
        )}

        {!loading && showCode && (
          <pre className="w-full text-left font-mono text-[12px] text-[var(--text-primary)] bg-[var(--bg-app)] p-4 rounded-lg border border-[var(--border-subtle)] overflow-x-auto leading-relaxed">
            {chart}
          </pre>
        )}

        {!loading && !showCode && svgContent && (
          <div className="w-full flex items-center justify-center overflow-auto custom-scrollbar p-2">
            <div 
              style={{ transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 0.15s ease' }}
              className="max-w-full flex justify-center items-center select-none"
              dangerouslySetInnerHTML={{ __html: sanitizeSvg(svgContent) }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
