"use client";

import React, { useState } from 'react';
import CodeBlock from '@/components/renderers/CodeBlock';

export function Unit17CodeBlocks() {
  const [selectedLang, setSelectedLang] = useState<'ts' | 'py' | 'sql'>('ts');

  const snippets = {
    ts: `import { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {},
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;`,

    py: `import duckdb
from pathlib import Path

def evaluate_balance_sheet(parquet_path: Path) -> dict:
    conn = duckdb.connect()
    df = conn.execute(f"SELECT * FROM '{parquet_path}' WHERE variance > 0.05").df()
    return {
        "status": "COMPLETED",
        "exceptions_count": len(df),
        "total_material_variance": float(df['variance'].sum())
    }`,

    sql: `SELECT 
    v.voucher_id,
    v.vendor_name,
    v.invoice_amount,
    v.gst_input_credit,
    CASE 
        WHEN g.gstr_2b_status = 'MATCHED' THEN 'VERIFIED'
        ELSE 'EXCEPTION'
    END AS reconciliation_status
FROM vouchers v
LEFT JOIN gstr_2b_recon g ON v.invoice_number = g.invoice_number
WHERE v.posting_date >= '2026-01-01'
ORDER BY v.invoice_amount DESC;`
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">17</span>
          <span>Syntax-Highlighted Code Blocks (`&lt;CodeBlock /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`components/renderers/CodeBlock.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
          <strong className="text-[var(--m-text-primary)]">Zero-Prism Fast Syntax Tokenizer:</strong> Instant single-pass regex syntax highlighter used in both Chat responses and the Markdown File Viewer.
        </div>

        {/* Language selector tabs */}
        <div className="flex items-center gap-2 border-b border-[var(--m-border-subtle)] pb-2 text-xs">
          <button
            type="button"
            onClick={() => setSelectedLang('ts')}
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              selectedLang === 'ts'
                ? 'bg-zinc-200 dark:bg-zinc-800 text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            TypeScript (Next.js)
          </button>
          <button
            type="button"
            onClick={() => setSelectedLang('py')}
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              selectedLang === 'py'
                ? 'bg-zinc-200 dark:bg-zinc-800 text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Python (DuckDB)
          </button>
          <button
            type="button"
            onClick={() => setSelectedLang('sql')}
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              selectedLang === 'sql'
                ? 'bg-zinc-200 dark:bg-zinc-800 text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            SQL Query (GSTR-2B)
          </button>
        </div>

        {/* Live CodeBlock instance */}
        <CodeBlock
          language={selectedLang === 'ts' ? 'typescript' : selectedLang === 'py' ? 'python' : 'sql'}
          code={snippets[selectedLang]}
        />
      </div>
    </section>
  );
}
