import { test, expect } from './fixtures.ts'
import { dollars, exclusion, logRow, openSample, tab } from './helpers.ts'

test('projects and lever settings are stored in the browser and survive a reload', async ({ page }) => {
  await openSample(page)
  const id = page.url().split('/').pop()!

  // Rename the project and move a lever.
  await page.getByLabel('Project name').fill('Renewal 2027')
  await tab(page, 'Levers').click()
  await exclusion(page, 'access').locator('input').fill('0.5')
  const saved = page.locator('.lv-sum-head b.save')
  await expect(exclusion(page, 'access').locator('b')).toHaveText('50%')
  const savings = await dollars(saved)

  // The write to IndexedDB is asynchronous: wait until the stored record has both
  // changes before reloading, instead of sleeping.
  await expect.poll(() => page.evaluate(id => new Promise<string>((resolve, reject) => {
    const open = indexedDB.open('bill-audit')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const get = open.result.transaction('projects').objectStore('projects').get(id)
      get.onerror = () => reject(get.error)
      get.onsuccess = () => resolve(`${get.result?.name}|${get.result?.levers?.logIdx?.access?.exclude}`)
    }
  }), id)).toBe('Renewal 2027|0.5')

  await page.reload()
  await expect(page).toHaveURL(new RegExp(`/app/p/${id}/levers$`))
  await expect(page.getByLabel('Project name')).toHaveValue('Renewal 2027')
  await expect(exclusion(page, 'access').locator('b')).toHaveText('50%')
  await expect(logRow(page, 'access').locator('.lv-row-head')).toBeVisible()
  expect(await dollars(saved)).toBe(savings)

  // And it is listed under Projects after a fresh navigation.
  await page.goto('/app')
  await expect(page.locator('.proj-card')).toHaveCount(1)
  await expect(page.locator('.proj-card h3')).toHaveText('Renewal 2027')
})

test('deleting a project removes it for good after a reload', async ({ page }) => {
  await openSample(page)
  await page.getByRole('button', { name: 'Delete project' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your Datadog bill, line by line' })).toBeVisible()
  await expect(page.locator('.proj-card')).toHaveCount(0)
})
