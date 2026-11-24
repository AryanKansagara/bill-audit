import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures.ts'
import { exclusion, fixture, logRow, tab } from './helpers.ts'

test('imports real API fixtures, sets a lever and downloads the generated Terraform', async ({ page }) => {
  // 1. Usage: a real v1 usage-attribution response creates a project.
  await page.goto('/app?import=1')
  await page.locator('input[type=file]').setInputFiles(fixture('v1-usage-attribution.json'))
  await expect(page.getByRole('heading', { name: /Detected: / })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Validation report' })).toBeVisible()
  await page.getByRole('button', { name: /^Import \d+ months?$/ }).click()
  await expect(page).toHaveURL(/\/app\/p\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: 'Cost by team' })).toBeVisible()

  // 2. Log volume: a real v1 logs-by-index response attaches to that month.
  await tab(page, 'Import').click()
  await page.locator('input[type=file]').setInputFiles(fixture('v1-logs-by-index.json'))
  await expect(page.getByRole('heading', { name: 'Detected: Hourly logs usage by index (API JSON)' })).toBeVisible()
  await page.getByRole('button', { name: 'Import breakdown' }).click()
  await expect(page.getByRole('heading', { name: 'Cost by team' })).toBeVisible()

  // 3. Lever: sample out 40% of the `main` index.
  await tab(page, 'Levers').click()
  await logRow(page, 'main').getByLabel('Exclusion filter').fill('0.4')
  await expect(exclusion(page, 'main').locator('b')).toHaveText('40%')

  // 4. The Terraform for that change downloads as a file.
  await tab(page, 'Artifacts').click()
  await page.getByRole('tab', { name: /Log indexes \(Terraform\)/ }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()])
  expect(download.suggestedFilename()).toBe('datadog_logs_index.tf')
  const tf = await readFile((await download.path())!, 'utf8')
  expect(tf).toContain('resource "datadog_logs_index" "main"')
  expect(tf).toContain('name = "main"')
  expect(tf).toContain('retention_days = 15')
  expect(tf).toContain('sample_rate = 0.4')
  // What was downloaded is what the page shows.
  await expect(page.locator('pre.code')).toContainText('sample_rate = 0.4')
})
