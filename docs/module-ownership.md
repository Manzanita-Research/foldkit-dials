# Timeline and panel module ownership

The library keeps its public contracts in each component's `public.ts`.
`timeline/index.ts` and `dialPanel/view.ts` compose explicit exports so existing
callers keep their import paths. Internal modules import their dependencies
directly rather than importing these composition surfaces.

## Timeline

| Module            | Owns                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| `model.ts`        | Schemas, tagged variants, shared empty endpoints and typed authoring/sample shapes |
| `timing.ts`       | Default transition, duration normalization, rounding and effective transitions     |
| `constructors.ts` | Authoring constructors and the initial editing window                              |
| `resolve.ts`      | Static clip/track/step shapes, endpoints and effective timeline duration           |
| `sampling.ts`     | Interpolation, clip phases, sampled values and CSS timing                          |
| `loops.ts`        | Playhead loop spans, wraps and continuous cycle time                               |
| `editing.ts`      | Move/resize clamps, clip/span edits and endpoint slider ranges                     |
| `grouping.ts`     | Stable clip keys and records nested by authored group                              |
| `formatting.ts`   | Clock, seconds and step labels                                                     |
| `export.ts`       | Tuned config serialization and clipboard instructions                              |

Schemas and phantom config types have one owner in `model.ts`. The default
transition is instantiated once in `timing.ts`. Construction uses static
resolution to size the initial window; resolution does not import constructors.
Grouping depends only on the timeline types, so resolution, sampling, editing
and export can share keys and nesting without importing each other.

`valuesAtResolved` samples an existing static result. `valuesAt` resolves once
for its own call. The host APIs still resolve once per call and reuse that result
for duration and sampling. No derived state or cross-call cache lives in these
modules. Update and view retain their independent resolution lifetimes.

Internal helpers exported for sibling modules are absent from the index and
public exports. Relative imports retain `.js` extensions for packed consumers;
type-only dependencies remain type-only.

## DialPanel views

`dialPanel/view.ts` exports `makeView`, `root` and `ViewInputs` from `view/shell.ts`.
The views receive the same per-render Context and read the parent-owned values
and existing child Models.

| Module in `dialPanel/view/` | Owns                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `scalar.ts`                 | Slider, toggle, select, text and action controls                           |
| `image.ts`                  | Image frame, options, upload and anchored picker                           |
| `color.ts`                  | Color field, format group, validation and anchored picker                  |
| `spatial.ts`                | Pad surface/axis fields and transition editor composition                  |
| `controls.ts`               | Exhaustive leaf dispatch and recursive folder traversal                    |
| `shared.ts`                 | Context type, shortcut badges, icon buttons and folder disclosure markup   |
| `toolbar.ts`                | Version menus, shortcuts, copy status, save status and comparison banner   |
| `shell.ts`                  | Layout/theme/position wrappers, panel header interactions and view factory |

The shared layer does not import control views or the shell. Control renderers
import the Context as a type. The recursive tree and transition editor both use
the shared folder disclosure, keeping control dispatch independent of shell
composition.

`dialPanel/controls.ts` continues to own the module-level ToggleGroup and
SelectListbox factories and child slots. The segmented color-format renderer
stays module-scoped in `view/color.ts`. `makeView` retains its per-spec closure in
`view/shell.ts`. Slots, keys, CSS classes, accessible names and copy text remain
in their original rendering expressions.
