import { test, expect } from './fixtures.ts'
import { dollars, exclusion, logRow, openSample, tab } from './helpers.ts'

test.describe('sample project', () => {
  test('shows cost by team and a renewal forecast', async ({ page }) => {
    await openSample(page)

    // KPI row: the month's bill and the renewal-year forecast with its 80% range.
    await expect(page.locator('.kpi', { hasText: 'October 2026 bill' })).toContainText(/\$[\d,]+/)
    const forecast = page.locator('.kpi', { hasText: 'Renewal year forecast' })
    await expect(forecast).toContainText(/\$\d+(\.\d+)?[kM] to \$\d+(\.\d+)?[kM]/)
    await expect(page.getByRole('heading', { name: 'Monthly bill and renewal forecast' })).toBeVisible()

    // Cost by team lists every team of the synthetic company, plus the unattributed remainder.
    const byTeam = page.locator('section.card', { has: page.getByRole('heading', { name: 'Cost by team' }) })
    for (const team of ['platform', 'checkout', 'payments', 'search', 'data', 'identity', 'growth']) {
      await expect(byTeam).toContainText(team)
    }
    await expect(byTeam).toContainText('Unattributed')
    await expect(page.getByText('Synthetic data')).toBeVisible()
  })

  test('changing a lever changes the savings, and resetting it restores them', async ({ page }) => {
    await openSample(page)
    await tab(page, 'Levers').click()
    const saved = page.locator('.lv-sum-head b.save')
    const after = page.locator('.lv-sum-head b.accent')
    const before = await dollars(saved)
    const afterBefore = await dollars(after)
    expect(before).toBeGreaterThan(0)

    // `access` (nginx logs, rarely queried) starts untouched; sampling out half of it must save money.
    const access = logRow(page, 'access').getByLabel('Exclusion filter')
    await access.fill('0.5')
    await expect(exclusion(page, 'access').locator('b')).toHaveText('50%')
    await expect.poll(() => dollars(saved)).toBeGreaterThan(before)
    await expect.poll(() => dollars(after)).toBeLessThan(afterBefore)
    await expect(page.locator('.lv-steps')).toContainText('access')

    await access.fill('0')
    await expect.poll(() => dollars(saved)).toBe(before)
  })
})
