import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

// 1. Verify handleNewSession in page.tsx resets right sidebar states
const pagePath = path.join(root, 'src', 'app', 'page.tsx');
const pageContent = fs.readFileSync(pagePath, 'utf-8');

assert(pageContent.includes('setIsRightSidebarOpen(false);'), 'handleNewSession must reset isRightSidebarOpen to false');
assert(pageContent.includes('setIsRightSidebarMaximized(false);'), 'handleNewSession must reset isRightSidebarMaximized to false');
assert(pageContent.includes('setFileToOpen(null);'), 'handleNewSession must clear fileToOpen');

// 2. Verify Single-Line Continuity Across LeftSidebar, ChatToolbar, and RightSidebar headers
const sidebarHeaderPath = path.join(root, 'src', 'features', 'sessions', 'components', 'SidebarHeader.tsx');
const chatToolbarPath = path.join(root, 'src', 'components', 'layout', 'ChatToolbar.tsx');
const fileTabStripPath = path.join(root, 'src', 'primitives', 'FileTabStrip.tsx');

const shContent = fs.readFileSync(sidebarHeaderPath, 'utf-8');
const ctContent = fs.readFileSync(chatToolbarPath, 'utf-8');
const ftsContent = fs.readFileSync(fileTabStripPath, 'utf-8');

const UNIFIED_BG = 'bg-zinc-100/90 dark:bg-[#121214]';
const UNIFIED_BORDER_B = 'border-b border-zinc-200/70 dark:border-white/[0.06]';

assert(shContent.includes(UNIFIED_BG), 'SidebarHeader must match unified top toolbar background');
assert(shContent.includes(UNIFIED_BORDER_B), 'SidebarHeader must match unified bottom border hairline');

assert(ctContent.includes(UNIFIED_BG), 'ChatToolbar must match unified top toolbar background');
assert(ctContent.includes(UNIFIED_BORDER_B), 'ChatToolbar must match unified bottom border hairline');

assert(ftsContent.includes(UNIFIED_BG), 'FileTabStrip must match unified top toolbar background');
assert(ftsContent.includes(UNIFIED_BORDER_B), 'FileTabStrip must match unified bottom border hairline');

// 3. Verify Sidebar vertical divider matches RightSidebar divider
const sidebarPath = path.join(root, 'src', 'features', 'sessions', 'components', 'Sidebar.tsx');
const sbContent = fs.readFileSync(sidebarPath, 'utf-8');
assert(sbContent.includes('border-r border-zinc-200/70 dark:border-white/[0.06]'), 'Sidebar border-r must match 0.06/70 hairline');

console.log('✓ All single-line connection and sidebar lifecycle contract assertions PASSED!');
