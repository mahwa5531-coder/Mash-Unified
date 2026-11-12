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

// 2. Verify Unified Outer Chrome Continuity Across TitleBar, LeftSidebar (incl. Footer), ChatToolbar, and FileTabStrip
const windowTitleBarPath = path.join(root, 'src', 'components', 'layout', 'WindowTitleBar.tsx');
const sidebarHeaderPath = path.join(root, 'src', 'features', 'sessions', 'components', 'SidebarHeader.tsx');
const sidebarFooterPath = path.join(root, 'src', 'features', 'sessions', 'components', 'SidebarFooter.tsx');
const chatToolbarPath = path.join(root, 'src', 'components', 'layout', 'ChatToolbar.tsx');
const fileTabStripPath = path.join(root, 'src', 'primitives', 'FileTabStrip.tsx');
const workbenchShellPath = path.join(root, 'src', 'primitives', 'WorkbenchShell.tsx');

const wtbContent = fs.readFileSync(windowTitleBarPath, 'utf-8');
const shContent = fs.readFileSync(sidebarHeaderPath, 'utf-8');
const sfContent = fs.readFileSync(sidebarFooterPath, 'utf-8');
const ctContent = fs.readFileSync(chatToolbarPath, 'utf-8');
const ftsContent = fs.readFileSync(fileTabStripPath, 'utf-8');
const wsContent = fs.readFileSync(workbenchShellPath, 'utf-8');

const UNIFIED_CHROME = 'bg-[var(--bg-sidebar)]';

assert(wtbContent.includes(UNIFIED_CHROME) && !wtbContent.includes('border-b '), 'WindowTitleBar must merge seamlessly without bottom border');
assert(shContent.includes(UNIFIED_CHROME) && !shContent.includes('border-b ') && shContent.includes('export function SidebarBrandToggle'), 'SidebarHeader must merge seamlessly and export shared SidebarBrandToggle');
assert(sfContent.includes(UNIFIED_CHROME) && sfContent.includes('border-transparent') && sfContent.includes('isScrolled'), 'SidebarFooter must blend when idle and differentiate when scrolled');
assert(ctContent.includes(UNIFIED_CHROME) && !ctContent.includes('border-b ') && ctContent.includes('SidebarBrandToggle'), 'ChatToolbar must merge seamlessly and reuse SidebarBrandToggle');
assert(ftsContent.includes(UNIFIED_CHROME) && !ftsContent.includes('border-b '), 'FileTabStrip must merge seamlessly without bottom border');

// 3. Verify Sidebar blends seamlessly into inset workbench box and dynamically tracks scroll overflow
const sidebarPath = path.join(root, 'src', 'features', 'sessions', 'components', 'Sidebar.tsx');
const sbContent = fs.readFileSync(sidebarPath, 'utf-8');
assert(sbContent.includes(UNIFIED_CHROME) && !sbContent.includes('border-r '), 'Sidebar must merge cleanly without border-r');
assert(sbContent.includes('ResizeObserver') && sbContent.includes('isScrolled={canScrollUp || canScrollDown}'), 'Sidebar must track scroll overflow dynamically across mount/resize and pass it to SidebarFooter');

// 4. Verify RightSidebar does not keep redundant legacy default wrapper
const rightSidebarPath = path.join(root, 'src', 'features', 'viewer', 'components', 'RightSidebar.tsx');
const rsContent = fs.readFileSync(rightSidebarPath, 'utf-8');
assert(!rsContent.includes('export default function RightSidebar'), 'Redundant standalone RightSidebar wrapper should stay removed');

// 5. Verify WorkbenchShell renders disconnected Row-2 divider & unified rounded inset box
assert(wsContent.includes('workbench-row2-divider') && wsContent.includes('w-px h-4'), 'WorkbenchShell must render short disconnected Row-2 divider when right panel open');
assert(wsContent.includes('workbench-inset-box') && wsContent.includes('rounded-xl border') && wsContent.includes('pb-1.5 pr-1.5'), 'WorkbenchShell must enclose Chat + RightViewer in one inset box with small outer gutter');

console.log('✓ All unified two-tone inset workbench chrome and sidebar lifecycle contract assertions PASSED!');
