import { Array, Predicate } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

// NOTE: icon geometry copied from DialKit (joshpuckett/dialkit, MIT), so the
// panel and the timeline dock match DialKit's look. See the package NOTICE.

export const ICON_CHEVRON = 'M6 9.5L12 15.5L18 9.5'
export const ICON_CHECK = 'M5 12.75L10 19L19 5'
export const ICON_CLOSE = 'M6 6L18 18M18 6L6 18'
export const ICON_PLUS = 'M5 12H19M12 5V19'
export const ICON_RESET = 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4'
export const ICON_COMPARE = 'M8 4v16M16 4v16M4 8h4M16 16h4'
export const ICON_TRASH: ReadonlyArray<string> = [
  'M5 6.5L5.80734 18.2064C5.91582 19.7794 7.22348 21 8.80023 21H15.1998C16.7765 21 18.0842 19.7794 18.1927 18.2064L19 6.5',
  'M10 11V16',
  'M14 11V16',
  'M3.5 6H20.5',
  'M8.07092 5.74621C8.42348 3.89745 10.0485 2.5 12 2.5C13.9515 2.5 15.5765 3.89745 15.9291 5.74621',
]
export const ICON_CLIPBOARD: ReadonlyArray<string> = [
  'M8 6C8 4.34315 9.34315 3 11 3H13C14.6569 3 16 4.34315 16 6V7H8V6Z',
  'M16 5H17C18.6569 5 20 6.34315 20 8V18C20 19.6569 18.6569 21 17 21H7C5.34315 21 4 19.6569 4 18V8C4 6.34315 5.34315 5 7 5H8',
]
export const ICON_KEYBOARD: ReadonlyArray<string> = [
  'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  'M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8',
]
export const ICON_PLAY: ReadonlyArray<string> = [
  'M9.24394 2.36758C7.41419 1.18362 5 2.49701 5 4.67639V19.3238C5 21.5032 7.41419 22.8166 9.24394 21.6326L20.5624 14.3089C22.2371 13.2253 22.2372 10.775 20.5624 9.69129L9.24394 2.36758Z',
]
export const ICON_PAUSE: ReadonlyArray<string> = [
  'M6.75 3C5.23122 3 4 4.23122 4 5.75V18.25C4 19.7688 5.23122 21 6.75 21H7.25C8.76878 21 10 19.7688 10 18.25V5.75C10 4.23122 8.76878 3 7.25 3H6.75Z',
  'M16.75 3C15.2312 3 14 4.23122 14 5.75V18.25C14 19.7688 15.2312 21 16.75 21H17.25C18.7688 21 20 19.7688 20 18.25V5.75C20 4.23122 18.7688 3 17.25 3H16.75Z',
]
export const ICON_REPLAY: ReadonlyArray<string> = [
  'M12 2.5C17.2466 2.50016 21.5 6.7534 21.5 12C21.5 17.2466 17.2466 21.4998 12 21.5C7.52191 21.5 3.76987 18.4025 2.76465 14.2344C2.63517 13.6975 2.96508 13.1578 3.50195 13.0283C4.03883 12.8988 4.57851 13.2288 4.70801 13.7656C5.5016 17.0563 8.46701 19.5 12 19.5C16.142 19.4998 19.5 16.142 19.5 12C19.5 7.85796 16.142 4.50016 12 4.5C9.32981 4.5 6.98389 5.89541 5.6543 8H7.5C8.05228 8 8.5 8.44772 8.5 9C8.5 9.55228 8.05228 10 7.5 10H3.5C2.94772 10 2.5 9.55228 2.5 9V5C2.5 4.44772 2.94772 4 3.5 4C4.05228 4 4.5 4.44772 4.5 5V6.16797C6.2376 3.93677 8.95063 2.5 12 2.5Z',
  'M10 9.94043C10 9.33379 10.6826 8.97849 11.1797 9.32617L14.1221 11.3857C14.5486 11.6843 14.5486 12.3157 14.1221 12.6143L11.1797 14.6738C10.6826 15.0215 10 14.6662 10 14.0596V9.94043Z',
]
const ICON_PANEL_PATH =
  'M6.84766 11.75C6.78583 11.9899 6.75 12.2408 6.75 12.5C6.75 12.7592 6.78583 13.0101 6.84766 13.25H2C1.58579 13.25 1.25 12.9142 1.25 12.5C1.25 12.0858 1.58579 11.75 2 11.75H6.84766ZM14 11.75C14.4142 11.75 14.75 12.0858 14.75 12.5C14.75 12.9142 14.4142 13.25 14 13.25H12.6523C12.7142 13.0101 12.75 12.7592 12.75 12.5C12.75 12.2408 12.7142 11.9899 12.6523 11.75H14ZM3.09766 7.25C3.03583 7.48994 3 7.74075 3 8C3 8.25925 3.03583 8.51006 3.09766 8.75H2C1.58579 8.75 1.25 8.41421 1.25 8C1.25 7.58579 1.58579 7.25 2 7.25H3.09766ZM14 7.25C14.4142 7.25 14.75 7.58579 14.75 8C14.75 8.41421 14.4142 8.75 14 8.75H8.90234C8.96417 8.51006 9 8.25925 9 8C9 7.74075 8.96417 7.48994 8.90234 7.25H14ZM7.59766 2.75C7.53583 2.98994 7.5 3.24075 7.5 3.5C7.5 3.75925 7.53583 4.01006 7.59766 4.25H2C1.58579 4.25 1.25 3.91421 1.25 3.5C1.25 3.08579 1.58579 2.75 2 2.75H7.59766ZM14 2.75C14.4142 2.75 14.75 3.08579 14.75 3.5C14.75 3.91421 14.4142 4.25 14 4.25H13.4023C13.4642 4.01006 13.5 3.75925 13.5 3.5C13.5 3.24075 13.4642 2.98994 13.4023 2.75H14Z'
