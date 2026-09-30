"use client";

import React, { useState } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WebLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Target URL destination */
  href: string;
  /** Link text label. Defaults to href if omitted */
  children?: React.ReactNode;
  /** Whether the link points to an external site. Default: true */
  isExternal?: boolean;
  /** Whether to render the external arrow icon (↗). Default: true */
  showIcon?: boolean;
  /** Optional inline copy button on hover */
  withCopy?: boolean;
  /** Visual style variant */
  variant?: 'primary' | 'muted' | 'citation';
  /** Additional container classes */
  className?: string;
}

/**
 * WebLink Primitive
 * 
 * Standardized link renderer for web URLs, external documentation, and statutory citations.
 * Automatically adds security attributes (target="_blank", rel="noopener noreferrer")
 * and the crisp external link indicator (↗).
 */
export function WebLink({
  href,
  children,
  isExternal = true,
  showIcon = true,
  withCopy = false,
  variant = 'primary',
  className,
  ...props
}: WebLinkProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const variantStyles = {
    primary: "text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 underline-offset-3 hover:underline",
    muted: "text-zinc-600 dark:text-zinc-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors",
    citation: "text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-mono text-[11.5px] border-b border-indigo-400/40 hover:border-indigo-400",
  };

  return (
    <span className="inline-flex items-center gap-1 group/weblink">
      <a
        href={href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
        className={cn(
          "inline-flex items-center gap-1 font-medium transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded-xs",
          variantStyles[variant],
          className
        )}
        {...props}
      >
        <span>{children || href}</span>
        {showIcon && isExternal && (
          <ExternalLink size={12} className="shrink-0 opacity-80 group-hover/weblink:opacity-100 transition-opacity" />
        )}
      </a>

      {withCopy && (
        <button
          type="button"
          onClick={handleCopy}
          className="p-0.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer outline-none"
          title="Copy URL"
          aria-label="Copy URL"
        >
          {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
        </button>
      )}
    </span>
  );
}

export default WebLink;
