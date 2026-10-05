"use client";

import React, { useState } from 'react';
import { Modal, Button } from '@/primitives';
import { QuickStartFolderIcon } from './icons';
import { createQuickProject, ProjectItem } from '@/services/projects';

export interface QuickProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: ProjectItem) => void;
}

export function QuickProjectModal({
  isOpen,
  onClose,
  onProjectCreated,
}: QuickProjectModalProps) {
  const [projectName, setProjectName] = useState(() => `Project-${Date.now().toString().slice(-4)}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = projectName.trim();
    if (!clean) return;

    setLoading(true);
    setError(null);

    try {
      const created = await createQuickProject(clean);
      if (created) {
        onProjectCreated(created);
        onClose();
      } else {
        setError("Could not create project. Please check local folder permissions.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to create quick project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Quick Project"
      description="Creates an empty folder in your Documents directory"
      icon={<QuickStartFolderIcon size={18} />}
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[var(--m-text-muted)] mb-1.5">
            Project Name
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Audit-Project-1"
            autoFocus
            required
            className="w-full px-3 py-1.5 rounded-lg text-[13px] bg-[var(--m-bg-app)] border border-[var(--m-border)] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)] outline-none focus:ring-1 focus:ring-[var(--m-focus-ring)]"
          />
          {error && (
            <p className="text-[11px] text-[var(--m-danger)] mt-1.5">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={loading}
          >
            Create Project
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default QuickProjectModal;
