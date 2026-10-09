import { expect, test as testBase } from '@playwright/test'

const test = testBase.extend({
  page: async ({ page }, use) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await use(page)
    expect(errors).toEqual([])
  },
})

const amount = page => page.getByRole('slider', { name: 'Amount', exact: true })
const pad = page => page.getByRole('slider', { name: 'Position', exact: true })
const control = (page, name) => page.getByRole('region', { name, exact: true })

const drag = async (page, slider, from, to) => {
  const rect = await slider.boundingBox()
  expect(rect).not.toBeNull()
  await page.mouse.move(rect.x + rect.width * from, rect.y + rect.height / 2)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width * to, rect.y + rect.height / 2, {
    steps: 5,
  })
}

const nextFrame = page =>
  page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )

test.beforeEach(async ({ page }) => {
  await page.goto('/gallery')
  await expect(amount(page)).toHaveAttribute('aria-valuenow', '40')
})

test('navigation, history and reload preserve the independent card demo', async ({
  page,
}) => {
  await amount(page).press('ArrowRight')
  await page.getByRole('link', { name: '← Card demo' }).click()
  const radius = page.getByRole('slider', { name: 'Radius', exact: true })
  await expect(radius).toHaveAttribute('aria-valuenow', '20')
  await radius.press('ArrowRight')
  await page.getByRole('link', { name: 'Control gallery', exact: true }).click()
  await expect(amount(page)).toHaveAttribute('aria-valuenow', '41')
  await expect(radius).toHaveCount(0)
  await page.goBack()
  await expect(radius).toHaveAttribute('aria-valuenow', '21')
  await page.goForward()
  await expect(amount(page)).toHaveAttribute('aria-valuenow', '41')
  await page.getByRole('link', { name: 'Panels', exact: true }).click()
  await expect(page).toHaveURL(/\/gallery\/panels$/)
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Gallery panel', exact: true }),
  ).toBeVisible()
})

test('slider edits, keyboard focus and drag cancellation update only their parent value', async ({
  page,
}) => {
  await amount(page).press('ArrowRight')
  await expect(amount(page)).toHaveAttribute('aria-valuenow', '41')
  await amount(page).press('Enter')
  const editor = page.getByRole('textbox', { name: 'Amount value' })
  await expect(editor).toBeFocused()
  await editor.fill('27')
  await editor.press('Enter')
  await expect(amount(page)).toHaveAttribute('aria-valuenow', '27')
  await expect(amount(page)).toBeFocused()
  await drag(page, amount(page), 0.3, 0.8)
  await expect(amount(page)).toHaveAttribute('aria-valuenow', '80')
  await page.keyboard.press('Escape')
  await expect(amount(page)).toHaveAttribute('aria-valuenow', '27')
  await page.mouse.up()
  await expect(amount(page)).not.toHaveAttribute('data-dragging', '')
  await expect(pad(page)).toHaveAttribute('aria-valuetext', 'X 0, Y 0')
  await expect(
    page.getByRole('textbox', { name: 'Accent color value' }),
  ).toHaveValue('#6d5efc')
  await control(page, 'ScrubSlider').locator('summary').click()
  await expect(control(page, 'ScrubSlider').locator('pre')).toContainText(
    'value: model.amount',
  )
})

test('pad and Bézier handles respond to keys and document pointer subscriptions', async ({
  page,
}) => {
  await pad(page).press('ArrowRight')
  await expect(pad(page)).toHaveAttribute('aria-valuetext', 'X 0.1, Y 0')
  await pad(page).press('Shift+ArrowUp')
  await expect(pad(page)).toHaveAttribute('aria-valuetext', 'X 0.1, Y 1')
  await pad(page).press('Home')
  await expect(pad(page)).toHaveAttribute('aria-valuetext', 'X 0, Y 0')
  const surface = control(page, 'DialPad').locator('.dialkit-pad-surface')
  await drag(page, surface, 0.5, 0.8)
  await expect(pad(page)).not.toHaveAttribute('aria-valuetext', 'X 0, Y 0')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(pad(page)).toHaveAttribute('aria-valuetext', 'X 0, Y 0')
  const handle = control(page, 'BezierEditor').getByRole('slider', {
    name: 'Bézier handle 1',
  })
  await handle.press('ArrowRight')
  await expect(handle).toHaveAttribute('aria-valuetext', 'X 0.26, Y 0.1')
  const rect = await handle.boundingBox()
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await page.mouse.down()
  await page.mouse.move(rect.x + 30, rect.y - 20, { steps: 5 })
  await expect(handle).not.toHaveAttribute('aria-valuetext', 'X 0.26, Y 0.1')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(handle).toHaveAttribute('aria-valuetext', 'X 0.26, Y 0.1')
  await expect(amount(page)).toHaveAttribute('aria-valuenow', '40')
})

