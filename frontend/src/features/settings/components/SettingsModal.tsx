"use client";

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Monitor, Sun, Moon, Pencil, Folder, Plus, ChevronDown, Check, Info, Trash2, LogOut
} from 'lucide-react';
import { fetchProjects, deleteProject, ProjectItem } from '@/services/projects';
import { fetchAuthMe, logoutUser, AuthUser } from '@/services/auth';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

interface ThemeConfig {
  mode: 'system' | 'light' | 'dark';
  light: {
    preset: string;
    background: string;
    foreground: string;
    accent: string;
  };
  dark: {
    preset: string;
    background: string;
    foreground: string;
    accent: string;
  };
}

const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'dark',
  light: {
    preset: 'Default Light',
    background: '#F9F9F9',
    foreground: '#101010',
    accent: '#007ACC',
  },
  dark: {
    preset: 'Default Dark',
    background: '#101010',
    foreground: '#CCCCCC',
    accent: '#007ACC',
  },
};

function sanitizeThemeConfig(raw: any): ThemeConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_THEME_CONFIG;
  return {
    mode: (raw.mode === 'system' || raw.mode === 'light' || raw.mode === 'dark') ? raw.mode : DEFAULT_THEME_CONFIG.mode,
    light: {
      preset: raw.light?.preset || DEFAULT_THEME_CONFIG.light.preset,
      background: raw.light?.background || DEFAULT_THEME_CONFIG.light.background,
      foreground: raw.light?.foreground || DEFAULT_THEME_CONFIG.light.foreground,
      accent: raw.light?.accent || DEFAULT_THEME_CONFIG.light.accent,
    },
    dark: {
      preset: raw.dark?.preset || DEFAULT_THEME_CONFIG.dark.preset,
      background: raw.dark?.background || DEFAULT_THEME_CONFIG.dark.background,
      foreground: raw.dark?.foreground || DEFAULT_THEME_CONFIG.dark.foreground,
      accent: raw.dark?.accent || DEFAULT_THEME_CONFIG.dark.accent,
    },
  };
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onThemeChange?: (isDark: boolean) => void;
  initialTab?: string;
  currentProjectName?: string;
  onProjectDeleted?: (projectName: string) => void;
  onSignOut?: () => void;
}

