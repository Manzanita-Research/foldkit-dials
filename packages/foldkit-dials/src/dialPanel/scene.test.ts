import { Schema } from 'effect'
import * as Scene from 'foldkit/scene'
import { describe, it } from 'vitest'

import { Popover, RadioGroup } from '@foldkit/ui'

import * as Dial from '../dial/index.js'
import { CopyValues, WaitBeforeResetCopy } from './command.js'
import { make } from './index.js'
import { Message } from './message.js'

const Tuning = Schema.Struct({
  title: Dial.text('Hello', { placeholder: 'Title' }),
  layout: Dial.select(['stack', 'row']),
  radius: Dial.slider({
    default: 20,
    min: 0,
    max: 48,
    step: 1,
    shortcut: { key: 'r' },
  }),
  hasShadow: Dial.toggle(true),
  replay: Dial.action('Replay'),
  shadow: Dial.folder(
    { blur: Dial.slider({ default: 12, min: 0, max: 40 }) },
    { isCollapsed: true },
  ),
})

const panel = make({ name: 'Card', schema: Tuning })
const values = panel.defaults
const model = panel.init().model
type Model = typeof model
const update = (current: Model, message: Message) =>
  panel.update(current, message, values)
const step = (current: Model, message: Message): Model =>
  update(current, message).model
const sceneView = Scene.withViewInputs(panel.view, { values })

const header = Scene.role('button', { name: 'Card' })
const versionsTrigger = Scene.role('button', { name: 'Versions: Version 1' })
const statusWith = (text: string) =>
  Scene.first(Scene.filter(Scene.all.role('status'), { hasText: text }))
const acknowledgeAnchor = Scene.Mount.resolve(
  Popover.AnchorPopover,
  Popover.Message.CompletedAnchorPopover(),
)

