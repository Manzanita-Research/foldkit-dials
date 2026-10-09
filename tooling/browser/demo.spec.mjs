import { expect, test as testBase } from '@playwright/test'

const test = testBase.extend({
  page: async ({ page }, use) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await use(page)
    expect(errors).toEqual([])
  },
})

const radius = page => page.getByRole('slider', { name: 'Radius', exact: true })
const lift = page => page.getByRole('slider', { name: 'Lift', exact: true })
const header = page => page.getByRole('button', { name: 'Card', exact: true })
const editor = page => page.getByRole('textbox', { name: 'Radius value' })
const valueButton = page =>
  radius(page).locator('..').locator('[data-scrub-slider-value]')

const dragTo = async (page, slider, fraction) => {
  const bounds = await slider.boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(
    bounds.x + bounds.width * fraction,
    bounds.y + bounds.height / 2,
  )
}

const expectDockAccessible = async page => {
  const play = page
    .locator('.dialkit-timeline')
    .getByRole('button', { name: 'Play', exact: true })
  await expect(play).toBeVisible()
  await expect
    .poll(() =>
      play.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return element.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        )
      }),
    )
    .toBe(true)
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.goto('/')
  await expect(radius(page)).toHaveAttribute('aria-valuenow', '20')
})

test('header clicks and keyboard toggle the panel while dock controls stay accessible', async ({
  page,
}) => {
  await expect(header(page)).toHaveAttribute('aria-expanded', 'true')
  await expectDockAccessible(page)
  await header(page).click()
  await expect(header(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(radius(page)).toHaveCount(0)
  await expectDockAccessible(page)
  await header(page).click()
  await expect(header(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(radius(page)).toBeVisible()
  await header(page).press('Enter')
  await expect(header(page)).toHaveAttribute('aria-expanded', 'false')
  await header(page).press('Space')
  await expect(header(page)).toHaveAttribute('aria-expanded', 'true')
})

test('floating header cancellation restores position and preserves keyboard and fresh pointer gestures', async ({
  page,
}) => {
  const panel = page.locator('.dialkit-panel')
  const offset = () => panel.evaluate(element => element.style.translate)
  const settleRender = () =>
    page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )

  for (const cancellation of ['Escape', 'pointercancel']) {
    const origin = await offset()
    const bounds = await header(page).boundingBox()
    expect(bounds).not.toBeNull()
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 160, y + 60, { steps: 5 })
    await expect.poll(offset).toBe('-160px 60px')

    if (cancellation === 'Escape') {
      await page.keyboard.press('Escape')
    } else {
      await page.evaluate(() =>
        document.dispatchEvent(
          new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }),
        ),
      )
    }
    await expect.poll(offset).toBe(origin)
    await page.mouse.move(x - 200, y + 90, { steps: 3 })
    await settleRender()
    expect(await offset()).toBe(origin)
    await page.mouse.up()
    await expect(header(page)).toBeFocused()
    await expect(header(page)).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('Enter')
    await expect(header(page)).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Space')
    await expect(header(page)).toHaveAttribute('aria-expanded', 'true')
    await header(page).dispatchEvent('click')
    await settleRender()
    await expect(header(page)).toHaveAttribute('aria-expanded', 'true')

    await header(page).click()
    await expect(header(page)).toHaveAttribute('aria-expanded', 'false')
    await header(page).click()
    await expect(header(page)).toHaveAttribute('aria-expanded', 'true')
  }
})