const ICON_PANEL_CIRCLES: ReadonlyArray<
  Readonly<{ cx: string; cy: string; r: string }>
> = [
  { cx: '6', cy: '8', r: '0.998596' },
  { cx: '10.4999', cy: '3.5', r: '0.998657' },
  { cx: '9.75015', cy: '12.5', r: '0.997986' },
]

const DEFAULT_STROKE_WIDTH = '2'

/** A stroked 24 by 24 icon made of one or more paths. */
export const strokeIcon = <Message>(
  paths: string | ReadonlyArray<string>,
  className: string,
  h: HtmlBuilder<Message>,
  strokeWidth: string = DEFAULT_STROKE_WIDTH,
): Html =>
  h.svg(
    [
      ...(className === '' ? [] : [h.Class(className)]),
      h.ViewBox('0 0 24 24'),
      h.Fill('none'),
      h.Stroke('currentColor'),
      h.StrokeWidth(strokeWidth),
      h.StrokeLinecap('round'),
      h.StrokeLinejoin('round'),
      h.AriaHidden(true),
    ],
    Array.map(Predicate.isString(paths) ? [paths] : paths, path =>
      h.path([h.D(path)]),
    ),
  )

/** A filled 24 by 24 icon made of one or more paths. */
export const fillIcon = <Message>(
  paths: ReadonlyArray<string>,
  h: HtmlBuilder<Message>,
): Html =>
  h.svg(
    [h.ViewBox('0 0 24 24'), h.Fill('none'), h.AriaHidden(true)],
    Array.map(paths, path => h.path([h.D(path), h.Fill('currentColor')])),
  )

/** DialKit's panel icon, shown on the collapsed panel bubble. */
export const panelIcon = <Message>(h: HtmlBuilder<Message>): Html =>
  h.svg(
    [
      h.Class('dialkit-panel-icon'),
      h.ViewBox('0 0 16 16'),
      h.Fill('none'),
      h.AriaHidden(true),
    ],
    [
      h.path([h.D(ICON_PANEL_PATH), h.Fill('currentColor')]),
      ...Array.map(ICON_PANEL_CIRCLES, ({ cx, cy, r }) =>
        h.circle([h.Cx(cx), h.Cy(cy), h.R(r), h.Fill('currentColor')]),
      ),
    ],
  )
