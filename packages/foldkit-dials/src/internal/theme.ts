import { Schema, String } from 'effect'

/** The colour theme of DialKit's chrome. `System` follows the OS setting. */
export const Theme = Schema.Literals(['System', 'Light', 'Dark'])
export type Theme = typeof Theme.Type

/** The `data-theme` value DialKit's stylesheet reads. */
export const themeAttribute = (theme: Theme): string =>
  String.toLowerCase(theme)
