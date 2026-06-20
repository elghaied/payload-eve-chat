/**
 * E2E: Eve creates a task via the admin chat UI.
 *
 * Prerequisites:
 *   - A running dev server on :3000 (handled by playwright.config.ts webServer;
 *     reuseExistingServer is true so a pre-running `pnpm dev` is reused).
 *   - AI Gateway auth: VERCEL_OIDC_TOKEN (run `vercel env pull .env.local`) or
 *     AI_GATEWAY_API_KEY, with a credit card on the linked Vercel team.
 *   - EVE_MODEL set to a tool-calling model (default: openai/gpt-oss-120b via groq).
 *     NOTE: llama-3.3-70b-versatile emits malformed tool calls and WILL fail.
 *   - MongoDB accessible (MONGODB_URI in .env.local).
 *
 * A beforeAll guard checks GET /eve/v1/health first: the Eve runtime is a SEPARATE
 * `eve dev` child process (not managed by Playwright's webServer), so if it's down the
 * app 500s and the test would fail confusingly. The guard turns that into a clear error.
 *
 * The test is self-contained: it seeds its own admin user (via the Payload
 * Node API, same pattern as admin.e2e.spec.ts) and cleans up after itself.
 * It does NOT depend on a pre-existing account.
 *
 * Assertion strategy: rather than matching the model's prose (which is
 * nondeterministic), the test navigates to /admin/collections/tasks after the
 * agent turn and asserts the unique task title is visible in the list view.
 *
 * Completion detection: after pressing Enter the test waits for the submit
 * button to transition to aria-label="Stop" (streaming started) and then
 * back to aria-label="Submit" (agent idle). This two-phase wait is necessary
 * because the button already has aria-label="Submit" before the first send.
 */

import { test, expect, Page } from '@playwright/test'
import { login } from '../helpers/login'
import { seedTestUser, cleanupTestUser, testUser } from '../helpers/seedUser'

const SERVER_URL = 'http://localhost:3000'

// ── Unique task title per run ────────────────────────────────────────────────
// Computed once at module-evaluation time so it stays stable for the whole run.
const TASK_TITLE = `PW Smoke Task ${Date.now()}`
const PROMPT = `Create a task titled "${TASK_TITLE}" with priority high`

// ── Timeouts ─────────────────────────────────────────────────────────────────
// Generous ceiling for the full agent turn: streaming + MCP tool call roundtrip.
const EVE_TURN_TIMEOUT_MS = 90_000
// How long to wait for the composer to be interactive after navigation.
const COMPOSER_READY_TIMEOUT_MS = 20_000

test.describe('Eve chat — task creation', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    // Fail fast & legibly if the Eve runtime (separate `eve dev` child) is unreachable.
    const health = await fetch(`${SERVER_URL}/eve/v1/health`).catch(() => null)
    if (!health || !health.ok) {
      throw new Error(
        `Eve runtime not reachable at ${SERVER_URL}/eve/v1/health ` +
          `(status: ${health?.status ?? 'no response'}). Start the app with \`pnpm devsafe\` ` +
          `so the eve dev child process is running before the e2e.`,
      )
    }

    await seedTestUser()

    const context = await browser.newContext()
    page = await context.newPage()

    await login({ page, serverURL: SERVER_URL, user: testUser })
  })

  test.afterAll(async () => {
    await cleanupTestUser()
  })

  test('Eve creates a task from the admin chat UI', async () => {
    // ── 1. Navigate to the Eve chat page ────────────────────────────────────
    await page.goto(`${SERVER_URL}/admin/eve`)

    // Wait for the React component to hydrate: the composer textarea must be
    // interactive (editable) before we type.
    const composer = page.getByPlaceholder('Message Eve…')
    await expect(composer).toBeVisible({ timeout: COMPOSER_READY_TIMEOUT_MS })
    await expect(composer).toBeEditable({ timeout: COMPOSER_READY_TIMEOUT_MS })

    // ── 2. Type the prompt and submit via Enter ──────────────────────────────
    await composer.fill(PROMPT)
    await page.keyboard.press('Enter')

    // ── 3. Wait for agent to START (button transitions from "Submit" → "Stop")
    //       then wait for it to FINISH ("Stop" → "Submit").
    //       This two-phase approach avoids the false-positive where the button
    //       already says "Submit" before the first message is sent.
    const stopBtn = page.getByRole('button', { name: 'Stop' })
    await expect(stopBtn).toBeVisible({ timeout: 15_000 })

    const submitBtn = page.getByRole('button', { name: 'Submit' })
    await expect(submitBtn).toBeVisible({ timeout: EVE_TURN_TIMEOUT_MS })

    // ── 4. Assert the task was actually created ──────────────────────────────
    // Navigate to the tasks collection list view and look for the unique title.
    await page.goto(`${SERVER_URL}/admin/collections/tasks`)
    await expect(page.getByText(TASK_TITLE, { exact: false })).toBeVisible({
      timeout: 15_000,
    })
  })

  test('reopening a thread replays its history (B2)', async () => {
    const marker = `Ping ${Date.now()}`

    // Start a fresh thread with a distinctive user message.
    await page.goto(`${SERVER_URL}/admin/eve`)
    const composer = page.getByPlaceholder('Message Eve…')
    await expect(composer).toBeEditable({ timeout: COMPOSER_READY_TIMEOUT_MS })
    await composer.fill(`Say "${marker}" back to me.`)
    await page.keyboard.press('Enter')

    // Wait for the turn to start then finish (button "Submit" → "Stop" → "Submit").
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({
      timeout: EVE_TURN_TIMEOUT_MS,
    })

    // The app adopted the new session into the URL (?conversation=<id>).
    await page.waitForURL(/\?conversation=/, { timeout: 15_000 })
    const threadUrl = page.url()

    // Wait for the session index to be persisted server-side before reloading.
    // (persistSession is fire-and-forget; a full reload before it settles would
    // find no Conversations row, so the cursor — and thus the replay — would be lost.)
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`${SERVER_URL}/api/conversations?limit=1`)
          const json = await res.json()
          return json.totalDocs ?? 0
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0)

    // Reload the thread from scratch — EveView loads the stored cursor and EveChat
    // replays history into the transcript.
    await page.goto(threadUrl)

    // History must replay: the original user message is visible again (the transcript
    // was empty on reopen before B2).
    await expect(page.getByText(marker, { exact: false }).first()).toBeVisible({
      timeout: EVE_TURN_TIMEOUT_MS,
    })
  })
})
