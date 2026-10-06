// Drives the running demo through Chrome's DevTools protocol and prints what
// it observes: the panel header toggles both ways, editing a slider value
// never scrubs it, and a drag writes storage once after it settles.
//
// Usage, with the demo on :5267 and a headless Chrome on a debug port:
//   chrome-headless-shell --headless --remote-debugging-port=9333 about:blank &
//   node tooling/browser-check.mjs 9333 <screenshot-dir>
import { writeFileSync } from 'node:fs'

const [port, shotDir] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find(target => target.type === 'page')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve))

let nextId = 1
const pending = new Map()
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
})
const send = (method, params = {}) =>
  new Promise(resolve => {
    const id = nextId++
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const evaluate = async expression => {
  const { result } = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails))
  }
  return result.result.value
}
const shot = async name => {
  const { result } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(result.data, 'base64'))
}
const centerOf = selector =>
  evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, right: rect.right, left: rect.left }
  })()`)
const mouse = (type, x, y, buttons = 1) =>
  send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons,
    clickCount: 1,
  })
const click = async (x, y) => {
  await mouse('mousePressed', x, y)
  await mouse('mouseReleased', x, y, 0)
  await sleep(150)
}
const key = async (keyName, code = keyName, text) => {
  await send('Input.dispatchKeyEvent', {
    type: text ? 'keyDown' : 'rawKeyDown',
    key: keyName,
    code,
    windowsVirtualKeyCode: { Enter: 13, ArrowLeft: 37, Home: 36, Backspace: 8 }[keyName] ?? 0,
    ...(text ? { text } : {}),
  })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code })
  await sleep(80)
}
const typeText = async text => {
  await send('Input.insertText', { text })
  await sleep(120)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    localStorage.clear()
    window.__writes = []
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      window.__writes.push(key)
      return setItem.call(this, key, value)
    }
  `,
})
await send('Page.navigate', { url: 'http://127.0.0.1:5267/' })
await sleep(2500)

const results = {}

// 1. Header toggles on click (Floating layout).
const headerSelector = '[aria-controls][aria-expanded].dialkit-folder-header-top, .dialkit-panel-header button[aria-expanded]'
results.headerBefore = await evaluate(`document.querySelector(${JSON.stringify(headerSelector)})?.getAttribute('aria-expanded')`)
const header = await centerOf(headerSelector)
await click(header.x - 60, header.y)
await sleep(300)
results.headerAfterFirstClick = await evaluate(`document.querySelector(${JSON.stringify(headerSelector)})?.getAttribute('aria-expanded')`)
await shot('cdp-collapsed')
const collapsedHeader = await centerOf(headerSelector)
await click(collapsedHeader.x, collapsedHeader.y)
await sleep(400)
results.headerAfterSecondClick = await evaluate(`document.querySelector(${JSON.stringify(headerSelector)})?.getAttribute('aria-expanded')`)

// 2. Clicking the Radius value opens the editor without scrubbing.
const radiusSlider = `[role="slider"][aria-labelledby]`
const radiusBefore = await evaluate(`[...document.querySelectorAll('${radiusSlider}')].find(s => s.getAttribute('aria-valuetext') === '20')?.getAttribute('aria-valuenow')`)
results.radiusBefore = radiusBefore
const valueCenter = await evaluate(`(() => {
  const value = [...document.querySelectorAll('[data-scrub-slider-value]')].find(v => v.textContent === '20')
  const rect = value.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
})()`)
await click(valueCenter.x, valueCenter.y)
await sleep(250)
results.editorOpen = await evaluate(`document.activeElement?.tagName + ':' + document.activeElement?.value`)
await key('ArrowLeft')
await key('Home')
results.valueAfterArrowsInEditor = await evaluate(`document.querySelector('[role="slider"][aria-valuemax="48"]')?.getAttribute('aria-valuenow')`)
await evaluate(`document.activeElement.select()`)
await typeText('33')
await key('Enter', 'Enter', '\r')
await sleep(300)
results.radiusAfterEnter = await evaluate(`document.querySelector('[role="slider"][aria-valuemax="48"]')?.getAttribute('aria-valuenow')`)
results.editorClosedAfterEnter = await evaluate(`document.querySelector('.dialkit-slider-input') === null`)
results.focusAfterEnter = await evaluate(`document.activeElement?.getAttribute('role')`)

// 3. A drag writes storage once, after the drag settles.
await sleep(800)
await evaluate(`window.__writes = []`)
const lift = await evaluate(`(() => {
  const slider = document.querySelector('[role="slider"][aria-valuemax="60"]')
  const rect = slider.getBoundingClientRect()
  return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 }
})()`)
await mouse('mousePressed', lift.left + 30, lift.y)
for (let step = 0; step < 40; step++) {
  await mouse('mouseMoved', lift.left + 30 + step * 4, lift.y)
  await sleep(16)
}
await mouse('mouseReleased', lift.left + 190, lift.y, 0)
results.writesDuringDrag = await evaluate(`window.__writes.length`)
await sleep(900)
results.writesAfterSettle = await evaluate(`window.__writes.length`)
results.liftAfterDrag = await evaluate(`document.querySelector('[role="slider"][aria-valuemax="60"]')?.getAttribute('aria-valuenow')`)
await shot('cdp-after')

console.log(JSON.stringify(results, null, 2))
socket.close()
