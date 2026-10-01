"use client";

import React from 'react';
import type { AuditSettings } from '../../types';

interface GeneralTabProps {
  auditSettings: AuditSettings;
  onUpdateAuditSettings: (patch: Partial<AuditSettings>) => void;
}

export function GeneralTab({
  auditSettings,
  onUpdateAuditSettings,
}: GeneralTabProps) {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-[17px] font-semibold text-zinc-900 dark:text-white">General Audit Settings</h2>
        <p className="text-xs text-zinc-500 dark:text-[#71717a] mt-0.5">
          Configure default auditor profile, reporting conventions, and working paper preferences.
        </p>
      </div>

      {/* Engagement & Practice Profile */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mb-2">Practice Profile</h3>
        <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl divide-y divide-zinc-200 dark:divide-[#242426]">
          <div className="p-3.5 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-zinc-800 dark:text-white">Lead Auditor / Partner</div>
              <div className="text-[11px] text-zinc-500 dark:text-[#71717a] mt-0.5">Appears on generated memos, review notes, and working papers</div>
            </div>
            <input
              type="text"
              value={auditSettings.auditorName}
              onChange={(e) => onUpdateAuditSettings({ auditorName: e.target.value })}
              className="px-2.5 py-1 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#141416] text-zinc-900 dark:text-white w-48 outline-none focus:border-blue-500"
            />
          </div>

          <div className="p-3.5 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-zinc-800 dark:text-white">Firm / Practice Name</div>
              <div className="text-[11px] text-zinc-500 dark:text-[#71717a] mt-0.5">Header brand for audit deliverables and reports</div>
            </div>
            <input
              type="text"
              value={auditSettings.firmName}
              onChange={(e) => onUpdateAuditSettings({ firmName: e.target.value })}
              className="px-2.5 py-1 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#141416] text-zinc-900 dark:text-white w-48 outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Accounting Conventions */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mb-2">Conventions</h3>
        <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl divide-y divide-zinc-200 dark:divide-[#242426]">
          <div className="p-3.5 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-zinc-800 dark:text-white">Default Currency</div>
              <div className="text-[11px] text-zinc-500 dark:text-[#71717a] mt-0.5">Currency symbol used in schedules and calculations</div>
            </div>
            <select
              value={auditSettings.currency}
              onChange={(e) => onUpdateAuditSettings({ currency: e.target.value })}
              className="px-2.5 py-1 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#141416] text-zinc-900 dark:text-white outline-none cursor-pointer"
            >
              <option value="₹ (INR)">₹ (INR)</option>
              <option value="$ (USD)">$ (USD)</option>
              <option value="€ (EUR)">€ (EUR)</option>
              <option value="£ (GBP)">£ (GBP)</option>
              <option value="¥ (JPY)">¥ (JPY)</option>
              <option value="C$ (CAD)">C$ (CAD)</option>
              <option value="A$ (AUD)">A$ (AUD)</option>
            </select>
          </div>

          <div className="p-3.5 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-zinc-800 dark:text-white">Date Format</div>
              <div className="text-[11px] text-zinc-500 dark:text-[#71717a] mt-0.5">Standard format across all audit exhibits</div>
            </div>
            <select
              value={auditSettings.dateFormat}
              onChange={(e) => onUpdateAuditSettings({ dateFormat: e.target.value })}
              className="px-2.5 py-1 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#141416] text-zinc-900 dark:text-white outline-none cursor-pointer"
            >
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </div>

          <div className="p-3.5 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-zinc-800 dark:text-white">Auto-save Working Papers</div>
              <div className="text-[11px] text-zinc-500 dark:text-[#71717a] mt-0.5">Automatically sync changes to local workspace folder</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={auditSettings.autoSaveWorkingPapers}
              onClick={() => onUpdateAuditSettings({ autoSaveWorkingPapers: !auditSettings.autoSaveWorkingPapers })}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                auditSettings.autoSaveWorkingPapers ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  auditSettings.autoSaveWorkingPapers ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
