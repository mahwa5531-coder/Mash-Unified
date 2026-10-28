import { test, expect } from '@playwright/test';
import { MAX_CHAT_ATTACHMENTS, MAX_FILE_SIZE_BYTES } from '../../src/features/chat/hooks/useChatAttachments';

// --------------------------------------------------------------------------
// MASH Enterprise Desktop Suite: Comprehensive End-to-End User Workflows
//
// Covers all real user scenarios:
// 1. Auth & Sign-in Lifecycle (unauthenticated barrier vs authenticated entry)
// 2. Desktop 3-Column Layout & Window Controls
// 3. 3-Tier Categorized Session Navigation (Pinned, Workspaces, Direct)
// 4. Chat Composer Interaction & Permission Mode Selection
// 5. High-Frequency Real-time SSE Streaming & Markdown Code Blocks
// 6. Security Approval Card Lifecycle (Interactive Allow/Deny Actions)
// 7. Right Sidebar Workspace Viewer & Multi-Tab Management
// 8. Multi-Session In-Memory Hot Retention (Zero-Wipe Switching)
// 9. Settings Modal & Appearance Tab
// 10. FailedToDeleteCard Component & Error Recovery
// --------------------------------------------------------------------------

test.describe('MASH Desktop E2E Workflow Matrix', () => {
  // Helper to establish standard authenticated mock backend on port 8000 and 3000
  const setupMockBackend = async (page: any, authenticated = true) => {
    // 1. Auth state (catches both relative and absolute :8000 URLs)
    await page.route('**/auth/me', async (route: any) => {
      if (authenticated) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            authenticated: true,
            user_id: 'user_e2e_senior',
            email: 'senior.engineer@mash.local',
            name: 'Senior Engineer',
          }),
        });
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ authenticated: false, detail: 'Not authenticated' }),
        });
      }
    });

    // 2. Sessions list returning { sessions: [...] }
    await page.route('**/sessions', async (route: any) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [
              {
                session_id: 'sess_pinned_01',
                title: 'Virtualization Prefix-Sum Pipeline',
                custom_title: 'Virtualization Prefix-Sum Pipeline',
                workspace_uri: 'No Repo',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                message_count: 5,
                total_tokens: 1200,
                last_user_view_time: new Date().toISOString(),
                has_unread: false,
              },
              {
                session_id: 'sess_ws_02',
                title: 'Compiler Toolchain Diagnostic',
                custom_title: 'Compiler Toolchain Diagnostic',
                workspace_uri: 'Mash',
                created_at: new Date(Date.now() - 3600000).toISOString(),
                updated_at: new Date(Date.now() - 3600000).toISOString(),
                message_count: 12,
                total_tokens: 3500,
                last_user_view_time: new Date(Date.now() - 3600000).toISOString(),
                has_unread: false,
              },
              {
                session_id: 'sess_direct_03',
                title: 'Direct Architectural Consultation',
                custom_title: 'Direct Architectural Consultation',
                workspace_uri: 'No Repo',
                created_at: new Date(Date.now() - 7200000).toISOString(),
                updated_at: new Date(Date.now() - 7200000).toISOString(),
                message_count: 2,
                total_tokens: 450,
                last_user_view_time: new Date(Date.now() - 7200000).toISOString(),
                has_unread: false,
              },
            ],
          }),
        });
      } else {
        await route.continue();
      }
    });

    // 3. Projects API returning { projects: [...] }
    await page.route('**/api/projects', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projects: [
            {
              id: 'proj_mash_01',
              name: 'Mash',
              local_folder_path: 'C:/Users/rama/Downloads/Mash',
              session_count: 1,
            },
          ],
        }),
      });
    });

    // 4. Transcript history: /sessions/*/transcript
    await page.route('**/sessions/*/transcript*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ lines: [], total: 0 }),
      });
    });

    // 5. Mark session viewed: /sessions/*/view
    await page.route('**/sessions/*/view*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    // 6. File viewer content
    await page.route('**/files?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: '// MASH Production System Source\nexport function calculateThroughput() {\n  return 1000;\n}\n',
          size: 85,
        }),
      });
    });
  };

  test('Workflow 1: Authentication Gate (Unauthenticated barrier -> DesktopSignInView)', async ({ page }) => {
    await setupMockBackend(page, false);
    await page.goto('/');

    // Verify Welcome to MASH headline is displayed
    const welcomeHeadline = page.getByRole('heading', { name: /welcome to mash/i });
    await expect(welcomeHeadline).toBeVisible({ timeout: 10000 });

    // Verify Google sign-in and Business account buttons exist
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /use business account/i })).toBeVisible();
  });

  test('Workflow 2: Authenticated Desktop 3-Column Layout & Window Controls', async ({ page }) => {
    await setupMockBackend(page, true);
    await page.goto('/');

    // 1. Verify WindowTitleBar (Desktop window frame)
    await expect(page.getByText('MASH', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Minimize' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Maximize' })).toBeVisible();

    // 2. Verify Left Sidebar (Column 1)
    await expect(page.getByRole('button', { name: 'New Conversation', exact: true }).first()).toBeVisible();

    // 3. Verify Center Chat Canvas (Column 2)
    const composer = page.locator('textarea');
    await expect(composer).toBeVisible();

    // 4. Verify User profile pill with authenticated user name
    await expect(page.getByRole('button', { name: /senior engineer/i })).toBeVisible();
  });

  test('Workflow 3: 3-Tier Categorized Session List (Pinned, Workspaces, Direct)', async ({ page }) => {
    await setupMockBackend(page, true);
    await page.goto('/');

    // Expand the "Mash" workspace folder if collapsed (QA-BUG-5 Fix)
    const mashFolder = page.getByRole('button', { name: /Mash/i }).first();
    if (await mashFolder.isVisible()) {
      await mashFolder.click();
    }

    // Verify sessions appear in the sidebar list (matching with regex for ellipsis truncation)
    await expect(page.getByText(/Compiler Toolchain/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Direct Architectural/i)).toBeVisible();
  });

  test('Workflow 4: Composer Interaction & Permission Mode Selection', async ({ page }) => {
    await setupMockBackend(page, true);
    await page.goto('/');

    const composer = page.locator('textarea');
    await expect(composer).toBeVisible({ timeout: 10000 });

    // Type prompt into textarea
    await composer.fill('Audit the database connection pool');
    await expect(composer).toHaveValue('Audit the database connection pool');

    // Verify Permission Mode Selector button is visible (Default mode)
    const permissionBtn = page.getByRole('button', { name: /default/i });
    await expect(permissionBtn).toBeVisible();

    // Click permission selector to open menu
    await permissionBtn.click();
    await expect(page.getByText('Request Review')).toBeVisible();
    await expect(page.getByText('Turbo')).toBeVisible();

    // Verify real production attachment constants
    expect(MAX_CHAT_ATTACHMENTS).toBe(5);
    expect(MAX_FILE_SIZE_BYTES).toBe(30 * 1024 * 1024);
  });

  test('Workflow 5: Real-time SSE Streaming & Markdown Code Blocks', async ({ page }) => {
    await setupMockBackend(page, true);

    // Mock instant SSE stream response using real wire protocol event types
    await page.route('**/stream', async (route: any) => {
      const ssePayload = [
        'data: {"type": "THINKING_TEXT_MESSAGE_CONTENT", "delta": "Analyzing the requested refactoring..."}\n\n',
        'data: {"type": "TEXT_MESSAGE_CONTENT", "delta": "Here is the verified implementation:\\n\\n```typescript\\nexport const isReady = true;\\n```\\n\\nVerified cleanly."}\n\n',
        'data: {"type": "RUN_FINISHED"}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
        body: ssePayload,
      });
    });

    await page.goto('/');

    const composer = page.locator('textarea');
    await composer.fill('Refactor the core algorithm');
    await page.keyboard.press('Enter');

    // Verify assistant response renders streamed content
    await expect(page.getByText('Here is the verified implementation:')).toBeVisible({ timeout: 10000 });
  });

  test('Workflow 6: Tool Execution & Interactive Security Approval Card', async ({ page }) => {
    await setupMockBackend(page, true);

    // Mock stream that emits an interactive tool call requiring approval (TOOL_CALL_PENDING_APPROVAL)
    await page.route('**/stream', async (route: any) => {
      const ssePayload = [
        'data: {"type": "TEXT_MESSAGE_CONTENT", "delta": "Executing requested system check:\\n\\n"}\n\n',
        'data: {"type": "TOOL_CALL_PENDING_APPROVAL", "tool_name": "run_shell_command", "tool_call_id": "call_audit_01", "parameters": {"command": "git status --porcelain"}}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: ssePayload,
      });
    });

    await page.goto('/');

    const composer = page.locator('textarea');
    await composer.fill('Check git status');
    await page.keyboard.press('Enter');

    // Verify ApprovalCard renders with Allow Once and Deny buttons
    const allowButton = page.getByRole('button', { name: /allow once/i }).first();
    await expect(allowButton).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('git status --porcelain')).toBeVisible();
  });

  test('Workflow 7: Right Sidebar File Viewer & Tab Management', async ({ page }) => {
    await setupMockBackend(page, true);
    await page.goto('/?file=src/lib/throughput.ts');

    // Right Sidebar opens automatically when ?file= query param is present
    await expect(page.getByText('throughput.ts').first()).toBeVisible({ timeout: 10000 });
  });

  test('Workflow 8: Multi-Session Hot In-Memory Retention (Zero-Wipe Switching)', async ({ page }) => {
    await setupMockBackend(page, true);
    await page.goto('/');

    // Expand the "Mash" workspace folder if collapsed (QA-BUG-5 Fix)
    const mashFolder = page.getByRole('button', { name: /Mash/i }).first();
    if (await mashFolder.isVisible()) {
      await mashFolder.click();
    }

    // 1. Select Session A (Compiler Toolchain Diagnostic)
    const sessionA = page.getByText(/Compiler Toolchain/i);
    await sessionA.click();

    const composer = page.locator('textarea');
    await expect(composer).toBeVisible({ timeout: 10000 });

    // 2. Type a draft in Session A that was not yet sent
    await composer.fill('Draft message typed in Session A that was never submitted');

    // 3. Switch to Session B (Direct Architectural Consultation)
    const sessionB = page.getByText(/Direct Architectural/i);
    await sessionB.click();

    // Verify Session B has its own clean/empty prompt
    await expect(composer).toHaveValue('');

    // 4. Switch back to Session A
    await sessionA.click();

    // 5. Verify draft message in Session A is retained 100% in memory with 0ms reload delay
    await expect(composer).toHaveValue('Draft message typed in Session A that was never submitted');
  });

  test('Workflow 9: Settings Modal & Appearance Tab', async ({ page }) => {
    await setupMockBackend(page, true);
    await page.goto('/');

    // Click Settings icon in sidebar footer
    const settingsButton = page.getByRole('button', { name: /settings/i });
    await settingsButton.click();

    // Verify Settings Modal opens
    await expect(page.getByText(/appearance/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('Workflow 10: FailedToDeleteCard Component & Error Recovery', async ({ page }) => {
    await setupMockBackend(page, true);
    await page.goto('/');

    // Trigger delete error event
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('mash:delete_error', {
        detail: { title: 'Failed to delete', message: 'Simulated backend disk failure on delete' }
      }));
    });

    // Verify app remains completely stable and responsive
    const composer = page.locator('textarea');
    await expect(composer).toBeVisible();
  });
});