test('color field validation, popover focus and standalone picker stay independent', async ({
  page,
}) => {
  const field = page.getByRole('textbox', { name: 'Accent color value' })
  await field.fill('#ff6347')
  await field.press('Enter')
  await expect(field).toHaveAttribute('title', '#ff6347')
  await field.fill('not-a-color')
  await field.press('Enter')
  await expect(
    control(page, 'ColorField').getByText('Not a valid color', { exact: true }),
  ).toBeVisible()
  await field.press('Escape')
  await expect(field).toHaveValue('#ff6347')
  const swatch = page.getByRole('button', { name: 'Pick accent color' })
  await swatch.click()
  const popover = page.locator('.dialkit-color-popover')
  await expect(popover).toBeVisible()
  await popover
    .getByRole('slider', { name: 'Hue', exact: true })
    .press('ArrowRight')
  await expect(field).not.toHaveValue('#ff6347')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(swatch).toBeFocused()
  const standalone = control(page, 'ColorPicker')
  await expect(
    standalone.getByRole('textbox', { name: 'CSS color' }),
  ).toHaveValue('#10b981')
  const alpha = standalone.getByRole('slider', { name: 'Opacity', exact: true })
  await alpha.press('ArrowLeft')
  await expect(alpha).toHaveAttribute('aria-valuenow', '99')
  await standalone
    .getByRole('radio', { name: 'Hex', exact: true })
    .press('ArrowRight')
  await expect(
    standalone.getByRole('radio', { name: 'OKLCH', exact: true }),
  ).toBeFocused()
  await expect(
    standalone.getByRole('radio', { name: 'OKLCH', exact: true }),
  ).toHaveAttribute('aria-checked', 'true')
})

