"use client";

import React from 'react';
import TableContainer from '@/components/renderers/TableContainer';

export function Unit15Tables() {
  const sampleTableData = [
    { code: '1010', name: 'Operating Cash & Bank', debit: '₹ 1,45,20,000', credit: '—', variance: '+12.4%' },
    { code: '1040', name: 'Trade Receivables (Debtors)', debit: '₹ 3,82,90,500', credit: '—', variance: '-3.1%' },
    { code: '2010', name: 'Trade Payables (Creditors)', debit: '—', credit: '₹ 2,15,40,000', variance: '+8.2%' },
    { code: '2050', name: 'Statutory GST Liability', debit: '—', credit: '₹ 38,15,200', variance: '-1.5%' },
    { code: '3010', name: 'Retained Earnings', debit: '—', credit: '₹ 2,74,55,300', variance: '+15.0%' },
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">15</span>
          <span>Clean Data Tables (`&lt;TableContainer /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`components/renderers/TableContainer.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-3">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
          <strong className="text-[var(--m-text-primary)]">Clean Naked Table:</strong> The top bar layer has been removed. Tables render natively with smooth zebra borders and responsive horizontal scrolling.
        </div>

        <TableContainer>
          <thead>
            <tr>
              <th className="text-left font-mono">Account Code</th>
              <th className="text-left">Account Description</th>
              <th className="text-right font-mono">Debit Balance</th>
              <th className="text-right font-mono">Credit Balance</th>
              <th className="text-right font-mono">YoY Variance</th>
            </tr>
          </thead>
          <tbody>
            {sampleTableData.map((row, idx) => (
              <tr key={idx} className="transition-colors hover:bg-zinc-500/5">
                <td className="font-mono text-zinc-500 dark:text-zinc-400">{row.code}</td>
                <td className="font-medium text-foreground">{row.name}</td>
                <td className="text-right font-mono text-emerald-600 dark:text-emerald-400">{row.debit}</td>
                <td className="text-right font-mono text-rose-500 dark:text-rose-400">{row.credit}</td>
                <td className="text-right font-mono text-zinc-500">{row.variance}</td>
              </tr>
            ))}
          </tbody>
        </TableContainer>
      </div>
    </section>
  );
}
