import { Array, Effect, Option, Schema } from 'effect'
import * as Story from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Listbox, Popover, RadioGroup } from '@foldkit/ui'

import * as ColorField from '../colorField/index.js'
import * as Dial from '../dial/index.js'
import * as DialPad from '../dialPad/index.js'
import * as ImagePicker from '../imagePicker/index.js'
import * as ScrubSlider from '../scrubSlider/index.js'
import { DEFAULT_EASING } from '../transition/index.js'
import * as TransitionEditor from '../transitionEditor/index.js'
import {
  CopyValues,
  SavePersisted,
  WaitBeforePersist,
  WaitBeforeResetCopy,
} from './command.js'
import { toDialSource } from './copy.js'
import { make } from './index.js'
import { Message } from './message.js'

const Tuning = Schema.Struct({
  title: Dial.text('Hello'),
  radius: Dial.slider({
    default: 20,
    min: 0,
    max: 48,
    step: 1,
    shortcut: { key: 'r' },
  }),
  accent: Dial.color('#6d5efc'),
  hasShadow: Dial.toggle(true, { shortcut: { key: 's' } }),
  replay: Dial.action('Replay'),
  shadow: Dial.folder(
    { blur: Dial.slider({ default: 12, min: 0, max: 40 }) },
    { isCollapsed: true },
  ),
})
type Tuning = typeof Tuning.Type

const STORAGE_KEY = 'foldkit-dials:card'

const panel = make({ name: 'Card', schema: Tuning, persist: true })
const defaults = panel.defaults
const fresh = panel.init().model
type Model = typeof fresh

const updateWith = (values: Tuning) => (model: Model, message: Message) =>
  panel.update(model, message, values)

const step = (model: Model, message: Message, values: Tuning = defaults) =>
  panel.update(model, message, values).model

const persisted = (version: number) =>
  Story.steps(
    Story.Command.resolve(
      WaitBeforePersist({ version }),
      Message.CompletedWaitBeforePersist({ version }),
    ),
    Story.Command.resolve(SavePersisted, Message.SucceededSavePersisted()),
  )

const storedPanel = (
  activeVersionId: string,
  versions: ReadonlyArray<
    Readonly<{ id: string; name: string; values: unknown }>
  >,
): string => JSON.stringify({ activeVersionId, versions })

const tuned: Tuning = { ...defaults, radius: 4 }
const saved = step(fresh, Message.ClickedSaveVersion(), tuned)

