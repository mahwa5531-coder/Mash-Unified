"use client";

import React from 'react';
import { Download, Play, ArrowRight, Copy, Trash2 } from 'lucide-react';
import { Button } from '@/primitives';

interface Unit01ButtonsProps {
  isLoading: boolean;
  onSelectComponent: (name: string) => void;
}

export function Unit01Buttons({ isLoading, onSelectComponent }: Unit01ButtonsProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">1</span>
          <span>Button Primitive (`&lt;Button /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/Button.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-6">
        {/* Variants */}
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-2.5">Variants</span>
          <div className="flex flex-wrap gap-2.5 items-center">
            <Button variant="primary" loading={isLoading} onClick={() => onSelectComponent('Primary Button')}>
              Primary Action
            </Button>
            <Button variant="secondary" loading={isLoading} onClick={() => onSelectComponent('Secondary Button')}>
              Secondary Action
            </Button>
            <Button variant="ghost" loading={isLoading} onClick={() => onSelectComponent('Ghost Button')}>
              Ghost Action
            </Button>
            <Button variant="danger" loading={isLoading} onClick={() => onSelectComponent('Danger Button')}>
              Destructive
            </Button>
            <Button variant="danger-soft" loading={isLoading} onClick={() => onSelectComponent('Danger-Soft Button')}>
              Danger Soft
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
          </div>
        </div>

        {/* Sizes & Icons */}
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-2.5">Sizes & Icons</span>
          <div className="flex flex-wrap gap-2.5 items-center">
            <Button size="sm" variant="secondary" icon={<Download size={13} />} onClick={() => onSelectComponent('Small Button')}>
              Small (h-7)
            </Button>
            <Button size="md" variant="primary" icon={<Play size={13} />} onClick={() => onSelectComponent('Medium Button')}>
              Medium (h-8)
            </Button>
            <Button size="lg" variant="secondary" icon={<ArrowRight size={15} />} iconPosition="right" onClick={() => onSelectComponent('Large Button')}>
              Large (h-10)
            </Button>
            <Button size="icon" variant="ghost" icon={<Copy size={14} />} onClick={() => onSelectComponent('Icon Button')} title="Copy" />
            <Button size="icon" variant="danger-soft" icon={<Trash2 size={14} />} onClick={() => onSelectComponent('Delete Icon Button')} title="Delete" />
          </div>
        </div>
      </div>
    </section>
  );
}
