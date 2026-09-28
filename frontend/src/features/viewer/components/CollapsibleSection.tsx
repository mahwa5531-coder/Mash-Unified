"use client";

// Generic collapsible section with header, count badge, optional right action.
import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface CollapsibleSectionProps {
  title: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, count, isOpen, onToggle, rightAction, children }: CollapsibleSectionProps) {
  return (
    <div className="mb-3">
      <div 
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        className="flex items-center justify-between py-1.5 px-2 cursor-pointer select-none group focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md hover:bg-muted/50 transition-colors"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="flex items-center gap-2">
          <ChevronDown 
            size={12} 
            className={`text-muted-foreground group-hover:text-foreground transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} 
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {rightAction && (
            <div onClick={(e) => e.stopPropagation()}>
              {rightAction}
            </div>
          )}
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono font-normal">
            {count}
          </Badge>
        </div>
      </div>
      {isOpen && (
        <div className="flex flex-col space-y-0.5 mt-1">
          {children}
        </div>
      )}
    </div>
  );
}
