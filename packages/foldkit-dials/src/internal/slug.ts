import { String, pipe } from 'effect'

const NON_ID_CHARACTERS = /[^a-zA-Z0-9_-]+/g

/** Turns a display name into a DOM-safe id: `Hero Card` becomes
 *  `hero-card`. */
export const slugify = (name: string): string =>
  pipe(
    name,
    String.trim,
    String.toLowerCase,
    String.replace(NON_ID_CHARACTERS, '-'),
  )
