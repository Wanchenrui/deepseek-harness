// Keyless assembled-browser coverage for the default power-software workbench.
// The scenario boots the shipped Loader tree and makes no model or device call.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import {
  launchWebScaffold, seedSession, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = createChatScrollFixture({
  markerPrefix: 'POWER_WORKBENCH',
  title: 'POWER_WORKBENCH_SEED',
  turns: 1,
})
const SEED_ID = 'power-workbench-web-e2e'

async function openSeededSession(page: Page): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search sessions...', exact: true })
  await search.fill(FIXTURE.markers.user(1))
  const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  const deadline = Date.now() + 60_000
  for (;;) {
    if (await result.count() === 1) break
    if (Date.now() > deadline) throw new Error('power-workbench seed did not appear in search')
    await page.waitForTimeout(200)
  }
  await result.click()
}

describe('web e2e: extensible power-software workbench', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const escapedCwd = JSON.stringify(scaffold.workspaceCwd).slice(1, -1)
    await seedSession(scaffold, FIXTURE.log.split('{{cwd}}').join(escapedCwd), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeededSession(page)
    const tab = page.getByRole('tab', { name: 'Power Workbench', exact: true })
    try {
      await tab.waitFor({ timeout: 30_000 })
    } catch (cause) {
      const tabs = await page.getByRole('tab').allTextContents()
      const bootIds = await page.evaluate(() => (
        (window as unknown as { __DSH_BOOT__?: { entries?: { id: string }[] } })
          .__DSH_BOOT__?.entries?.map(entry => entry.id) ?? []
      ))
      const diagnostics = {
        tabs,
        bootIds,
        pageErrors: tripwire.pageErrors,
        warnings: tripwire.warnings,
      }
      throw new Error(
        `Power Workbench did not mount: ${JSON.stringify(diagnostics)}`,
        { cause },
      )
    }
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('mounts its independent panels through the shipped composition', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-power-workbench-composition'))
    const tab = page.getByRole('tab', { name: 'Power Workbench', exact: true })
    await tab.click()
    await expect.poll(() => tab.getAttribute('aria-selected')).toBe('true')

    const workbench = page.getByRole('main', { name: 'Power Software Engineering Console' })
    await workbench.waitFor({ timeout: 15_000 })
    await workbench.getByTestId('power-session-pulse').waitFor()
    await workbench.getByTestId('power-domain-map').waitFor()
    await workbench.getByTestId('power-verification-ladder').waitFor()
    await workbench.getByTestId('power-safety-boundary').waitFor()
    await workbench.getByTestId('power-extension-slots').waitFor()
    expect(await workbench.getByRole('button').count()).toBe(0)
    await workbench.getByText('power.workbench.overview', { exact: true }).waitFor()
    await workbench.getByText('power.workbench.workspace', { exact: true }).waitFor()
    await workbench.getByText('power.workbench.inspector', { exact: true }).waitFor()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('keeps the desktop surface inside a narrow viewport', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-power-workbench-narrow'))
    await page.setViewportSize({ width: 720, height: 1000 })
    const workbench = page.getByRole('main', { name: 'Power Software Engineering Console' })
    await expect.poll(() => workbench.evaluate(element => element.clientWidth)).toBeGreaterThan(0)
    const widths = await workbench.evaluate(element => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }))
    expect(widths.scroll).toBeLessThanOrEqual(widths.client)
    expect(tripwire.pageErrors).toEqual([])
  })
})
