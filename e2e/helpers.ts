import { expect, type Locator, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

/** Real Datadog API responses that the engine tests already use. Read only. */
export const fixture = (name: string) => fileURLToPath(new URL(`../src/engine/fixtures/${name}`, import.meta.url))

/** Landing page -> synthetic sample project -> Overview. */
export async function openSample(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the sample' }).first().click()
  await expect(page).toHaveURL(/\/app\/p\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: 'Cost by team' })).toBeVisible()
}

export const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name })

/** First dollar amount in an element, as a number: "$20,078 35.3%" -> 20078. */
export async function dollars(el: Locator): Promise<number> {
  const m = (await el.innerText()).match(/\$([\d,]+(?:\.\d+)?)/)
  if (!m) throw new Error(`no dollar amount in "${await el.innerText()}"`)
  return Number(m[1].replace(/,/g, ''))
}

/** A log index row on the Levers tab. */
export const logRow = (page: Page, index: string) =>
  page.locator('.lv-row').filter({ has: page.locator('code', { hasText: new RegExp(`^${index}$`) }) })

/** The "Exclusion filter" slider (a label wrapping a range input) of one log index. */
export const exclusion = (page: Page, index: string) => logRow(page, index).locator('label.slider', { hasText: 'Exclusion filter' })