describe('DialPanel', () => {
  describe('init', () => {
    it('starts open on Version 1 holding the defaults, and loads persisted versions', () => {
      const panelInit = panel.init()

      expect(panelInit.model.isOpen).toBe(true)
      expect(panelInit.model.activeVersionId).toBe('v1')
      expect(panelInit.model.versions).toEqual([
        { id: 'v1', name: 'Version 1', values: defaults },
      ])
      expect(
        Array.map(panelInit.commands ?? [], ({ name, args }) => ({
          name,
          args,
        })),
      ).toEqual([
        { name: 'LoadPersisted', args: { key: STORAGE_KEY, storage: 'Local' } },
      ])
    })

    it('loads nothing when persistence is off', () => {
      const plain = make({ name: 'Plain', schema: Tuning })

      expect(plain.init().commands ?? []).toHaveLength(0)
    })
  })

  describe('editing values', () => {
    it('reports a slider change as the whole next values record', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(
          Message.GotSliderMessage({
            dialId: 'radius',
            message: ScrubSlider.Message.PressedKeyboardNavigation({
              direction: 'StepIncrement',
              value: 20,
            }),
          }),
        ),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({
            values: { ...defaults, radius: 21 },
          }),
        ),
        persisted(1),
      )
    })

    it('writes nested folder values by path', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(
          Message.GotSliderMessage({
            dialId: 'shadow.blur',
            message: ScrubSlider.Message.PressedKeyboardNavigation({
              direction: 'Max',
              value: 12,
            }),
          }),
        ),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({
            values: { ...defaults, shadow: { blur: 40 } },
          }),
        ),
        persisted(1),
      )
    })

    it('rejects an edit the dial Schema rejects, leaving everything unchanged', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(
          Message.UpdatedText({ dialId: 'accent', value: 'banana' }),
        ),
        Story.Command.expectNone(),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model).toBe(fresh)
        }),
      )
    })

    it('auto-saves edits into the active version', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(Message.UpdatedText({ dialId: 'title', value: 'Tuned' })),
        persisted(1),
        Story.model(model => {
          expect(model.versions[0]?.values).toEqual({
            ...defaults,
            title: 'Tuned',
          })
        }),
      )
    })

    it('reports an action press with its path', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(Message.ClickedAction({ dialId: 'replay' })),
        Story.expectOutMessage(
          panel.OutMessage.ClickedAction({ path: 'replay' }),
        ),
      )
    })
  })

  describe('child dials', () => {
    const Kinds = Schema.Struct({
      hasShadow: Dial.toggle(true),
      layout: Dial.select(['Stack', 'Row']),
      cover: Dial.image({ options: ['/a.png', '/b.png'] }),
      accent: Dial.color('#6d5efc'),
      glow: Dial.pad({ x: [0, -1, 1, 0.1], y: [0, -1, 1, 0.1] }),
      pop: Dial.spring({ visualDuration: 0.3, bounce: 0.2 }),
    })
    const kinds = make({ name: 'Kinds', schema: Kinds })
    const kindValues = kinds.defaults
    const updateKinds = (model: Model, message: Message) =>
      kinds.update(model, message, kindValues)

    it('reports a toggle segment as a boolean', () => {
      Story.story(
        updateKinds,
        Story.given(kinds.init().model),
        Story.message(
          Message.GotToggleMessage({
            dialId: 'hasShadow',
            message: RadioGroup.Message.SelectedOption({
              index: 0,
              value: 'Off',
            }),
          }),
        ),
        Story.expectOutMessage(
          kinds.OutMessage.ChangedValues({
            values: { ...kindValues, hasShadow: false },
          }),
        ),
        Story.Command.resolve(
          RadioGroup.FocusOption,
          RadioGroup.Message.CompletedFocusOption(),
        ),
      )
    })

    it('reports a selected option', () => {
      Story.story(
        updateKinds,
        Story.given(kinds.init().model),
        Story.message(
          Message.GotSelectMessage({
            dialId: 'layout',
            message: Listbox.Message.SelectedItem({ item: 'Row' }),
          }),
        ),
        Story.expectOutMessage(
          kinds.OutMessage.ChangedValues({
            values: { ...kindValues, layout: 'Row' },
          }),
        ),
        Story.Command.resolveAll([
          Listbox.FocusButton,
          Listbox.Message.CompletedFocusButton(),
        ]),
      )
    })

    it('reports a chosen image', () => {
      Story.story(
        updateKinds,
        Story.given(kinds.init().model),
        Story.message(
          Message.GotImageMessage({
            dialId: 'cover',
            message: ImagePicker.Message.SelectedImage({
              index: 1,
              value: '/b.png',
              currentValue: '/a.png',
            }),
          }),
        ),
        Story.expectOutMessage(
          kinds.OutMessage.ChangedValues({
            values: { ...kindValues, cover: '/b.png' },
          }),
        ),
        Story.Command.resolve(
          ImagePicker.FocusImage,
          ImagePicker.Message.CompletedFocusImage(),
        ),
      )
    })

    it('reports a typed colour', () => {
      Story.story(
        updateKinds,
        Story.given(kinds.init().model),
        Story.message(
          Message.GotColorMessage({
            dialId: 'accent',
            message: ColorField.Message.UpdatedDraft({ draft: '#ff0000' }),
          }),
        ),
        Story.message(
          Message.GotColorMessage({
            dialId: 'accent',
            message: ColorField.Message.PressedEnterInEditor({
              value: '#6d5efc',
            }),
          }),
        ),
        Story.expectOutMessage(
          kinds.OutMessage.ChangedValues({
            values: { ...kindValues, accent: '#ff0000' },
          }),
        ),
      )
    })

    it('reports a pad nudged from the keyboard', () => {
      Story.story(
        updateKinds,
        Story.given(kinds.init().model),
        Story.message(
          Message.GotPadMessage({
            dialId: 'glow',
            message: DialPad.Message.PressedKeyboardNavigation({
              direction: 'Right',
              increment: 'Fine',
              value: { x: 0, y: 0 },
            }),
          }),
        ),
        Story.expectOutMessage(
          kinds.OutMessage.ChangedValues({
            values: { ...kindValues, glow: { x: 0.1, y: 0 } },
          }),
        ),
      )
    })

    it('reports a spring switched to an easing', () => {
      Story.story(
        updateKinds,
        Story.given(kinds.init().model),
        Story.message(
          Message.GotTransitionMessage({
            dialId: 'pop',
            message: TransitionEditor.Message.GotModeMessage({
              message: RadioGroup.Message.SelectedOption({
                index: 0,
                value: 'Easing',
              }),
            }),
          }),
        ),
        Story.expectOutMessage(
          kinds.OutMessage.ChangedValues({
            values: { ...kindValues, pop: DEFAULT_EASING },
          }),
        ),
        Story.Command.resolve(
          RadioGroup.FocusOption,
          RadioGroup.Message.CompletedFocusOption(),
        ),
      )
    })
  })

  describe('versions', () => {
    it('saves the current values as a new active version', () => {
      Story.story(
        updateWith(tuned),
        Story.given(fresh),
        Story.message(Message.ClickedSaveVersion()),
        persisted(1),
        Story.model(model => {
          expect(model.activeVersionId).toBe('v2')
          expect(model.versions).toEqual([
            { id: 'v1', name: 'Version 1', values: defaults },
            { id: 'v2', name: 'Version 2', values: tuned },
          ])
        }),
      )
    })

    it('switches versions by reporting the chosen version values', () => {
      Story.story(
        updateWith(tuned),
        Story.given(saved),
        Story.message(Message.ClickedVersion({ versionId: 'v1' })),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({ values: defaults }),
        ),
        persisted(2),
        Story.model(model => {
          expect(model.activeVersionId).toBe('v1')
        }),
      )
    })

    it('ignores a click on a version that does not exist', () => {
      Story.story(
        updateWith(tuned),
        Story.given(saved),
        Story.message(Message.ClickedVersion({ versionId: 'v9' })),
        Story.Command.expectNone(),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model).toBe(saved)
        }),
      )
    })

    it('keeps each colour field on the format of the version it shows', () => {
      const oklch = 'oklch(0.7 0.1 200)'
      const withOklch = step(fresh, Message.ClickedSaveVersion(), {
        ...defaults,
        accent: oklch,
      })

      Story.story(
        updateWith({ ...defaults, accent: oklch }),
        Story.given(withOklch),
        Story.message(Message.ClickedVersion({ versionId: 'v1' })),
        persisted(2),
        Story.model(model => {
          expect(model.colors['accent']?.picker.selectedFormat).toBe('Hex')
        }),
        Story.message(Message.ClickedVersion({ versionId: 'v2' })),
        persisted(3),
        Story.model(model => {
          expect(model.colors['accent']?.picker.selectedFormat).toBe('Oklch')
        }),
      )
    })

    it('falls back to Version 1 when the active version is deleted', () => {
      Story.story(
        updateWith(tuned),
        Story.given(saved),
        Story.message(Message.ClickedDeleteVersion({ versionId: 'v2' })),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({ values: defaults }),
        ),
        persisted(2),
        Story.model(model => {
          expect(model.versions.map(({ id }) => id)).toEqual(['v1'])
          expect(model.activeVersionId).toBe('v1')
        }),
      )
    })

    it('deletes a version that is not active without changing the values', () => {
      const threeVersions = step(saved, Message.ClickedSaveVersion(), tuned)

      Story.story(
        updateWith(tuned),
        Story.given(threeVersions),
        Story.message(Message.ClickedDeleteVersion({ versionId: 'v2' })),
        Story.expectNoOutMessage(),
        persisted(3),
        Story.model(model => {
          expect(model.versions.map(({ id }) => id)).toEqual(['v1', 'v3'])
          expect(model.activeVersionId).toBe('v3')
        }),
      )
    })

    it('never reuses a deleted version number', () => {
      const threeVersions = step(saved, Message.ClickedSaveVersion(), tuned)
      const withoutSecond = step(
        threeVersions,
        Message.ClickedDeleteVersion({ versionId: 'v2' }),
        tuned,
      )

      Story.story(
        updateWith(tuned),
        Story.given(withoutSecond),
        Story.message(Message.ClickedSaveVersion()),
        persisted(4),
        Story.model(model => {
          expect(model.versions.map(({ name }) => name)).toEqual([
            'Version 1',
            'Version 3',
            'Version 4',
          ])
        }),
      )
    })

    it('never deletes Version 1', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(Message.ClickedDeleteVersion({ versionId: 'v1' })),
        persisted(1),
        Story.model(model => {
          expect(model.versions.map(({ id }) => id)).toEqual(['v1'])
        }),
      )
    })

    it('compares against a saved version without changing the values', () => {
      Story.story(
        updateWith(tuned),
        Story.given(saved),
        Story.message(Message.ClickedCompareVersion({ versionId: 'v1' })),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(panel.comparison(model)).toEqual(
            Option.some({ name: 'Version 1', values: defaults }),
          )
        }),
        Story.message(Message.ClickedStopCompare()),
        Story.model(model => {
          expect(panel.comparison(model)).toEqual(Option.none())
        }),
      )
    })

    it('ends a comparison when the compared version is deleted', () => {
      const comparing = step(
        saved,
        Message.ClickedCompareVersion({ versionId: 'v2' }),
        tuned,
      )
      const onFirst = step(
        comparing,
        Message.ClickedVersion({ versionId: 'v1' }),
        tuned,
      )

      Story.story(
        updateWith(defaults),
        Story.given(onFirst),
        Story.message(Message.ClickedDeleteVersion({ versionId: 'v2' })),
        persisted(3),
        Story.model(model => {
          expect(panel.comparison(model)).toEqual(Option.none())
        }),
      )
    })

    it('ends a comparison on switching to the compared version', () => {
      const comparing = step(
        saved,
        Message.ClickedCompareVersion({ versionId: 'v1' }),
        tuned,
      )

      Story.story(
        updateWith(tuned),
        Story.given(comparing),
        Story.message(Message.ClickedVersion({ versionId: 'v1' })),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({ values: defaults }),
        ),
        persisted(2),
        Story.model(model => {
          expect(panel.comparison(model)).toEqual(Option.none())
        }),
      )
    })

    it('resets to the dial defaults', () => {
      Story.story(
        updateWith(tuned),
        Story.given(fresh),
        Story.message(Message.ClickedResetValues()),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({ values: defaults }),
        ),
        persisted(1),
      )
    })

    it.each([
      ['Save', Message.ClickedSaveVersion(), 1],
      ['Compare', Message.ClickedCompareVersion({ versionId: 'v1' }), 0],
      ['Reset', Message.ClickedResetValues(), 1],
    ])(
      'closes the open version menu on %s',
      (_name, message, persistVersion) => {
        const menuOpen = step(
          fresh,
          Message.GotVersionMenuMessage({
            message: Popover.Message.RequestedOpen(),
          }),
        )
        expect(menuOpen.versionMenu.isOpen).toBe(true)

        Story.story(
          updateWith(defaults),
          Story.given(menuOpen),
          Story.message(message),
          Story.Command.resolveAll(
            [Popover.FocusButton, Popover.Message.CompletedFocusButton()],
            [
              WaitBeforePersist({ version: persistVersion }),
              Message.CompletedWaitBeforePersist({ version: persistVersion }),
            ],
            [SavePersisted, Message.SucceededSavePersisted()],
          ),
          Story.model(model => {
            expect(model.versionMenu.isOpen).toBe(false)
          }),
        )
      },
    )
  })

  describe('persistence', () => {
    const titled: Tuning = { ...defaults, title: 'Tuned' }
    const titledJson = storedPanel('v1', [
      { id: 'v1', name: 'Version 1', values: titled },
    ])

    it('waits after each edit and saves the versions as JSON when the latest wait ends', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(Message.UpdatedText({ dialId: 'title', value: 'Tuned' })),
        Story.Command.expectExact(WaitBeforePersist({ version: 1 })),
        Story.Command.resolve(
          WaitBeforePersist({ version: 1 }),
          Message.CompletedWaitBeforePersist({ version: 1 }),
        ),
        Story.Command.expectExact(
          SavePersisted({
            key: STORAGE_KEY,
            storage: 'Local',
            json: titledJson,
          }),
        ),
        Story.Command.resolve(SavePersisted, Message.SucceededSavePersisted()),
      )
    })

    it('saves a burst of edits once, when the wait for the last edit ends', () => {
      const firstEdit = step(
        fresh,
        Message.UpdatedText({ dialId: 'title', value: 'T' }),
      )

      Story.story(
        updateWith({ ...defaults, title: 'T' }),
        Story.given(firstEdit),
        Story.message(Message.UpdatedText({ dialId: 'title', value: 'Tuned' })),
        Story.Command.expectExact(WaitBeforePersist({ version: 2 })),
        Story.Command.resolve(
          WaitBeforePersist({ version: 2 }),
          Message.CompletedWaitBeforePersist({ version: 2 }),
        ),
        Story.Command.expectExact(
          SavePersisted({
            key: STORAGE_KEY,
            storage: 'Local',
            json: titledJson,
          }),
        ),
        Story.Command.resolve(SavePersisted, Message.SucceededSavePersisted()),
        Story.message(Message.CompletedWaitBeforePersist({ version: 1 })),
        Story.Command.expectNone(),
      )
    })

    it('marks a failed save, and clears the mark when a later save works', () => {
      const edit = Message.UpdatedText({ dialId: 'title', value: 'Tuned' })

      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(edit),
        Story.Command.resolve(
          WaitBeforePersist({ version: 1 }),
          Message.CompletedWaitBeforePersist({ version: 1 }),
        ),
        Story.Command.resolve(SavePersisted, Message.FailedSavePersisted()),
        Story.model(model => {
          expect(model.isSaveFailed).toBe(true)
        }),
        Story.message(edit),
        Story.Command.resolve(
          WaitBeforePersist({ version: 2 }),
          Message.CompletedWaitBeforePersist({ version: 2 }),
        ),
        Story.Command.resolve(SavePersisted, Message.SucceededSavePersisted()),
        Story.model(model => {
          expect(model.isSaveFailed).toBe(false)
        }),
      )
    })

    describe('SavePersisted', () => {
      const save = SavePersisted({
        key: STORAGE_KEY,
        storage: 'Local',
        json: titledJson,
      })

      afterEach(() => {
        vi.unstubAllGlobals()
        localStorage.clear()
      })

      it('reports a write storage accepted', async () => {
        const result = await Effect.runPromise(save.effect)

        expect(result).toEqual(Message.SucceededSavePersisted())
        expect(localStorage.getItem(STORAGE_KEY)).toBe(titledJson)
      })

      it('reports a write storage refused, such as over its quota', async () => {
        vi.stubGlobal('localStorage', {
          setItem: () => {
            throw new DOMException(
              'The quota has been exceeded.',
              'QuotaExceededError',
            )
          },
        })

        const result = await Effect.runPromise(save.effect)

        expect(result).toEqual(Message.FailedSavePersisted())
      })
    })

    it('saves only the current values when versions are not persisted', () => {
      const valuesOnly = make({
        name: 'Card',
        schema: Tuning,
        persist: { isVersionsPersisted: false, storage: 'Session' },
      })

      Story.story(
        (model: Model, message: Message) =>
          valuesOnly.update(model, message, tuned),
        Story.given(valuesOnly.init().model),
        Story.message(Message.ClickedSaveVersion()),
        Story.Command.resolve(
          WaitBeforePersist({ version: 1 }),
          Message.CompletedWaitBeforePersist({ version: 1 }),
        ),
        Story.Command.expectExact(
          SavePersisted({
            key: STORAGE_KEY,
            storage: 'Session',
            json: storedPanel('v1', [
              { id: 'v1', name: 'Version 1', values: tuned },
            ]),
          }),
        ),
        Story.Command.resolve(SavePersisted, Message.SucceededSavePersisted()),
      )
    })

    it('loads what it saved', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(
          Message.CompletedLoadPersisted({
            maybeJson: Option.some(titledJson),
          }),
        ),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({ values: titled }),
        ),
        Story.model(model => {
          expect(model.versions).toEqual([
            { id: 'v1', name: 'Version 1', values: titled },
          ])
        }),
      )
    })

    it('loads a stored version saved before a dial existed, filling the new dial with its default', () => {
      const stored = storedPanel('v2', [
        { id: 'v1', name: 'Version 1', values: { title: 'Old' } },
        { id: 'v2', name: 'Version 2', values: { title: 'Older', radius: 99 } },
      ])

      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(
          Message.CompletedLoadPersisted({ maybeJson: Option.some(stored) }),
        ),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({
            values: { ...defaults, title: 'Older' },
          }),
        ),
        Story.model(model => {
          expect(model.activeVersionId).toBe('v2')
          expect(model.versions).toHaveLength(2)
        }),
      )
    })

    it('falls back to Version 1 when the stored active version is missing', () => {
      const stored = storedPanel('v7', [
        { id: 'v1', name: 'Version 1', values: { title: 'Base' } },
      ])

      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(
          Message.CompletedLoadPersisted({ maybeJson: Option.some(stored) }),
        ),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({
            values: { ...defaults, title: 'Base' },
          }),
        ),
        Story.model(model => {
          expect(model.activeVersionId).toBe('v1')
        }),
      )
    })

    it('adds Version 1 back when storage lacks it', () => {
      const stored = storedPanel('v7', [
        { id: 'v2', name: 'Version 2', values: { title: 'Kept' } },
      ])

      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(
          Message.CompletedLoadPersisted({ maybeJson: Option.some(stored) }),
        ),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({ values: defaults }),
        ),
        Story.model(model => {
          expect(model.versions).toEqual([
            { id: 'v1', name: 'Version 1', values: defaults },
            {
              id: 'v2',
              name: 'Version 2',
              values: { ...defaults, title: 'Kept' },
            },
          ])
          expect(model.activeVersionId).toBe('v1')
        }),
      )
    })

    it.each([
      ['nothing stored', Option.none()],
      ['text that is not JSON', Option.some('{not json')],
      ['JSON that is not a saved panel', Option.some('{"nope":true}')],
      ['a panel with no versions', Option.some(storedPanel('v1', []))],
    ])('ignores %s', (_name, maybeJson) => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(Message.CompletedLoadPersisted({ maybeJson })),
        Story.Command.expectNone(),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model).toBe(fresh)
        }),
      )
    })
  })

  describe('copy', () => {
    const copied: Tuning = { ...defaults, radius: 33 }

    it('copies the dial Schema with the current values as defaults, confirms, then resets', () => {
      Story.story(
        updateWith(copied),
        Story.given(fresh),
        Story.message(Message.ClickedCopyValues()),
        Story.Command.expectExact(
          CopyValues({ text: toDialSource('Card', panel.controls, copied) }),
        ),
        Story.Command.resolve(CopyValues, Message.SucceededCopyValues()),
        Story.model(model => {
          expect(model.copyStatus).toBe('Copied')
        }),
        Story.Command.resolve(
          WaitBeforeResetCopy({ version: 1 }),
          Message.CompletedWaitBeforeResetCopy({ version: 1 }),
        ),
        Story.model(model => {
          expect(model.copyStatus).toBe('Idle')
        }),
      )
    })

    it('shows a failed copy, then resets', () => {
      Story.story(
        updateWith(copied),
        Story.given(fresh),
        Story.message(Message.ClickedCopyValues()),
        Story.Command.resolve(CopyValues, Message.FailedCopyValues()),
        Story.model(model => {
          expect(model.copyStatus).toBe('Failed')
        }),
        Story.Command.resolve(
          WaitBeforeResetCopy({ version: 1 }),
          Message.CompletedWaitBeforeResetCopy({ version: 1 }),
        ),
        Story.model(model => {
          expect(model.copyStatus).toBe('Idle')
        }),
      )
    })

    describe('CopyValues', () => {
      const withClipboard = async (
        writeText: (text: string) => Promise<void>,
        run: () => Promise<void>,
      ): Promise<void> => {
        const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText },
          configurable: true,
        })
        try {
          await run()
        } finally {
          Object.defineProperty(
            navigator,
            'clipboard',
            original ?? { value: undefined, configurable: true },
          )
        }
      }

      it('reports a copy the clipboard accepted', async () => {
        const written: Array<string> = []
        await withClipboard(
          async text => {
            written.push(text)
          },
          async () => {
            const result = await Effect.runPromise(
              CopyValues({ text: 'source' }).effect,
            )
            expect(result).toEqual(Message.SucceededCopyValues())
            expect(written).toEqual(['source'])
          },
        )
      })

      it('reports a copy the clipboard refused', async () => {
        await withClipboard(
          () => Promise.reject(new Error('Not allowed')),
          async () => {
            const result = await Effect.runPromise(
              CopyValues({ text: 'source' }).effect,
            )
            expect(result).toEqual(Message.FailedCopyValues())
          },
        )
      })
    })

    it('keeps a second copy confirmed when the first wait ends', () => {
      const copiedTwice = step(
        step(fresh, Message.SucceededCopyValues()),
        Message.SucceededCopyValues(),
      )

      Story.story(
        updateWith(copied),
        Story.given(copiedTwice),
        Story.message(Message.CompletedWaitBeforeResetCopy({ version: 1 })),
        Story.model(model => {
          expect(model.copyStatus).toBe('Copied')
        }),
        Story.message(Message.CompletedWaitBeforeResetCopy({ version: 2 })),
        Story.model(model => {
          expect(model.copyStatus).toBe('Idle')
        }),
      )
    })
  })

  describe('shortcuts', () => {
    const held = step(
      fresh,
      Message.PressedShortcutKey({ key: 'r', maybeModifier: Option.none() }),
    )

    it('steps a held slider shortcut when scrolling', () => {
      Story.story(
        updateWith(defaults),
        Story.given(held),
        Story.message(Message.ScrolledWithShortcut({ direction: 1 })),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({
            values: { ...defaults, radius: 21 },
          }),
        ),
        persisted(1),
      )
    })

    it('steps a held slider shortcut with the arrow keys', () => {
      Story.story(
        updateWith(defaults),
        Story.given(held),
        Story.message(Message.PressedArrowWithShortcut({ direction: -1 })),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({
            values: { ...defaults, radius: 19 },
          }),
        ),
        persisted(1),
      )
    })

    it('does nothing when scrolling with no shortcut held', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(Message.ScrolledWithShortcut({ direction: 1 })),
        Story.expectNoOutMessage(),
      )
    })

    it.each([
      ['the key is released', Message.ReleasedShortcutKey({ key: 'R' })],
      ['the window loses focus', Message.BlurredWindow()],
    ])('stops stepping once %s', (_name, message) => {
      Story.story(
        updateWith(defaults),
        Story.given(held),
        Story.message(message),
        Story.message(Message.ScrolledWithShortcut({ direction: 1 })),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.heldShortcutKeys).toEqual([])
        }),
      )
    })

    it('flips a toggle on its key press, once per press', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(
          Message.PressedShortcutKey({
            key: 's',
            maybeModifier: Option.none(),
          }),
        ),
        Story.expectOutMessage(
          panel.OutMessage.ChangedValues({
            values: { ...defaults, hasShadow: false },
          }),
        ),
        persisted(1),
      )
      const togglesHeld = step(
        fresh,
        Message.PressedShortcutKey({ key: 's', maybeModifier: Option.none() }),
      )
      Story.story(
        updateWith({ ...defaults, hasShadow: false }),
        Story.given(togglesHeld),
        Story.message(
          Message.PressedShortcutKey({
            key: 's',
            maybeModifier: Option.none(),
          }),
        ),
        Story.expectNoOutMessage(),
      )
    })

    it('matches a shortcut only with its modifier', () => {
      const AltTuning = Schema.Struct({
        size: Dial.slider({
          default: 10,
          min: 0,
          max: 100,
          step: 1,
          shortcut: { key: 'r', modifier: 'Alt' },
        }),
      })
      const altPanel = make({ name: 'Alt', schema: AltTuning })
      const values = altPanel.defaults
      const updateAlt = (model: Model, message: Message) =>
        altPanel.update(model, message, values)
      const start = altPanel.init().model

      Story.story(
        updateAlt,
        Story.given(start),
        Story.message(
          Message.PressedShortcutKey({
            key: 'r',
            maybeModifier: Option.none(),
          }),
        ),
        Story.message(Message.ScrolledWithShortcut({ direction: 1 })),
        Story.expectNoOutMessage(),
      )
      Story.story(
        updateAlt,
        Story.given(start),
        Story.message(
          Message.PressedShortcutKey({
            key: 'r',
            maybeModifier: Option.some('Alt'),
          }),
        ),
        Story.message(Message.ScrolledWithShortcut({ direction: 1 })),
        Story.expectOutMessage(
          altPanel.OutMessage.ChangedValues({ values: { size: 11 } }),
        ),
      )
    })

    it.each([
      ['Fine', 'Fine', 2],
      ['Coarse', 'Coarse', 20],
      ['Normal', 'Normal', 1],
    ] as const)('steps by the %s mode', (_name, mode, expectedStep) => {
      const ModeTuning = Schema.Struct({
        size: Dial.slider({
          default: 100,
          min: 0,
          max: 200,
          step: 1,
          shortcut: { key: 'm', mode },
        }),
      })
      const modePanel = make({ name: 'Mode', schema: ModeTuning })
      const values = modePanel.defaults
      const modeHeld = modePanel.update(
        modePanel.init().model,
        Message.PressedShortcutKey({ key: 'm', maybeModifier: Option.none() }),
        values,
      ).model

      Story.story(
        (model: Model, message: Message) =>
          modePanel.update(model, message, values),
        Story.given(modeHeld),
        Story.message(Message.ScrolledWithShortcut({ direction: 1 })),
        Story.expectOutMessage(
          modePanel.OutMessage.ChangedValues({
            values: { size: 100 + expectedStep },
          }),
        ),
      )
    })

    describe('pointer interactions', () => {
      const PointerTuning = Schema.Struct({
        size: Dial.slider({
          default: 10,
          min: 0,
          max: 100,
          step: 1,
          shortcut: { key: 'm', interaction: 'Move' },
        }),
        width: Dial.slider({
          default: 10,
          min: 0,
          max: 100,
          step: 1,
          shortcut: { key: 'd', interaction: 'Drag' },
        }),
      })
      const pointerPanel = make({ name: 'Pointer', schema: PointerTuning })
      const values = pointerPanel.defaults
      const updatePointer = (model: Model, message: Message) =>
        pointerPanel.update(model, message, values)
      const holding = (key: string) =>
        pointerPanel.update(
          pointerPanel.init().model,
          Message.PressedShortcutKey({ key, maybeModifier: Option.none() }),
          values,
        ).model

      it('steps with horizontal pointer travel for a Move shortcut, four pixels a step', () => {
        Story.story(
          updatePointer,
          Story.given(holding('m')),
          Story.message(Message.MovedShortcutPointer({ clientX: 100 })),
          Story.expectNoOutMessage(),
          Story.message(Message.MovedShortcutPointer({ clientX: 109 })),
          Story.expectOutMessage(
            pointerPanel.OutMessage.ChangedValues({
              values: { ...values, size: 12 },
            }),
          ),
        )
      })

      it('steps a Drag shortcut only while the button is down', () => {
        Story.story(
          updatePointer,
          Story.given(holding('d')),
          Story.message(Message.MovedShortcutPointer({ clientX: 100 })),
          Story.message(Message.MovedShortcutPointer({ clientX: 120 })),
          Story.expectNoOutMessage(),
          Story.message(Message.PressedShortcutPointer({ clientX: 120 })),
          Story.message(Message.MovedShortcutPointer({ clientX: 128 })),
          Story.expectOutMessage(
            pointerPanel.OutMessage.ChangedValues({
              values: { ...values, width: 12 },
            }),
          ),
          Story.message(Message.ReleasedShortcutPointer()),
          Story.message(Message.MovedShortcutPointer({ clientX: 160 })),
          Story.expectNoOutMessage(),
        )
      })
    })
  })

  describe('panel chrome', () => {
    it('toggles the panel from its header', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(Message.ToggledPanel({ isOpen: false })),
        Story.model(model => {
          expect(model.isOpen).toBe(false)
        }),
      )
    })

    it('toggles on the click after a header press that does not move', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(Message.PressedPanelHeader({ clientX: 10, clientY: 10 })),
        Story.message(Message.MovedPanelPointer({ clientX: 12, clientY: 11 })),
        Story.message(Message.ReleasedPanelPointer()),
        Story.model(model => {
          expect(model.isOpen).toBe(true)
        }),
        Story.message(Message.ToggledPanel({ isOpen: false })),
        Story.model(model => {
          expect(model.isOpen).toBe(false)
          expect(model.offset).toEqual({ x: 0, y: 0 })
        }),
      )
    })

    it('moves the panel on a header drag and ignores the click that ends it', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(Message.PressedPanelHeader({ clientX: 10, clientY: 10 })),
        Story.message(Message.MovedPanelPointer({ clientX: 60, clientY: 40 })),
        Story.message(Message.ReleasedPanelPointer()),
        Story.message(Message.ToggledPanel({ isOpen: false })),
        Story.model(model => {
          expect(model.isOpen).toBe(true)
          expect(model.offset).toEqual({ x: 50, y: 30 })
          expect(model.headerDrag._tag).toBe('Idle')
        }),
        Story.message(Message.ToggledPanel({ isOpen: false })),
        Story.model(model => {
          expect(model.isOpen).toBe(false)
        }),
      )
    })

    it('opens a folder declared collapsed when toggled', () => {
      Story.story(
        updateWith(defaults),
        Story.given(fresh),
        Story.message(
          Message.ToggledFolder({ dialId: 'shadow', isOpen: true }),
        ),
        Story.model(model => {
          expect(model.toggledFolderKeys).toEqual(['shadow'])
        }),
        Story.message(
          Message.ToggledFolder({ dialId: 'shadow', isOpen: false }),
        ),
        Story.model(model => {
          expect(model.toggledFolderKeys).toEqual([])
        }),
      )
    })
  })

  describe('typed facade', () => {
    it('keeps defaults typed and valid', () => {
      expect(Schema.is(Tuning)(defaults)).toBe(true)
      expect(modifyFields(defaults, { radius: () => 5 }).radius).toBe(5)
    })
  })
})
