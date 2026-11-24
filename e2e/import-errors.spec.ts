import { test, expect } from './fixtures.ts'

const file = (name: string, content: string | number[]) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(typeof content === 'string' ? content : Uint8Array.from(content)) })

const UNREADABLE = [
  { why: 'plain text', f: file('notes.txt', 'hello world\nthis is not a usage export\n'), message: 'No usage columns recognised' },
  { why: 'binary data named .csv', f: file('image.csv', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0xff, 0xfe, 0, 1, 2]), message: 'No usage columns recognised' },
  { why: 'truncated JSON', f: file('cut.json', '{"usage":[{"org_name":"x","month":"2022-05-01T00:00:00+00:00","values":{"apm_host_usa'), message: 'Unrecognised JSON' },
  { why: 'JSON from an unrelated API', f: file('other.json', '{"hello":"world"}'), message: 'Unrecognised JSON' },
  { why: 'an API response with no records', f: file('empty-response.json', '{"usage":[]}'), message: 'This response has no records' },
  { why: 'a header row and nothing else', f: file('header-only.csv', 'month,team,infra_host_usage\n'), message: 'Needs a header row and at least one data row' },
]

test.describe('files the importer cannot use', () => {
  for (const { why, f, message } of UNREADABLE) {
    test(`${why}: says why, imports nothing, app stays usable`, async ({ page }) => {
      await page.goto('/app?import=1')
      await page.locator('input[type=file]').setInputFiles(f)

      // A visible reason, and no way to import anything from this file.
      await expect(page.getByRole('heading', { name: new RegExp(`^Detected: ${message}`) })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Validation report' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Import/ })).toHaveCount(0)

      // Still usable: an example file goes all the way through, and only it is saved.
      await page.getByRole('button', { name: 'Monthly attribution CSV' }).click()
      await expect(page.getByRole('heading', { name: 'Detected: Monthly usage attribution by tag (CSV)' })).toBeVisible()
      await page.getByRole('button', { name: /^Import \d+ months?$/ }).click()
      await expect(page.getByRole('heading', { name: 'Cost by team' })).toBeVisible()
      await page.goto('/app')
      await expect(page.locator('.proj-card')).toHaveCount(1)
    })
  }

  for (const { why, content } of [
    { why: 'an empty file (0 bytes)', content: '' },
    { why: 'a file of only whitespace', content: ' \n\t\r\n  \n' },
    { why: 'a file of only a byte order mark', content: '\uFEFF' },
  ]) {
    test(`${why}: says it is empty, imports nothing, app stays usable`, async ({ page }) => {
      await page.goto('/app?import=1')
      await page.locator('input[type=file]').setInputFiles(file('empty.csv', content))

      const alert = page.getByRole('alert')
      await expect(alert).toContainText('This file is empty')
      await expect(alert).toContainText('empty.csv')
      await expect(page.getByRole('heading', { name: /^Detected:/ })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Import/ })).toHaveCount(0)

      // Choosing a real file replaces the message.
      await page.locator('input[type=file]').setInputFiles(file('ok.csv', 'month,team,infra_host_usage\n2026-10,a,5\n'))
      await expect(page.getByRole('heading', { name: /^Detected:/ })).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
    })
  }

  test('the empty-file message goes away with an example, and an empty file replaces an earlier detection', async ({ page }) => {
    await page.goto('/app?import=1')
    const input = page.locator('input[type=file]')
    await input.setInputFiles(file('empty.csv', ''))
    await expect(page.getByRole('alert')).toContainText('This file is empty')
    await page.getByRole('button', { name: 'Log volume by index' }).click()
    await expect(page.getByRole('heading', { name: 'Detected: Log volume by index' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)

    // A good file was loaded; an empty one now replaces it instead of leaving it on screen.
    await input.setInputFiles(file('empty2.csv', ''))
    await expect(page.getByRole('alert')).toContainText('empty2.csv')
    await expect(page.getByRole('heading', { name: /^Detected:/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Import/ })).toHaveCount(0)
  })

  test('pasting an empty or blank string does not show the empty-file message', async ({ page }) => {
    await page.goto('/app?import=1')
    await page.getByText('Or paste data').click()
    await page.getByLabel('Paste export data').fill('   ')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /^Detected:/ })).toHaveCount(0)
  })

  test('a mostly good file reports the bad cell by line and column, and does not hide it', async ({ page }) => {
    await page.goto('/app?import=1')
    await page.locator('input[type=file]').setInputFiles(file('mixed.csv', 'month,team,infra_host_usage\n2026-10,a,abc\n2026-10,b,5\n'))
    const report = page.locator('section.card', { has: page.getByRole('heading', { name: 'Validation report' }) })
    await expect(report).toContainText('1 error')
    const row = report.locator('tr.error')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('2') // line number
    await expect(row).toContainText('infra_host_usage')
    await expect(row).toContainText('"abc" is not a number')
    await expect(report.getByText('Rows read')).toBeVisible()
  })
})
