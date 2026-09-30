"use client";

// Empty state when editor mode has no open tab.
import React from 'react';
import { FileText } from 'lucide-react';
import { Button } from '@/primitives';

interface ViewerEmptyStateProps {
  setViewMode: React.Dispatch<React.SetStateAction<'explorer' | 'editor'>>;
}

export function ViewerEmptyState({ setViewMode }: ViewerEmptyStateProps) {
  return (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-card select-none">
          <div className="w-10 h-10 rounded-xl bg-muted/50 border border-border/40 flex items-center justify-center mb-3 text-muted-foreground shadow-2xs">
            <FileText size={18} />
          </div>
          <div className="text-xs font-medium text-foreground mb-1">No workpaper selected</div>
          <p className="text-[11.5px] text-muted-foreground max-w-[240px] mb-4 leading-relaxed">
            Select an audit workpaper or click any document reference in the chat to inspect here.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode('explorer')}
            className="h-7 text-xs border-border/60 hover:bg-muted/60"
          >
            Browse Workpapers
          </Button>
        </div>
  );
}