test('image choices use roving focus, selection and return focus on Escape', async ({
  page,
}) => {
  const trigger = control(page, 'ImagePicker').getByRole('button', {
    name: /Choose artwork image/,
  })
  await trigger.click()
  const picker = page.getByRole('dialog', { name: 'Artwork image picker' })
  await expect(picker).toBeVisible()
  await expect(
    picker.getByRole('radio', { name: 'Violet', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(
    picker.getByRole('radio', { name: 'Mint', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAccessibleName('Choose artwork image: Mint')
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page
    .getByRole('button', { name: 'Remove artwork image', exact: true })
    .click()
  await expect(trigger).toHaveAccessibleName('Choose artwork image: No image')
})

test('transition modes and parameter edits retain each mode’s value', async ({
  page,
}) => {
  const transition = control(page, 'TransitionEditor')
  const time = transition.getByRole('radio', { name: 'Time', exact: true })
  await time.press('ArrowRight')
  await expect(
    transition.getByRole('radio', { name: 'Physics', exact: true }),
  ).toBeFocused()
  const stiffness = transition.getByRole('slider', {
    name: 'Stiffness',
    exact: true,
  })
  const originalStiffness = await stiffness.getAttribute('aria-valuenow')
  await stiffness.press('ArrowRight')
  await expect(stiffness).not.toHaveAttribute(
    'aria-valuenow',
    originalStiffness,
  )
  const edited = await stiffness.getAttribute('aria-valuenow')
  await transition.getByRole('radio', { name: 'Easing', exact: true }).click()
  await expect(
    transition.getByRole('textbox', { name: 'Ease', exact: true }),
  ).toBeVisible()
  await transition.getByRole('radio', { name: 'Physics', exact: true }).click()
  await expect(stiffness).toHaveAttribute('aria-valuenow', edited)
  await expect(
    transition.getByRole('img', { name: 'Spring response curve' }),
  ).toBeVisible()
})

test('panel layouts, folders, values and actions are interactive without gallery persistence', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Panels', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Gallery panel', exact: true })
  await panel
    .getByRole('slider', { name: 'Size', exact: true })
    .press('ArrowRight')
  await expect(
    page.getByText('Size 25 · Start · Enabled', { exact: true }),
  ).toBeVisible()
  await panel.getByRole('radio', { name: 'Off', exact: true }).click()
  await panel.getByRole('button', { name: 'Count action' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Actions received: 1' }),
  ).toBeVisible()
  await panel.getByRole('button', { name: 'Detail', exact: true }).click()
  await expect(
    panel.getByRole('slider', { name: 'Opacity', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Floating', exact: true }).click()
  await expect(
    panel.getByRole('slider', { name: 'Size', exact: true }),
  ).toHaveAttribute('aria-valuenow', '25')
  await page
    .getByRole('button', { name: 'Gallery panel', exact: true })
    .press('Enter')
  await expect(
    panel.getByRole('slider', { name: 'Size', exact: true }),
  ).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Gallery panel', exact: true })
    .press('Space')
  await page.getByRole('button', { name: 'Section', exact: true }).click()
  await expect(
    panel.getByRole('slider', { name: 'Size', exact: true }),
  ).toHaveAttribute('aria-valuenow', '25')
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter(key => key.includes('gallery')),
    ),
  ).toEqual([])
})

test('timeline seeking, playback and clip editing update the typed source', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Timeline', exact: true }).click()
  const timeline = page.getByRole('region', { name: 'Gallery timeline' })
  const playhead = timeline.getByRole('slider', {
    name: 'Timeline current time',
  })
  await playhead.press('End')
  await expect(playhead).toHaveAttribute('aria-valuenow', '3')
  await playhead.press('Home')
  await expect(playhead).toHaveAttribute('aria-valuenow', '0')
  await timeline.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(
    timeline.getByRole('button', { name: 'Pause', exact: true }),
  ).toBeVisible()
  await expect.poll(() => playhead.getAttribute('aria-valuenow')).not.toBe('0')
  await timeline.getByRole('button', { name: 'Pause', exact: true }).click()
  await page
    .getByText('Typed source · reflects your timeline edits', { exact: true })
    .click()
  const source = page
    .locator('details')
    .filter({ hasText: 'Typed source · reflects your timeline edits' })
    .locator('code')
  const original = await source.textContent()
  const bar = timeline.getByRole('button', { name: /Fade, starts/ })
  await bar.press('ArrowRight')
  await nextFrame(page)
  await expect(source).not.toHaveText(original)
  await expect(source).toContainText('Timeline.make(')
  await bar.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Edit Fade' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Edit Fade' })).toHaveCount(0)
})

test('route exit clears a held home shortcut released while hidden', async ({
  page,
}) => {
  await page.getByRole('link', { name: '← Card demo' }).click()
  const radius = page.getByRole('slider', { name: 'Radius', exact: true })
  await expect(radius).toHaveAttribute('aria-valuenow', '20')
  await page.keyboard.down('r')
  await page
    .getByRole('link', { name: 'Control gallery', exact: true })
    .press('Enter')
  await expect(amount(page)).toBeVisible()
  await page.keyboard.up('r')
  await page.getByRole('link', { name: '← Card demo' }).press('Enter')
  await expect(radius).toBeVisible()
  await page.mouse.move(400, 300)
  await page.mouse.wheel(0, 100)
  await nextFrame(page)
  await expect(radius).toHaveAttribute('aria-valuenow', '20')
})

for (const home of [true, false]) {
  test(`route exit ends ${home ? 'home' : 'gallery'} timeline drag before hidden release`, async ({
    page,
  }) => {
    await page
      .getByRole('link', {
        name: home ? '← Card demo' : 'Timeline',
        exact: true,
      })
      .click()
    const dock = page.getByRole('region', {
      name: home ? 'Intro timeline' : 'Gallery timeline',
    })
    const playhead = dock.getByRole('slider', { name: 'Timeline current time' })
    await expect(
      dock.getByRole('button', { name: 'Play', exact: true }),
    ).toBeVisible()
    const ruler = dock.locator('.dialkit-timeline-ruler')
    await drag(page, ruler, 0.3, 0.4)
    await nextFrame(page)
    const time = await playhead.getAttribute('aria-valuenow')
    await page
      .getByRole('link', {
        name: home ? 'Control gallery' : 'Controls',
        exact: true,
      })
      .press('Enter')
    await expect(amount(page)).toBeVisible()
    await page.mouse.up()
    await page
      .getByRole('link', {
        name: home ? '← Card demo' : 'Timeline',
        exact: true,
      })
      .press('Enter')
    await expect(playhead).toHaveAttribute('aria-valuenow', time)
    await page.mouse.move(900, 770)
    await nextFrame(page)
    await expect(playhead).toHaveAttribute('aria-valuenow', time)
  })
}

for (const header of [true, false]) {
  test(`route exit ends home ${header ? 'header' : 'slider'} drag before hidden release`, async ({
    page,
  }) => {
    await page.getByRole('link', { name: '← Card demo' }).click()
    const target = page.getByRole(header ? 'button' : 'slider', {
      name: header ? 'Card' : 'Radius',
      exact: true,
    })
    if (header) {
      const rect = await target.boundingBox()
      await page.mouse.move(rect.x + 50, rect.y + 12)
      await page.mouse.down()
      await page.mouse.move(rect.x + 15, rect.y + 42, { steps: 5 })
    } else await drag(page, target, 0.3, 0.5)
    await nextFrame(page)
    const rect = await target.boundingBox()
    const value = await target.getAttribute('aria-valuenow')
    await page
      .getByRole('link', { name: 'Control gallery', exact: true })
      .press('Enter')
    await expect(amount(page)).toBeVisible()
    await page.mouse.up()
    await page.getByRole('link', { name: '← Card demo' }).press('Enter')
    await expect(target).toBeVisible()
    await page.mouse.move(900, 100)
    await nextFrame(page)
    if (header) expect(await target.boundingBox()).toEqual(rect)
    else await expect(target).toHaveAttribute('aria-valuenow', value)
  })
}
