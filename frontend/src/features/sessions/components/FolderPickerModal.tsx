"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Folder, FolderOpen, ArrowUp, HardDrive, RefreshCw, 
  ChevronRight, CornerDownRight, Check
} from 'lucide-react';
import { Modal, Button } from '@/primitives';
import { browseDirectories, createProject, DirectoryBrowseResponse, ProjectItem } from '@/services/projects';

export interface FolderPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: ProjectItem) => void;
}

export function FolderPickerModal({
  isOpen,
  onClose,
  onProjectCreated,
}: FolderPickerModalProps) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [browseData, setBrowseData] = useState<DirectoryBrowseResponse | null>(null);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await browseDirectories(path);
      if (data) {
        setBrowseData(data);
        setCurrentPath(data.current_path);
        setSelectedFolderPath(data.current_path);
        const basename = data.current_path.split(/[/\\]/).filter(Boolean).pop() || 'Project';
        setProjectName(basename);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to browse directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadDirectory();
    }
  }, [isOpen, loadDirectory]);

  const handleSelectFolder = (path: string) => {
    setSelectedFolderPath(path);
    const basename = path.split(/[/\\]/).filter(Boolean).pop() || 'Project';
    setProjectName(basename);
  };

  const handleNavigateInto = (path: string) => {
    loadDirectory(path);
  };

  const handleNavigateUp = () => {
    if (browseData?.parent_path) {
      loadDirectory(browseData.parent_path);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalPath = selectedFolderPath.trim();
    const finalName = projectName.trim() || finalPath.split(/[/\\]/).filter(Boolean).pop() || 'Workspace';
    if (!finalPath) {
      setError('Please select or enter a valid directory path');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const project = await createProject(finalName, finalPath);
      if (project) {
        onProjectCreated(project);
        onClose();
      } else {
        setError('Failed to create project with selected path. Make sure the directory exists.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error creating project');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Select Workspace Folder"
      description="Choose an existing folder on your computer to register as a project"
      icon={<FolderOpen size={18} className="text-zinc-500 dark:text-zinc-400" />}
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        {/* Quick Shortcuts Bar (Drives & Common Folders) */}
        {browseData && (
          <div className="flex flex-wrap items-center gap-1.5 pb-1 border-b border-zinc-200 dark:border-white/[0.06]">
            {browseData.drives.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => loadDirectory(d)}
                className={`px-2 py-1 rounded text-xs font-mono flex items-center gap-1 transition-colors cursor-pointer ${
                  currentPath.toLowerCase().startsWith(d.toLowerCase())
                    ? 'bg-zinc-800 text-white dark:bg-white dark:text-zinc-900 font-semibold'
                    : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <HardDrive size={11} className="shrink-0" />
                <span>{d}</span>
              </button>
            ))}

            {browseData.shortcuts.map((sc) => (
              <button
                key={sc.name}
                type="button"
                onClick={() => loadDirectory(sc.path)}
                className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors cursor-pointer ${
                  currentPath.toLowerCase() === sc.path.toLowerCase()
                    ? 'bg-zinc-800 text-white dark:bg-white dark:text-zinc-900 font-semibold'
                    : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <Folder size={11} className="shrink-0 text-zinc-500 dark:text-zinc-400" />
                <span>{sc.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Current Path & Up Navigation */}
        <div className="flex items-center gap-1.5 bg-zinc-100/70 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-700 dark:text-zinc-300">
          <button
            type="button"
            onClick={handleNavigateUp}
            disabled={!browseData?.parent_path || loading}
            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-zinc-600 dark:text-zinc-300 transition-colors"
            title="Navigate to parent folder"
          >
            <ArrowUp size={13} />
          </button>
          <span className="truncate flex-1 min-w-0" title={currentPath}>
            {currentPath || 'Loading directory...'}
          </span>
          <button
            type="button"
            onClick={() => loadDirectory(currentPath)}
            disabled={loading}
            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/[0.08] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            title="Refresh directory list"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Directory Listing Box */}
        <div className="h-56 overflow-y-auto custom-scrollbar border border-zinc-200 dark:border-white/[0.06] rounded-lg bg-white dark:bg-[#141416] p-1 divide-y divide-zinc-100 dark:divide-white/[0.02]">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400 text-xs gap-2">
              <RefreshCw size={16} className="animate-spin text-zinc-500" />
              <span>Scanning directories...</span>
            </div>
          ) : !browseData?.directories || browseData.directories.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400 text-xs py-8">
              <Folder size={20} className="text-zinc-400 dark:text-zinc-600 mb-1" />
              <span>No subdirectories found in this folder.</span>
            </div>
          ) : (
            browseData.directories.map((dir) => {
              const isSelected = selectedFolderPath.toLowerCase() === dir.path.toLowerCase();
              return (
                <div
                  key={dir.path}
                  onClick={() => handleSelectFolder(dir.path)}
                  onDoubleClick={() => handleNavigateInto(dir.path)}
                  className={`group flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs cursor-pointer select-none transition-colors ${
                    isSelected
                      ? 'bg-zinc-200/80 dark:bg-white/[0.1] text-zinc-900 dark:text-white font-medium'
                      : 'hover:bg-zinc-100 dark:hover:bg-white/[0.04] text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                    <Folder size={13} className={`shrink-0 ${isSelected ? 'text-zinc-900 dark:text-white fill-current' : 'text-zinc-400'}`} />
                    <span className="truncate">{dir.name}</span>
                    {dir.is_hidden && (
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">(hidden)</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNavigateInto(dir.path);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-all cursor-pointer flex items-center gap-0.5 text-[11px]"
                    title="Open folder"
                  >
                    <span>Open</span>
                    <ChevronRight size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Path & Project Name Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">
              Selected Directory
            </label>
            <input
              type="text"
              value={selectedFolderPath}
              onChange={(e) => {
                setSelectedFolderPath(e.target.value);
                const basename = e.target.value.split(/[/\\]/).filter(Boolean).pop() || 'Project';
                setProjectName(basename);
              }}
              placeholder="e.g. C:\Users\rama\Downloads\Mash"
              required
              className="w-full px-2.5 py-1.5 rounded-lg text-xs font-mono bg-zinc-100 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] text-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">
              Project Display Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Mash"
              required
              className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-zinc-100 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] text-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
        </div>

        {error && (
          <p className="text-[11.5px] text-red-500 font-sans">{error}</p>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-white/[0.06]">
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate max-w-[240px]">
            Double-click a folder to enter it.
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={submitting}
              icon={<Check size={13} />}
            >
              Select This Folder
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default FolderPickerModal;
