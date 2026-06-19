import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '../../dist/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test.describe('Meeting Recorder App', () => {
  test.beforeEach(async () => {
    const backBtn = page.locator('button:has-text("← Back")')
    if (await backBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await backBtn.click()
      await page.waitForTimeout(300)
    }
    const settingsBtn = page.locator('button:has-text("Settings")')
    if (await settingsBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      // already on dashboard
    }
  })

  test('should display the dashboard', async () => {
    await expect(page.locator('h1')).toContainText('Meeting Recorder')
  })

  test('should show new recording button', async () => {
    await expect(page.locator('text=+ New Recording')).toBeVisible()
  })

  test('should open new recording dialog', async () => {
    await page.click('button:has-text("+ New Recording")')
    await expect(page.locator('h2:has-text("New Recording")')).toBeVisible()
    await expect(page.locator('button:has-text("Start Recording")')).toBeVisible()
    await expect(page.locator('button:has-text("Cancel")')).toBeVisible()
    await page.click('button:has-text("Cancel")')
  })

  test('should navigate to settings from dashboard', async () => {
    await page.click('text=Settings')
    await expect(page.locator('text=AI Provider Configuration')).toBeVisible()
    await expect(page.locator('text=Primary Provider')).toBeVisible()
  })

  test('should navigate back to dashboard from settings', async () => {
    await page.click('text=Settings')
    await page.click('text=← Back')
    await expect(page.locator('h1')).toContainText('Meeting Recorder')
  })

  test('should show AI settings with provider options', async () => {
    await page.click('text=Settings')
    await expect(page.locator('h2:has-text("AI Provider Configuration")')).toBeVisible()
    const options = await page.locator('select >> nth=0 >> option').allTextContents()
    expect(options.join(' ')).toContain('Ollama')
    expect(options.join(' ')).toContain('OpenAI')
    expect(options.join(' ')).toContain('Groq')
  })

  test('should show model selection options', async () => {
    await page.click('text=Settings')
    await page.click('text=Transcription')
    await page.waitForTimeout(500)
    await expect(page.getByText('Model Size').first()).toBeVisible()
    await expect(page.locator('select').first()).toBeVisible()
  })

  test('should toggle AI features on/off', async () => {
    await page.click('text=Settings')
    await page.waitForTimeout(1000)
    await page.waitForSelector('text=AI Features', { timeout: 5000 })
    const toggle = page.locator('text=AI Features').first()
    await toggle.scrollIntoViewIfNeeded()
    const checkbox = toggle.locator('..').locator('input[type="checkbox"]')
    await checkbox.waitFor({ timeout: 5000 })
    const initial = await checkbox.isChecked()
    await checkbox.click({ force: true })
    await page.waitForTimeout(300)
    expect(await checkbox.isChecked()).toBe(!initial)
    await checkbox.click({ force: true })
    await page.waitForTimeout(300)
    expect(await checkbox.isChecked()).toBe(initial)
  })

  test('should show dashboard heading', async () => {
    const h1 = page.locator('h1').first()
    await h1.waitFor({ timeout: 5000 })
    expect(await h1.textContent()).toContain('Meeting Recorder')
  })

  test('should navigate through settings tabs', async () => {
    await page.click('text=Settings')
    await page.click('text=Diarization')
    await expect(page.locator('text=Speaker Diarization')).toBeVisible()
    await expect(page.locator('text=Enable speaker identification')).toBeVisible()

    await page.click('text=Audio')
    await expect(page.locator('text=Audio Capture')).toBeVisible()

    await page.click('text=General')
    await expect(page.locator('text=Theme')).toBeVisible()
    await expect(page.locator('text=Font Size')).toBeVisible()
  })
})