test('value editing keeps navigation in the editor and returns focus on commit or cancellation', async ({
  page,
}) => {
  await valueButton(page).click()
  await expect(editor(page)).toBeFocused()
  await expect(editor(page)).toHaveValue('20')
  await editor(page).press('ArrowLeft')
  await editor(page).press('Home')
  await expect(radius(page)).toHaveAttribute('aria-valuenow', '20')
  await editor(page).fill('33')
  await editor(page).press('Enter')
  await expect(editor(page)).toHaveCount(0)
  await expect(radius(page)).toHaveAttribute('aria-valuenow', '33')
  await expect(radius(page)).toBeFocused()
  await radius(page).press('ArrowRight')
  await expect(radius(page)).toHaveAttribute('aria-valuenow', '34')
  await radius(page).press('Enter')
  await expect(editor(page)).toBeFocused()
  await editor(page).fill('7')
  await editor(page).press('Escape')
  await expect(editor(page)).toHaveCount(0)
  await expect(radius(page)).toHaveAttribute('aria-valuenow', '34')
  await expect(radius(page)).toBeFocused()
})

test('Escape and pointer cancellation restore the drag origin and remove drag subscriptions', async ({
  page,
}) => {
  const slider = lift(page)
  await dragTo(page, slider, 0.1)
  await page.mouse.down()
  await expect(slider).toHaveAttribute('data-dragging', '')
  await dragTo(page, slider, 0.8)
  await expect(slider).toHaveAttribute('aria-valuenow', '48')
  await page.keyboard.press('Escape')
  await expect(slider).toHaveAttribute('aria-valuenow', '18')
  await expect(slider).not.toHaveAttribute('data-dragging', '')
  await dragTo(page, slider, 0.5)
  await page.mouse.up()
  await expect(slider).toHaveAttribute('aria-valuenow', '18')
  await page.mouse.down()
  await expect(slider).toHaveAttribute('data-dragging', '')
  await dragTo(page, slider, 0.8)
  await expect(slider).toHaveAttribute('aria-valuenow', '48')
  await page.evaluate(() =>
    document.dispatchEvent(
      new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }),
    ),
  )
  await expect(slider).toHaveAttribute('aria-valuenow', '18')
  await expect(slider).not.toHaveAttribute('data-dragging', '')
  await dragTo(page, slider, 0.5)
  await page.mouse.up()
  await expect(slider).toHaveAttribute('aria-valuenow', '18')
})

test('a burst of drag updates persists exactly once after the debounce settles', async ({
  page,
}) => {
  await expect(lift(page)).toHaveAttribute('aria-valuenow', '18')
  await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z'))
  await page.evaluate(() => {
    window.__dialWrites = []
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('foldkit-dials:')) {
        window.__dialWrites.push({ key, value })
      }
      return setItem.call(this, key, value)
    }
  })
  const writes = () => page.evaluate(() => window.__dialWrites)
  const slider = lift(page)
  await dragTo(page, slider, 0.1)
  await page.mouse.down()
  await page.clock.runFor(16)
  await expect(slider).toHaveAttribute('data-dragging', '')
  await dragTo(page, slider, 0.3)
  await page.clock.runFor(16)
  await expect(slider).toHaveAttribute('aria-valuenow', '18')
  await page.clock.runFor(100)
  await dragTo(page, slider, 0.5)
  await page.clock.runFor(16)
  await expect(slider).toHaveAttribute('aria-valuenow', '30')
  await page.clock.runFor(100)
  await dragTo(page, slider, 0.8)
  await page.clock.runFor(16)
  await expect(slider).toHaveAttribute('aria-valuenow', '48')
  await expect.poll(writes).toEqual([])
  await page.mouse.up()
  await page.clock.runFor(16)
  await expect(slider).not.toHaveAttribute('data-dragging', '')
  await page.clock.runFor(300)
  await expect.poll(writes).toEqual([])
  await page.clock.runFor(100)
  await expect.poll(async () => (await writes()).length).toBe(1)
  await page.clock.runFor(2000)
  const persisted = await writes()
  expect(persisted).toHaveLength(1)
  expect(JSON.parse(persisted[0].value).versions[0].values.lift).toBe(48)
  expect(
    await page.evaluate(key => localStorage.getItem(key), persisted[0].key),
  ).toBe(persisted[0].value)
})
