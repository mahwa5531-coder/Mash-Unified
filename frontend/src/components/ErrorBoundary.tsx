"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  fallbackRender?: (error: Error, reset: () => void) => ReactNode;
  scope?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// ponytail: Resilient React error boundary preventing single-turn/markdown errors from crashing the entire app
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.scope || "root"}] Uncaught render error:`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallbackRender && this.state.error) {
        return this.props.fallbackRender(this.state.error, this.handleReset);
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="p-2.5 my-2 rounded-xl bg-zinc-100/80 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/[0.08] text-xs flex items-center justify-between gap-3 font-sans">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 shrink-0" />
            <span className="truncate text-zinc-500 dark:text-zinc-400 text-xs">
              Message rendering error encountered. Content preserved safely.
            </span>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            className="group inline-flex items-center gap-1.5 h-[21px] px-2.5 py-0 rounded-full font-sans text-[11px] font-medium leading-none select-none outline-none transition-all duration-150 cursor-pointer active:scale-[0.97] bg-zinc-100/90 hover:bg-zinc-200/90 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] text-zinc-700 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white border border-zinc-200/90 hover:border-zinc-300 dark:border-white/[0.08] dark:hover:border-white/[0.20] shadow-2xs shrink-0"
          >
            <RefreshCw size={10} className="text-zinc-400 group-hover:rotate-45 transition-transform" />
            <span>Retry</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