describe('DialPanel view', () => {
  it('renders each dial with its accessible role and value', () => {
    Scene.scene(
      { update, view: sceneView() },
      Scene.given(model),
      Scene.expect(Scene.role('slider', { name: 'Radius' })).toHaveAttr(
        'aria-valuenow',
        '20',
      ),
      Scene.expect(Scene.role('radiogroup', { name: 'Has Shadow' })).toExist(),
      Scene.expect(Scene.role('radio', { name: 'On' })).toHaveAttr(
        'aria-checked',
        'true',
      ),
      Scene.expect(Scene.label('Title')).toHaveAttr('placeholder', 'Title'),
      Scene.expect(Scene.role('button', { name: 'Layout: Stack' })).toExist(),
      Scene.expect(Scene.role('button', { name: 'Replay' })).toExist(),
    )
  })

  it('marks the panel as a region named after it', () => {
    Scene.scene(
      { update, view: sceneView() },
      Scene.given(model),
      Scene.expect(Scene.role('region', { name: 'Card' })).toExist(),
    )
  })

  it('shows a shortcut badge on a dial with a shortcut', () => {
    Scene.scene(
      { update, view: sceneView() },
      Scene.given(model),
      Scene.expect(Scene.text('R+Scroll')).toExist(),
    )
  })

  it('names the toolbar buttons, with the active version in the Versions name', () => {
    Scene.scene(
      { update, view: sceneView() },
      Scene.given(model),
      Scene.expect(
        Scene.role('button', { name: 'Copy as dial Schema' }),
      ).toExist(),
      Scene.expect(versionsTrigger).toHaveText('Version 1'),
      Scene.expect(
        Scene.role('button', { name: 'Keyboard shortcuts' }),
      ).toExist(),
    )
  })

  it('keeps a folder declared collapsed closed until toggled', () => {
    Scene.scene(
      { update, view: sceneView() },
      Scene.given(model),
      Scene.expect(Scene.role('button', { name: 'Shadow' })).toHaveAttr(
        'aria-expanded',
        'false',
      ),
      Scene.click(Scene.role('button', { name: 'Shadow' })),
      Scene.expect(Scene.role('button', { name: 'Shadow' })).toHaveAttr(
        'aria-expanded',
        'true',
      ),
      Scene.expect(Scene.role('slider', { name: 'Blur' })).toExist(),
    )
  })

  it('reports an action press', () => {
    Scene.scene(
      { update, view: sceneView() },
      Scene.given(model),
      Scene.click(Scene.role('button', { name: 'Replay' })),
      Scene.expectOutMessage(
        panel.OutMessage.ClickedAction({ path: 'replay' }),
      ),
    )
  })

  it('reports typed text as the next values', () => {
    Scene.scene(
      { update, view: sceneView() },
      Scene.given(model),
      Scene.type(Scene.role('textbox', { name: 'Title' }), 'Tuned'),
      Scene.expectOutMessage(
        panel.OutMessage.ChangedValues({
          values: { ...values, title: 'Tuned' },
        }),
      ),
    )
  })

  it('reports a toggle segment as the next values', () => {
    Scene.scene(
      { update, view: sceneView() },
      Scene.given(model),
      Scene.click(Scene.role('radio', { name: 'Off' })),
      Scene.expectOutMessage(
        panel.OutMessage.ChangedValues({
          values: { ...values, hasShadow: false },
        }),
      ),
      Scene.Command.resolve(
        RadioGroup.FocusOption,
        RadioGroup.Message.CompletedFocusOption(),
      ),
    )
  })

  describe('panel header', () => {
    describe.each([
      ['pointer cancellation or Escape', Message.CancelledPanelDrag()],
      ['window blur', Message.BlurredWindow()],
    ])('keyboard activation after %s', (_name, cancellation) => {
      describe.each(['Pressing', 'Dragging'])('from %s', activity => {
        describe.each(['None', 'BeforeKeyboard', 'AfterKeyboard'])(
          'with trailing click %s',
          trailingClick => {
            it.each(['Enter', ' '])('preserves %s activation', key => {
              Scene.scene(
                { update, view: sceneView() },
                Scene.given(model),
                Scene.pointerDown(header, { clientX: 10, clientY: 10 }),
                ...(activity === 'Dragging'
                  ? [
                      Scene.Subscription.emit(
                        Message.MovedPanelPointer({ clientX: 60, clientY: 40 }),
                      ),
                    ]
                  : []),
                Scene.Subscription.emit(cancellation),
                ...(trailingClick === 'BeforeKeyboard'
                  ? [Scene.click(header)]
                  : []),
                Scene.expect(header).toHaveAttr('aria-expanded', 'true'),
                Scene.keydown(header, key),
                Scene.expect(header).toHaveAttr('aria-expanded', 'false'),
                ...(trailingClick === 'AfterKeyboard'
                  ? [
                      Scene.click(header),
                      Scene.expect(header).toHaveAttr('aria-expanded', 'false'),
                    ]
                  : []),
                Scene.keydown(header, key),
                Scene.expect(header).toHaveAttr('aria-expanded', 'true'),
              )
            })
          },
        )
      })
    })

    it('restores a cancelled floating drag and ignores its trailing click', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(model),
        Scene.pointerDown(header, { clientX: 10, clientY: 10 }),
        Scene.Subscription.emit(
          Message.MovedPanelPointer({ clientX: 60, clientY: 40 }),
        ),
        Scene.expect(Scene.selector('.dialkit-panel')).toHaveStyle(
          'translate',
          '50px 30px',
        ),
        Scene.Subscription.emit(Message.BlurredWindow()),
        Scene.expect(Scene.selector('.dialkit-panel')).toHaveStyle(
          'translate',
          '0px 0px',
        ),
        Scene.Subscription.emit(
          Message.MovedPanelPointer({ clientX: 100, clientY: 80 }),
        ),
        Scene.Subscription.emit(Message.ReleasedPanelPointer()),
        Scene.click(header),
        Scene.expect(header).toHaveAttr('aria-expanded', 'true'),
        Scene.pointerDown(header, { clientX: 20, clientY: 20 }),
        Scene.Subscription.emit(Message.ReleasedPanelPointer()),
        Scene.click(header),
        Scene.expect(header).toHaveAttr('aria-expanded', 'false'),
      )
    })

    it.each([['Floating'], ['Inline'], ['Section']] as const)(
      'collapses and expands on click in the %s layout',
      layout => {
        Scene.scene(
          { update, view: sceneView({ layout }) },
          Scene.given(model),
          Scene.expect(header).toHaveAttr('aria-expanded', 'true'),
          Scene.expect(header).toHaveAttr('aria-controls', 'card-dials-panel'),
          Scene.expect(Scene.selector('#card-dials-panel')).toExist(),
          Scene.click(header),
          Scene.expect(header).toHaveAttr('aria-expanded', 'false'),
          Scene.expect(header).not.toHaveAttr('aria-controls'),
          Scene.expect(Scene.role('slider', { name: 'Radius' })).toBeAbsent(),
          Scene.click(header),
          Scene.expect(header).toHaveAttr('aria-expanded', 'true'),
          Scene.expect(Scene.role('slider', { name: 'Radius' })).toExist(),
        )
      },
    )

    it('collapses from the keyboard', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(model),
        Scene.keydown(header, 'Enter'),
        Scene.expect(header).toHaveAttr('aria-expanded', 'false'),
        Scene.keydown(header, ' '),
        Scene.expect(header).toHaveAttr('aria-expanded', 'true'),
      )
    })

    it('ignores the click that ends a header drag', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(model),
        Scene.pointerDown(header, { clientX: 10, clientY: 10 }),
        Scene.Subscription.emit(
          Message.MovedPanelPointer({ clientX: 60, clientY: 40 }),
        ),
        Scene.Subscription.emit(Message.ReleasedPanelPointer()),
        Scene.click(header),
        Scene.expect(header).toHaveAttr('aria-expanded', 'true'),
        Scene.click(header),
        Scene.expect(header).toHaveAttr('aria-expanded', 'false'),
      )
    })

    it('starts no drag in the Inline layout', () => {
      Scene.scene(
        { update, view: sceneView({ layout: 'Inline' }) },
        Scene.given(model),
        Scene.expect(header).not.toHaveHandler('pointerdown'),
      )
    })
  })

  describe('copy', () => {
    it('announces a copy, then clears the announcement', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(model),
        Scene.expect(statusWith('Copied')).toBeAbsent(),
        Scene.click(Scene.role('button', { name: 'Copy as dial Schema' })),
        Scene.Command.resolve(CopyValues, Message.SucceededCopyValues()),
        Scene.expect(statusWith('Copied')).toExist(),
        Scene.Command.resolve(
          WaitBeforeResetCopy,
          Message.CompletedWaitBeforeResetCopy({ version: 1 }),
        ),
        Scene.expect(statusWith('Copied')).toBeAbsent(),
      )
    })

    it('announces a failed copy', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(model),
        Scene.click(Scene.role('button', { name: 'Copy as dial Schema' })),
        Scene.Command.resolve(CopyValues, Message.FailedCopyValues()),
        Scene.expect(statusWith('Copy failed')).toExist(),
        Scene.Command.resolve(
          WaitBeforeResetCopy,
          Message.CompletedWaitBeforeResetCopy({ version: 1 }),
        ),
      )
    })
  })

  it('reports a failed save to storage', () => {
    Scene.scene(
      { update, view: sceneView() },
      Scene.given(model),
      Scene.expect(statusWith("Couldn't save to storage")).toBeAbsent(),
    )
    Scene.scene(
      { update, view: sceneView() },
      Scene.given(step(model, Message.FailedSavePersisted())),
      Scene.expect(statusWith("Couldn't save to storage")).toExist(),
    )
  })

  describe('versions', () => {
    const versionsOpen = step(
      model,
      Message.GotVersionMenuMessage({
        message: Popover.Message.RequestedOpen(),
      }),
    )

    it('lists the versions and marks the active one as current', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(versionsOpen),
        acknowledgeAnchor,
        Scene.expectAll(Scene.all.role('listitem')).toHaveCount(1),
        Scene.expect(Scene.role('button', { name: 'Version 1' })).toHaveAttr(
          'aria-current',
          'true',
        ),
        Scene.expect(Scene.role('button', { name: 'New version' })).toExist(),
        Scene.expect(
          Scene.role('button', { name: 'Reset to defaults' }),
        ).toExist(),
      )
    })

    it('shows the compare banner as a status and stops comparing', () => {
      const saved = step(model, Message.ClickedSaveVersion())
      const comparing = step(
        saved,
        Message.ClickedCompareVersion({ versionId: 'v1' }),
      )

      Scene.scene(
        { update, view: sceneView() },
        Scene.given(comparing),
        Scene.expect(
          Scene.role('button', { name: 'Versions: Version 2' }),
        ).toExist(),
        Scene.expect(statusWith('Comparing with Version 1')).toExist(),
        Scene.click(Scene.role('button', { name: 'Stop' })),
        Scene.expect(statusWith('Comparing with')).toBeAbsent(),
      )
    })
  })

  it('lists the shortcuts in a menu named by its title', () => {
    const shortcutsOpen = step(
      model,
      Message.GotShortcutsMenuMessage({
        message: Popover.Message.RequestedOpen(),
      }),
    )

    Scene.scene(
      { update, view: sceneView() },
      Scene.given(shortcutsOpen),
      acknowledgeAnchor,
      Scene.expect(
        Scene.within(Scene.label('Keyboard Shortcuts'), Scene.role('listitem')),
      ).toContainText('Radius'),
      Scene.expect(
        Scene.within(Scene.label('Keyboard Shortcuts'), Scene.role('listitem')),
      ).toContainText('Scroll'),
    )
  })
})