/** Theme accent color picker field with swatch preview and hex input */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
}) {
  const colorInputRef = useRef<HTMLInputElement>(null);
  const cleanHex = value.startsWith('#') ? value : `#${value}`;

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-zinc-700 dark:text-zinc-300 font-normal text-[13px]">{label}</span>
      <div 
        onClick={() => colorInputRef.current?.click()}
        className="flex items-center gap-2 bg-white dark:bg-[#202023] hover:bg-zinc-100 dark:hover:bg-[#252529] border border-zinc-200 dark:border-[#2e2e32] hover:border-zinc-300 dark:hover:border-[#3e3e44] rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors"
      >
        <div 
          className="w-3.5 h-3.5 rounded-[3px] border border-black/20 shrink-0 shadow-sm"
          style={{ backgroundColor: cleanHex }}
        />
        <input
          ref={colorInputRef}
          type="color"
          value={cleanHex.length === 7 ? cleanHex : '#101010'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="sr-only"
        />
        <span className="text-zinc-400 font-mono text-xs select-none">#</span>
        <input
          type="text"
          value={cleanHex.replace(/^#/, '')}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
            onChange('#' + raw.toUpperCase());
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-16 bg-transparent text-zinc-800 dark:text-zinc-200 font-mono text-xs outline-none uppercase tracking-wider"
          maxLength={6}
        />
      </div>
    </div>
  );
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
      const tel = localStorage.getItem('mash_telemetry');
      if (tel !== null) setTelemetryEnabled(tel === 'true');
      const mkt = localStorage.getItem('mash_marketing');
      if (mkt !== null) setMarketingEmailsEnabled(mkt === 'true');
    } catch {}
  }, []);

  // When opened, reload real projects, auth info, and reset tab
  useEffect(() => {
    if (isOpen) {
      loadProjects();
      loadAuth();
      setSelectedNav(initialTab || 'appearance');
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
        {/* Pinned Stationary Close Button - positioned on outer modal container so it NEVER scrolls with right pane */}
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
                  { id: 'application', label: 'Application' },
                  { id: 'browser', label: 'Browser' },
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

            {/* Projects Section - Real Data with Isolated Buttons */}
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

                {/* Dynamically show 'Show more' / 'Show less' only when there are more than 4 projects */}
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

          {/* User Profile Chip - Bottom of Left Sidebar */}
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

          {/* TAB 1: Appearance */}
          {selectedNav === 'appearance' && (
            <div className="max-w-xl space-y-6">
              <h2 className="text-[18px] font-semibold text-zinc-900 dark:text-white">Appearance</h2>

              {/* Theme Selector Row */}
              <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl px-4 py-3.5 flex items-center justify-between">
                <span className="text-[13px] font-normal text-zinc-700 dark:text-zinc-300">Theme</span>
                <div className="bg-zinc-100 dark:bg-[#0d0d0f] border border-zinc-200 dark:border-[#242426] p-1 rounded-lg flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setTheme(prev => ({ ...prev, mode: 'system' }))}
                    className={`p-1.5 rounded-md transition-all cursor-pointer ${
                      theme.mode === 'system' ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                    title="System Default"
                  >
                    <Monitor size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme(prev => ({ ...prev, mode: 'light' }))}
                    className={`p-1.5 rounded-md transition-all cursor-pointer ${
                      theme.mode === 'light' ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                    title="Light Theme"
                  >
                    <Sun size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme(prev => ({ ...prev, mode: 'dark' }))}
                    className={`p-1.5 rounded-md transition-all cursor-pointer ${
                      theme.mode === 'dark' ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                    title="Dark Theme"
                  >
                    <Moon size={14} />
                  </button>
                </div>
              </div>

              {/* Light Theme Card */}
              <div>
                <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 mb-2">Light Theme</h3>
                <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl divide-y divide-zinc-200 dark:divide-[#27272a] overflow-hidden text-xs">
                  {/* Preset */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-zinc-700 dark:text-zinc-300 font-normal text-[13px]">Preset</span>
                    <div className="relative">
                      <select
                        value={theme.light.preset}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'Default Light') {
                            setTheme(prev => ({
                              ...prev,
                              light: { preset: 'Default Light', background: '#F9F9F9', foreground: '#101010', accent: '#007ACC' }
                            }));
                          } else if (val === 'Pure White') {
                            setTheme(prev => ({
                              ...prev,
                              light: { preset: 'Pure White', background: '#FFFFFF', foreground: '#111111', accent: '#007ACC' }
                            }));
                          }
                        }}
                        className="appearance-none bg-white dark:bg-[#202023] hover:bg-zinc-100 dark:hover:bg-[#252529] border border-zinc-200 dark:border-[#2e2e32] hover:border-zinc-300 dark:hover:border-[#3e3e44] text-zinc-800 dark:text-zinc-200 rounded-lg pl-3 pr-7 py-1.5 text-xs outline-none cursor-pointer transition-colors"
                      >
                        <option value="Default Light">Default Light</option>
                        <option value="Pure White">Pure White</option>
                        {theme.light.preset === 'Custom' && <option value="Custom">Custom</option>}
                      </select>
                      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* Background */}
                  <ColorField
                    label="Background"
                    value={theme.light.background}
                    onChange={(val) => handleUpdateLight('background', val)}
                  />

                  {/* Foreground */}
                  <ColorField
                    label="Foreground"
                    value={theme.light.foreground}
                    onChange={(val) => handleUpdateLight('foreground', val)}
                  />

                  {/* Accent */}
                  <ColorField
                    label="Accent"
                    value={theme.light.accent}
                    onChange={(val) => handleUpdateLight('accent', val)}
                  />
                </div>
              </div>

              {/* Dark Theme Card */}
              <div>
                <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 mb-2">Dark Theme</h3>
                <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl divide-y divide-zinc-200 dark:divide-[#27272a] overflow-hidden text-xs">
                  {/* Preset */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-zinc-700 dark:text-zinc-300 font-normal text-[13px]">Preset</span>
                    <div className="relative">
                      <select
                        value={theme.dark.preset}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'Default Dark') {
                            setTheme(prev => ({
                              ...prev,
                              dark: { preset: 'Default Dark', background: '#101010', foreground: '#CCCCCC', accent: '#007ACC' }
                            }));
                          } else if (val === 'OLED Black') {
                            setTheme(prev => ({
                              ...prev,
                              dark: { preset: 'OLED Black', background: '#000000', foreground: '#EDEDED', accent: '#007ACC' }
                            }));
                          } else if (val === 'Antigravity Grey') {
                            setTheme(prev => ({
                              ...prev,
                              dark: { preset: 'Antigravity Grey', background: '#141416', foreground: '#EDEDED', accent: '#007ACC' }
                            }));
                          }
                        }}
                        className="appearance-none bg-white dark:bg-[#202023] hover:bg-zinc-100 dark:hover:bg-[#252529] border border-zinc-200 dark:border-[#2e2e32] hover:border-zinc-300 dark:hover:border-[#3e3e44] text-zinc-800 dark:text-zinc-200 rounded-lg pl-3 pr-7 py-1.5 text-xs outline-none cursor-pointer transition-colors"
                      >
                        <option value="Default Dark">Default Dark</option>
                        <option value="OLED Black">OLED Black</option>
                        <option value="Antigravity Grey">Antigravity Grey</option>
                        {theme.dark.preset === 'Custom' && <option value="Custom">Custom</option>}
                      </select>
                      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* Background */}
                  <ColorField
                    label="Background"
                    value={theme.dark.background}
                    onChange={(val) => handleUpdateDark('background', val)}
                  />

                  {/* Foreground */}
                  <ColorField
                    label="Foreground"
                    value={theme.dark.foreground}
                    onChange={(val) => handleUpdateDark('foreground', val)}
                  />

                  {/* Accent */}
                  <ColorField
                    label="Accent"
                    value={theme.dark.accent}
                    onChange={(val) => handleUpdateDark('accent', val)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Project Settings - Theme Adaptive */}
          {(selectedNav === 'project_mash' || selectedNav.startsWith('project_')) && (
            <div className="max-w-xl space-y-6">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[18px] font-semibold text-zinc-900 dark:text-white">{activeProject.name}</h2>
                  <Pencil size={13} className="text-zinc-400 cursor-pointer hover:text-zinc-700 dark:hover:text-white" />
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Manage project folders, agent settings, and permissions.</p>
              </div>

              {/* Folders */}
              {/* Project Folder */}
              <div>
                <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-2">Project Folder</h3>
                <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl p-3">
                  <div className="flex items-center gap-2.5 px-3 py-2 bg-white dark:bg-[#202023] rounded-lg border border-zinc-300 dark:border-[#2e2e32] text-xs">
                    <Folder size={15} className="text-zinc-400 shrink-0" />
                    <span className="truncate text-zinc-700 dark:text-zinc-200 font-mono text-[11.5px]">
                      {activeProject.local_folder_path || `${activeProject.name}/`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="pt-2">
                <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-2">Danger Zone</h3>
                <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold text-zinc-900 dark:text-white">Delete Project</div>
                    <div className="text-[11.5px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-normal">
                      Permanently delete <strong className="font-semibold text-zinc-800 dark:text-zinc-200">{activeProject.name}</strong> including{' '}
                      <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
                        {activeProject.session_count || 0} active conversation{(activeProject.session_count || 0) !== 1 ? 's' : ''}
                      </strong>.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isDeletingProject}
                    onClick={handleDeleteActiveProject}
                    className="px-4 py-2 bg-[#dc3545] hover:bg-[#c82333] active:bg-[#bd2130] text-white text-xs font-medium rounded-lg shadow-sm transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    {isDeletingProject ? 'Deleting...' : 'Delete Project'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: Account Profile & Preferences */}
          {selectedNav === 'account' && (
            <div className="max-w-xl space-y-6">
              <div>
                <h2 className="text-[18px] font-semibold text-zinc-900 dark:text-white">Account</h2>
                <p className="text-xs text-zinc-500 dark:text-[#71717a] mt-0.5">Manage your plan, credentials, and desktop preferences.</p>
              </div>

              {/* General Section */}
              <div>
                <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mb-2">General</h3>
                <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl overflow-hidden divide-y divide-zinc-200 dark:divide-[#242426]">
                  {/* Enable Telemetry */}
                  <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium text-zinc-800 dark:text-white">Enable Telemetry</div>
                      <div className="text-[11.5px] text-zinc-500 dark:text-[#71717a] mt-0.5 leading-normal">
                        When toggled on, MASH collects anonymous usage telemetry to improve agent accuracy and latency.
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={telemetryEnabled}
                      onClick={handleToggleTelemetry}
                      className={`w-11 h-6 shrink-0 rounded-full transition-colors relative cursor-pointer ${
                        telemetryEnabled ? 'bg-[#007acc]' : 'bg-zinc-300 dark:bg-[#28282b]'
                      }`}
                    >
                      <span
                        className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                          telemetryEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Marketing Emails */}
                  <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium text-zinc-800 dark:text-white">Product Updates</div>
                      <div className="text-[11.5px] text-zinc-500 dark:text-[#71717a] mt-0.5 leading-normal">
                        Receive product updates, tips, and release notices from MASH via email.
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={marketingEmailsEnabled}
                      onClick={handleToggleMarketing}
                      className={`w-11 h-6 shrink-0 rounded-full transition-colors relative cursor-pointer ${
                        marketingEmailsEnabled ? 'bg-[#007acc]' : 'bg-zinc-300 dark:bg-[#28282b]'
                      }`}
                    >
                      <span
                        className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                          marketingEmailsEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Account Section */}
              <div>
                <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mb-2">Account</h3>
                <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl overflow-hidden divide-y divide-zinc-200 dark:divide-[#242426]">
                  {/* Your Plan */}
                  <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium text-zinc-800 dark:text-white">
                        Your Plan: {authInfo?.plan ? `MASH ${authInfo.plan.toUpperCase()}` : 'MASH Pro'}
                      </div>
                      <div className="text-[11.5px] text-zinc-500 dark:text-[#71717a] mt-0.5 leading-normal">
                        {authInfo?.credits_remaining !== undefined ? `${authInfo.credits_remaining} credits available for code generation and audit runs.` : 'Pro plan active with full workspace access.'}
                      </div>
                    </div>
                  </div>

                  {/* Email & Sign Out */}
                  <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium text-zinc-800 dark:text-white">Email</div>
                      <div className="text-[11.5px] text-zinc-500 dark:text-[#71717a] mt-0.5 leading-normal font-mono">
                        {authInfo?.email || 'malli@mash.ai'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSignOutConfirm(true)}
                      className="px-4 py-1.5 bg-red-500/10 hover:bg-red-500/20 active:bg-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium rounded-lg border border-red-500/20 transition-colors cursor-pointer shrink-0"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              </div>

              {/* Footer Agreement */}
              <div className="pt-2 text-xs text-[#71717a]">
                By using this app, you agree to its{' '}
                <a
                  href="https://policies.google.com/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#007acc] hover:underline cursor-pointer"
                >
                  Terms of Service
                </a>
              </div>
            </div>
          )}

          {/* OTHER TABS (Fallback for General, Application, Models, etc.) */}
          {selectedNav !== 'appearance' && selectedNav !== 'account' && !selectedNav.startsWith('project_') && (
            <div className="max-w-xl space-y-4">
              <h2 className="text-[18px] font-semibold text-white capitalize">{selectedNav}</h2>
              <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 text-xs text-zinc-400 leading-relaxed">
                Settings and configurations for <span className="text-white font-medium capitalize">{selectedNav}</span> are loaded according to your active workspace preferences.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 32px shadcn Card for Logout Confirmation */}
      {showSignOutConfirm && (
        <div 
          className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={(e) => { e.stopPropagation(); setShowSignOutConfirm(false); }}
        >
          <Card 
            className="w-full max-w-sm rounded-[32px] p-8 border border-zinc-200/80 dark:border-white/[0.08] shadow-2xl bg-white dark:bg-[#141416] text-center select-none animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="p-0 mb-4 flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mb-3 border border-red-500/20 shadow-xs">
                <LogOut size={24} />
              </div>
              <CardTitle className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Sign out of MASH?
              </CardTitle>
              <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
                Your working papers, local audit files, and session history will remain safely preserved on your machine.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full h-10 rounded-2xl font-medium text-xs bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white shadow-sm transition-all cursor-pointer flex items-center justify-center"
              >
                Sign Out
              </button>
              <button
                type="button"
                onClick={() => setShowSignOutConfirm(false)}
                className="w-full h-10 rounded-2xl font-medium text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-all cursor-pointer flex items-center justify-center"
              >
                Cancel
              </button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}
