"use client";

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { fetchProjects, deleteProject, ProjectItem } from '@/services/projects';
import { fetchAuthMe, logoutUser, AuthUser } from '@/services/auth';
import {
  ThemeConfig,
  AuditSettings,
  DEFAULT_THEME_CONFIG,
  DEFAULT_AUDIT_SETTINGS,
  sanitizeThemeConfig,
} from '../types';
import { AppearanceTab } from './tabs/AppearanceTab';
import { ProjectTab } from './tabs/ProjectTab';
import { AccountTab } from './tabs/AccountTab';
import { GeneralTab } from './tabs/GeneralTab';
import { SignOutConfirmDialog } from './SignOutConfirmDialog';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onThemeChange?: (isDark: boolean) => void;
  initialTab?: string;
  currentProjectName?: string;
  onProjectDeleted?: (projectName: string) => void;
  onSignOut?: () => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  onThemeChange,
  initialTab = 'appearance',
  currentProjectName = 'Mash',
  onProjectDeleted,
  onSignOut,
}: SettingsModalProps) {
  const [mounted, setMounted] = useState(false);
  const [selectedNav, setSelectedNav] = useState<string>(initialTab);
  const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME_CONFIG);
  const [auditSettings, setAuditSettings] = useState<AuditSettings>(DEFAULT_AUDIT_SETTINGS);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthUser | null>(null);
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [marketingEmailsEnabled, setMarketingEmailsEnabled] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const loadProjects = async () => {
    try {
      const list = await fetchProjects();
      const unique = Array.from(
        new Map(list.map((p: ProjectItem) => [p.name.trim().toLowerCase(), p])).values()
      );
      setProjects(unique);
    } catch (err) {
      console.warn("Failed to load projects:", err);
    }
  };

  const loadAuth = async () => {
    try {
      const info = await fetchAuthMe();
      if (info) {
        setAuthInfo(info);
      }
    } catch (err) {
      console.warn("Failed to load auth:", err);
    }
  };

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem('mash_theme_settings');
      if (saved) {
        setTheme(sanitizeThemeConfig(JSON.parse(saved)));
      }
      const auditSaved = localStorage.getItem('mash_audit_settings');
      if (auditSaved) {
        setAuditSettings({ ...DEFAULT_AUDIT_SETTINGS, ...JSON.parse(auditSaved) });
      }
      const tel = localStorage.getItem('mash_telemetry');
      if (tel !== null) setTelemetryEnabled(tel === 'true');
      const mkt = localStorage.getItem('mash_marketing');
      if (mkt !== null) setMarketingEmailsEnabled(mkt === 'true');
    } catch {}
  }, []);

  const updateAuditSettings = (patch: Partial<AuditSettings>) => {
    setAuditSettings(prev => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem('mash_audit_settings', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // When opened, reload real projects, auth info, and reset tab
  useEffect(() => {
    if (isOpen) {
      loadProjects();
      loadAuth();
      setSelectedNav(initialTab || 'general');
    }
  }, [isOpen, initialTab]);

  const handleToggleTelemetry = () => {
    setTelemetryEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem('mash_telemetry', String(next)); } catch {}
      return next;
    });
  };

  const handleToggleMarketing = () => {
    setMarketingEmailsEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem('mash_marketing', String(next)); } catch {}
      return next;
    });
  };

  const handleSignOut = async () => {
    setShowSignOutConfirm(false);
    await logoutUser();
    setAuthInfo(null);
    onClose();
    onSignOut?.();
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Apply theme variables dynamically to DOM root
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;

    const applyThemeProperties = (isDark: boolean) => {
      const activeDark = theme.dark || DEFAULT_THEME_CONFIG.dark;
      const activeLight = theme.light || DEFAULT_THEME_CONFIG.light;
      if (isDark) {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
        root.style.setProperty('--bg-app', activeDark.background);
        root.style.setProperty('--bg-surface', activeDark.background === '#101010' ? '#141416' : activeDark.background);
        root.style.setProperty('--text-primary', activeDark.foreground);
        root.style.setProperty('--accent', activeDark.accent);
      } else {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
        root.style.setProperty('--bg-app', activeLight.background);
        root.style.setProperty('--bg-surface', '#FFFFFF');
        root.style.setProperty('--text-primary', activeLight.foreground);
        root.style.setProperty('--accent', activeLight.accent);
      }
      onThemeChange?.(isDark);
    };

    let isDarkMode = theme.mode === 'dark';
    if (theme.mode === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      isDarkMode = mql.matches;
      const handler = (e: MediaQueryListEvent) => {
        applyThemeProperties(e.matches);
      };
      mql.addEventListener('change', handler);
      applyThemeProperties(isDarkMode);
      return () => mql.removeEventListener('change', handler);
    } else {
      applyThemeProperties(isDarkMode);
    }

    try {
      localStorage.setItem('mash_theme_settings', JSON.stringify(theme));
    } catch {}
  }, [theme, mounted, onThemeChange]);

  if (!isOpen || !mounted) return null;

  const handleUpdateDark = (field: 'background' | 'foreground' | 'accent', value: string) => {
    setTheme(prev => ({
      ...prev,
      dark: { ...prev.dark, [field]: value, preset: 'Custom' },
    }));
  };

  const handleUpdateLight = (field: 'background' | 'foreground' | 'accent', value: string) => {
    setTheme(prev => ({
      ...prev,
      light: { ...prev.light, [field]: value, preset: 'Custom' },
    }));
  };

  // Determine currently active project
  const activeProject = projects.find(p => `project_${p.id}` === selectedNav || `project_${p.name}` === selectedNav) ||
    projects.find(p => p.name.toLowerCase() === (currentProjectName || 'mash').toLowerCase()) ||
    projects[0] || {
      id: 'default',
      name: currentProjectName || 'Mash',
      local_folder_path: '',
      session_count: 0
    };

  const handleDeleteActiveProject = async () => {
    if (!activeProject || isDeletingProject) return;
    if (typeof window !== 'undefined' && !window.confirm(`Are you sure you want to delete "${activeProject.name}"? This deletes its sessions from the database and .nexau metadata cache, but keeps your local code files intact.`)) {
      return;
    }
    setIsDeletingProject(true);
    try {
      const ok = await deleteProject(activeProject.id);
      if (ok) {
        onProjectDeleted?.(activeProject.name);
        const updated = await fetchProjects();
        setProjects(updated);
        if (updated.length > 0) {
          setSelectedNav(`project_${updated[0].id}`);
        } else {
          setSelectedNav('appearance');
        }
      }
    } catch (err) {
      console.warn("Error deleting project:", err);
    } finally {
      setIsDeletingProject(false);
    }
  };

  const modalContent = (
    <div 
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="bg-white dark:bg-[#141416] border border-zinc-200 dark:border-[#28282b] rounded-2xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.25)] dark:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] w-[880px] max-w-[95vw] h-[580px] max-h-[90vh] flex overflow-hidden text-zinc-800 dark:text-zinc-200 select-none relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pinned Stationary Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-50 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white p-1.5 rounded-lg bg-white/90 dark:bg-[#141416]/90 hover:bg-zinc-100 dark:hover:bg-[#242428] border border-zinc-200 dark:border-white/[0.08] transition-colors cursor-pointer shadow-md"
          title="Close Settings"
        >
          <X size={16} />
        </button>

        {/* Left Navigation Sidebar */}
        <div className="w-[220px] shrink-0 border-r border-zinc-200 dark:border-[#242426] flex flex-col justify-between bg-zinc-50 dark:bg-[#111113] p-3">
          <div className="overflow-y-auto custom-scrollbar flex-1 pr-1 space-y-4">
            
            {/* Settings Section */}
            <div>
              <div className="text-[11px] font-medium text-zinc-500 dark:text-[#71717a] px-3 pb-1 uppercase tracking-wider">Settings</div>
              <div className="space-y-0.5">
                {[
                  { id: 'general', label: 'General' },
                  { id: 'appearance', label: 'Appearance' },
                ].map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedNav(item.id)}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] font-normal transition-colors cursor-pointer ${
                      selectedNav === item.id 
                        ? 'bg-zinc-200 dark:bg-[#28282b] text-zinc-900 dark:text-white font-medium shadow-xs' 
                        : 'text-zinc-600 dark:text-[#a1a1aa] hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Projects Section */}
            <div>
              <div className="text-[11px] font-medium text-zinc-500 dark:text-[#71717a] px-3 pb-1 uppercase tracking-wider">Projects</div>
              <div className="space-y-0.5">
                {projects.length > 0 ? (
                  (showAllProjects ? projects : projects.slice(0, 4)).map(item => {
                    const isSelected = selectedNav === `project_${item.id}` || selectedNav === `project_${item.name}`;
                    return (
                      <button
                        key={item.id || item.name}
                        type="button"
                        onClick={() => setSelectedNav(`project_${item.id}`)}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] font-normal transition-colors cursor-pointer truncate ${
                          isSelected 
                            ? 'bg-zinc-200 dark:bg-[#28282b] text-zinc-900 dark:text-white font-medium shadow-xs' 
                            : 'text-zinc-600 dark:text-[#a1a1aa] hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                        }`}
                        title={item.name}
                      >
                        {item.name}
                      </button>
                    );
                  })
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelectedNav('project_mash')}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] font-normal transition-colors cursor-pointer truncate ${
                      selectedNav.startsWith('project_')
                        ? 'bg-zinc-200 dark:bg-[#28282b] text-zinc-900 dark:text-white font-medium shadow-xs' 
                        : 'text-zinc-600 dark:text-[#a1a1aa] hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    {currentProjectName || 'Mash'}
                  </button>
                )}

                {projects.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setShowAllProjects(prev => !prev)}
                    className="w-full text-left px-3 py-1 text-[12px] text-zinc-500 dark:text-[#71717a] hover:text-zinc-800 dark:hover:text-zinc-300 transition-colors cursor-pointer"
                  >
                    {showAllProjects ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            </div>

            {/* Shortcuts Section */}
            <div>
              <button
                type="button"
                onClick={() => setSelectedNav('shortcuts')}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] font-normal transition-colors cursor-pointer ${
                  selectedNav === 'shortcuts' 
                    ? 'bg-zinc-200 dark:bg-[#28282b] text-zinc-900 dark:text-white font-medium shadow-xs' 
                    : 'text-zinc-600 dark:text-[#a1a1aa] hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                }`}
              >
                Shortcuts
              </button>
              <button
                type="button"
                onClick={() => window.open('https://github.com/Nex-AGI/NexAU/issues', '_blank')}
                className="w-full text-left px-3 py-1.5 text-[12px] text-zinc-500 dark:text-[#71717a] hover:text-zinc-800 dark:hover:text-zinc-300 transition-colors cursor-pointer"
              >
                Provide Feedback
              </button>
            </div>
          </div>

          {/* User Profile Chip */}
          <div 
            onClick={() => setSelectedNav('account')}
            className={`pt-2 border-t border-zinc-200 dark:border-[#242426] flex items-center gap-2.5 px-2 py-1.5 rounded-xl transition-colors cursor-pointer ${
              selectedNav === 'account' ? 'bg-zinc-200 dark:bg-[#28282b]' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
            }`}
            title="Account Settings"
          >
            <div className="w-7 h-7 rounded-full bg-[#1b6d51] text-white flex items-center justify-center text-xs font-semibold shrink-0">
              {((authInfo?.name || 'Malli Malli').charAt(0) || 'M').toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-zinc-800 dark:text-white truncate leading-tight">
                {authInfo?.name || 'Malli Malli'}
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-[#71717a] truncate leading-tight font-mono">
                {authInfo?.email ? (authInfo.email.length > 20 ? authInfo.email.substring(0, 18) + '...' : authInfo.email) : 'mallimama9182000013...'}
              </div>
            </div>
          </div>
        </div>

        {/* Right Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#141416] p-7 overflow-y-auto custom-scrollbar">
          {selectedNav === 'appearance' && (
            <AppearanceTab
              theme={theme}
              setTheme={setTheme}
              onUpdateDark={handleUpdateDark}
              onUpdateLight={handleUpdateLight}
            />
          )}

          {(selectedNav === 'project_mash' || selectedNav.startsWith('project_')) && (
            <ProjectTab
              activeProject={activeProject}
              isDeletingProject={isDeletingProject}
              onDeleteActiveProject={handleDeleteActiveProject}
              onProjectRenamed={loadProjects}
            />
          )}

          {selectedNav === 'account' && (
            <AccountTab
              authInfo={authInfo}
              telemetryEnabled={telemetryEnabled}
              marketingEmailsEnabled={marketingEmailsEnabled}
              onToggleTelemetry={handleToggleTelemetry}
              onToggleMarketing={handleToggleMarketing}
              onShowSignOutConfirm={() => setShowSignOutConfirm(true)}
            />
          )}

          {selectedNav === 'general' && (
            <GeneralTab
              auditSettings={auditSettings}
              onUpdateAuditSettings={updateAuditSettings}
            />
          )}

          {selectedNav !== 'appearance' && selectedNav !== 'account' && selectedNav !== 'general' && !selectedNav.startsWith('project_') && (
            <div className="max-w-xl space-y-4">
              <h2 className="text-[18px] font-semibold text-zinc-900 dark:text-white capitalize">{selectedNav}</h2>
              <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl p-4 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Settings and configurations for <span className="text-zinc-900 dark:text-white font-medium capitalize">{selectedNav}</span> are loaded according to your active workspace preferences.
              </div>
            </div>
          )}
        </div>
      </div>

      <SignOutConfirmDialog
        isOpen={showSignOutConfirm}
        onConfirm={handleSignOut}
        onCancel={() => setShowSignOutConfirm(false)}
      />
    </div>
  );

  return createPortal(modalContent, document.body);
}
