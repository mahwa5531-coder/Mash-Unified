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

// ponytail: auto-repair common LLM Mermaid syntax flaws (unquoted parentheses, special chars, dangling arrows)
function repairMermaidSyntax(raw: string): string {
  if (!raw) return '';
  let cleaned = raw
    .replace(/```mermaid/gi, '')
    .replace(/```/g, '')
    .trim();

  // 1. Remove trailing dangling connectors (e.g. "A --> " at end of line)
  cleaned = cleaned.replace(/(-->|--\s*\|[^|]*\|\s*-->?)\s*$/gm, '');

  // 2. Ensure unquoted bracket labels [...] containing special characters ()[]&:$# are safely quoted
  cleaned = cleaned.replace(/\[([^"\]\n]+)\]/g, (match, inner) => {
    if (/[()&:$#\/]/.test(inner)) {
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

interface FlowStep {
  id: string;
  label: string;
  type?: 'step' | 'decision';
}

// ponytail: parse chart lines into readable audit procedure steps if rendering fails
function extractFlowSteps(chart: string): FlowStep[] {
  const steps: FlowStep[] = [];
  const seen = new Set<string>();

  const lines = chart.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%') || /^(graph|flowchart|sequenceDiagram|stateDiagram|classDiagram|erDiagram)/i.test(trimmed)) {
      continue;
    }

    // Match node labels inside quotes, brackets, braces, parentheses
    const matches = Array.from(trimmed.matchAll(/([a-zA-Z0-9_-]+)?(?:\s*\[\"?([^\"\]]+)\"?\]|\s*\{\"?([^\"\}]+)\"?\}|\s*\(\"?([^\"\)]+)\"?\))/g));
    for (const m of matches) {
      const label = (m[2] || m[3] || m[4] || '').trim();
      if (label && !seen.has(label.toLowerCase()) && label.length > 1 && !/^(TD|TB|LR|RL)$/i.test(label)) {
        seen.add(label.toLowerCase());
        const isDecision = !!m[3];
        steps.push({ id: m[1] || `step_${steps.length}`, label, type: isDecision ? 'decision' : 'step' });
      }
    }
  }

  return steps;
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

        // 1. Auto-repair common syntax flaws
        const repairedChart = repairMermaidSyntax(chart);
        const id = chartIdRef.current;

        const { svg } = await mermaid.render(id, repairedChart);
        if (isMounted) {
          setSvgContent(svg);
          setError(null);
          setLoading(false);
        }
      } catch (err: any) {
        console.warn("Mermaid render error, cleaning up DOM:", err);
        // Clean up any orphan elements Mermaid injected on error
        try {
          const id = chartIdRef.current;
          const orphan = document.getElementById(id);
          if (orphan) orphan.remove();
          const dOrphan = document.getElementById(`d${id}`);
          if (dOrphan) dOrphan.remove();
          const errorElements = document.querySelectorAll(`[id^="d${id}"], [id^="${id}"]`);
          errorElements.forEach((el) => el.remove());
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

    const fallbackSteps = extractFlowSteps(chart);

    return (
      <div className="my-4 rounded-xl border border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-[#151518] shadow-sm overflow-hidden">
        {/* Auditor Card Header */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-zinc-100/80 dark:bg-[#1b1b1e] border-b border-zinc-200 dark:border-white/[0.06] text-xs font-medium text-zinc-700 dark:text-zinc-300">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <span className="font-semibold text-xs tracking-wide">Audit Procedure Flow</span>
          </div>
          <button
            type="button"
            onClick={() => setShowCode(!showCode)}
            className="flex items-center gap-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <Code2 size={12} />
            <span>{showCode ? "Hide source" : "View source"}</span>
          </button>
        </div>

        {/* Auditor Stepped Procedure Flow */}
        {fallbackSteps.length > 0 ? (
          <div className="p-4 flex flex-col space-y-2">
            {fallbackSteps.map((step, idx) => (
              <div key={step.id || idx} className="flex items-start gap-3 relative group">
                <div className="flex flex-col items-center shrink-0">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-semibold ${
                    step.type === 'decision' 
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30' 
                      : 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30'
                  }`}>
                    {String(idx + 1).padStart(2, '0')}
                  </div>
                  {idx < fallbackSteps.length - 1 && (
                    <div className="w-[1.5px] h-4 bg-zinc-200 dark:bg-white/[0.1] my-0.5" />
                  )}
                </div>
                <div className={`flex-1 px-3 py-1.5 rounded-lg border text-[12.5px] leading-snug font-sans ${
                  step.type === 'decision'
                    ? 'bg-amber-500/5 border-amber-500/20 text-amber-900 dark:text-amber-200 font-medium'
                    : 'bg-white dark:bg-[#1a1a1d] border-zinc-200 dark:border-white/[0.08] text-zinc-800 dark:text-zinc-200'
                }`}>
                  {step.label}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 text-xs text-zinc-500 dark:text-zinc-400 italic">
            Procedure workflow described in the audit analysis above.
          </div>
        )}

        {/* Collapsible Technical Source for Developers */}
        {showCode && (
          <div className="border-t border-zinc-200 dark:border-white/[0.06] p-3 bg-zinc-900 text-zinc-300 font-mono text-[11.5px] overflow-x-auto">
            <pre className="leading-relaxed">{chart}</pre>
          </div>
        )}
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
