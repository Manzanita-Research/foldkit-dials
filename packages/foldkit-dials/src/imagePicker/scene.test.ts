import { Array, Option } from 'effect'
import { inertHtml as ih } from 'foldkit/html'
import * as Scene from 'foldkit/scene'
import { describe, it } from 'vitest'

import { Popover } from '@foldkit/ui'

import type { RenderInfo } from './index.js'
import {
  FocusImage,
  Message,
  OutMessage,
  ReadImageFile,
  init,
  update,
  uploadFailureText,
  view,
} from './index.js'

const COAST = '/images/coast.jpg'
const FOREST = '/images/forest.jpg'
const UPLOADED = 'data:image/png;base64,uploaded'
const OVERSIZED_BYTES = 10 * 1024 * 1024 + 1

const anchor: Popover.AnchorConfig = { placement: 'left-start', gap: 8 }

const testToView = ({
  attributes,
  choices,
  valueLabel,
  isVisible,
  maybeUploadFailure,
}: RenderInfo) =>
  ih.div(
    [...attributes.root],
    [
      ih.button([...attributes.trigger], [valueLabel]),
      ...(isVisible
        ? [
            ih.div([...attributes.backdrop]),
            ih.div(
              [...attributes.panel],
              [
                ih.button([...attributes.remove], ['Remove']),
                ih.div(
                  [...attributes.grid],
                  Array.map(choices, choice =>
                    ih.button([...choice.option], [choice.label]),
                  ),
                ),
                ih.label(
                  [...attributes.upload],
                  ['Upload image', ih.input([...attributes.fileInput])],
                ),
                ih.div(
                  [...attributes.status],
                  Array.fromOption(
                    Option.map(maybeUploadFailure, uploadFailureText),
                  ),
                ),
              ],
            ),
          ]
        : []),
    ],
  )

const sceneView = Scene.withViewInputs(view, {
  value: COAST,
  label: 'Cover',
  anchor,
  toView: testToView,
})

const closedModel = init({
  id: 'cover',
  options: [{ value: COAST, label: 'Coast' }, FOREST],
})
const openModel = update(
  closedModel,
  Message.GotPopoverMessage({ message: Popover.Message.RequestedOpen() }),
).model

const avatarFile = new globalThis.File(['png'], 'avatar.png', {
  type: 'image/png',
})

const acknowledgeAnchor = Scene.Mount.resolve(
  Popover.AnchorPopover,
  Popover.Message.CompletedAnchorPopover(),
)
const acknowledgeBackdrop = Scene.Mount.resolve(
  Popover.PortalPopoverBackdrop,
  Popover.Message.CompletedPortalPopoverBackdrop(),
)
const acknowledgeFocusButton = Scene.Command.resolve(
  Popover.FocusButton,
  Popover.Message.CompletedFocusButton(),
)
const acknowledgeFocusImage = Scene.Command.resolve(
  FocusImage,
  Message.CompletedFocusImage(),
)

const trigger = Scene.role('button', { name: /^Choose cover image:/ })
const panel = Scene.role('dialog', { name: 'Cover image picker' })
const grid = Scene.role('radiogroup', { name: 'Available images' })
const coastImage = Scene.role('radio', { name: 'Coast' })
const forestImage = Scene.role('radio', { name: 'forest.jpg' })
const uploadedImage = Scene.role('radio', { name: 'avatar.png' })
const removeButton = Scene.role('button', { name: 'Remove cover image' })
const hiddenRemoveButton = Scene.text('Remove')
const upload = Scene.selector('label')
const fileInput = Scene.label('Upload image')
const status = Scene.role('status')

describe('ImagePicker', () => {
  describe('trigger', () => {
    it('names the current image and opens the picker as a dialog', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(closedModel),
        Scene.expect(
          Scene.role('button', { name: 'Choose cover image: Coast' }),
        ).toHaveText('Coast'),
        Scene.expect(trigger).toHaveAttr('aria-haspopup', 'dialog'),
        Scene.expect(trigger).toHaveAttr('aria-expanded', 'false'),
        Scene.expect(panel).toBeAbsent(),
        Scene.click(trigger),
        Scene.expect(trigger).toHaveAttr('aria-expanded', 'true'),
        Scene.expect(panel).toExist(),
        Scene.expect(grid).toExist(),
        acknowledgeAnchor,
        acknowledgeBackdrop,
      )
    })

    it('focuses the selected thumbnail when the picker opens', () => {
      Scene.scene(
        { update, view: sceneView({ value: FOREST }) },
        Scene.given(openModel),
        Scene.Mount.expectHas(
          Popover.AnchorPopover({
            buttonId: 'cover-popover-button',
            anchor,
            focusSelector: '#cover-image-1',
            arrowId: 'cover-popover-arrow',
          }),
        ),
        acknowledgeAnchor,
        acknowledgeBackdrop,
        Scene.expect(forestImage).toHaveAttr('aria-checked', 'true'),
        Scene.expect(forestImage).toHaveAttr('tabIndex', '0'),
        Scene.expect(coastImage).toHaveAttr('aria-checked', 'false'),
        Scene.expect(coastImage).toHaveAttr('tabIndex', '-1'),
        Scene.expect(coastImage).not.toHaveAttr('aria-pressed'),
      )
    })

    it('marks the trigger disabled and drops its handlers', () => {
      Scene.scene(
        { update, view: sceneView({ isDisabled: true }) },
        Scene.given(closedModel),
        Scene.expect(trigger).toHaveAttr('aria-disabled', 'true'),
        Scene.expect(trigger).not.toHaveHandler('click'),
        Scene.expect(trigger).not.toHaveHandler('keydown'),
      )
    })
  })

  describe('keyboard', () => {
    it('moves the roving tab stop with the arrow keys, Home, and End', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openModel),
        acknowledgeAnchor,
        acknowledgeBackdrop,
        Scene.keydown(coastImage, 'ArrowRight'),
        acknowledgeFocusImage,
        Scene.expect(forestImage).toHaveAttr('tabIndex', '0'),
        Scene.expect(coastImage).toHaveAttr('tabIndex', '-1'),
        Scene.keydown(forestImage, 'Home'),
        acknowledgeFocusImage,
        Scene.expect(coastImage).toHaveAttr('tabIndex', '0'),
        Scene.keydown(coastImage, 'ArrowDown'),
        acknowledgeFocusImage,
        Scene.expect(forestImage).toHaveAttr('tabIndex', '0'),
        Scene.expectNoOutMessage(),
      )
    })

    it('selects with Enter and with Space', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openModel),
        acknowledgeAnchor,
        acknowledgeBackdrop,
        Scene.keydown(forestImage, 'Enter'),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: FOREST })),
        acknowledgeFocusImage,
        Scene.keydown(forestImage, ' '),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: FOREST })),
        acknowledgeFocusImage,
      )
    })

    it('lets Escape through the thumbnails to the panel, which closes and refocuses the trigger', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openModel),
        acknowledgeAnchor,
        acknowledgeBackdrop,
        Scene.keydown(coastImage, 'Escape'),
        Scene.expectIgnored(),
        Scene.keydown(panel, 'Escape'),
        Scene.Mount.expectEnded(
          Popover.AnchorPopover,
          Popover.PortalPopoverBackdrop,
        ),
        acknowledgeFocusButton,
        Scene.expect(panel).toBeAbsent(),
        Scene.expectNoOutMessage(),
      )
    })
  })

  describe('select and remove', () => {
    it('reports a clicked thumbnail', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openModel),
        acknowledgeAnchor,
        acknowledgeBackdrop,
        Scene.click(forestImage),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: FOREST })),
        acknowledgeFocusImage,
        Scene.expect(panel).toExist(),
      )
    })

    it('removes the image, closes, and refocuses the trigger', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openModel),
        acknowledgeAnchor,
        acknowledgeBackdrop,
        Scene.click(removeButton),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: '' })),
        Scene.Mount.expectEnded(
          Popover.AnchorPopover,
          Popover.PortalPopoverBackdrop,
        ),
        acknowledgeFocusButton,
        Scene.expect(panel).toBeAbsent(),
      )
    })

    it('hides Remove when there is no image', () => {
      Scene.scene(
        { update, view: sceneView({ value: '' }) },
        Scene.given(openModel),
        acknowledgeAnchor,
        acknowledgeBackdrop,
        Scene.expect(trigger).toHaveText('No image'),
        Scene.expect(hiddenRemoveButton).toHaveAttr('hidden'),
        Scene.expect(hiddenRemoveButton).not.toHaveHandler('click'),
        Scene.expect(Scene.role('radio', { name: 'Coast' })).toHaveAttr(
          'aria-checked',
          'false',
        ),
      )
    })
  })

  describe('upload', () => {
    it('reads a dropped image, adds its thumbnail, and selects it', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openModel),
        acknowledgeAnchor,
        acknowledgeBackdrop,
        Scene.dropFiles(panel, [avatarFile]),
        Scene.expect(upload).toHaveAttr('aria-disabled', 'true'),
        Scene.expect(grid).toHaveAttr('aria-busy', 'true'),
        Scene.expect(fileInput).toBeDisabled(),
        Scene.Command.resolve(
          ReadImageFile,
          Message.SucceededReadImageFile({
            file: avatarFile,
            dataUrl: UPLOADED,
          }),
        ),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: UPLOADED })),
        acknowledgeFocusImage,
        Scene.expect(uploadedImage).toExist(),
        Scene.expect(fileInput).toBeEnabled(),
      )
    })

    it('shows why a chosen file was rejected', () => {
      const oversizedFile = new globalThis.File(
        [new Uint8Array(OVERSIZED_BYTES)],
        'huge.png',
        { type: 'image/png' },
      )

      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openModel),
        acknowledgeAnchor,
        acknowledgeBackdrop,
        Scene.expect(fileInput).toHaveAttr('accept', 'image/*'),
        Scene.changeFiles(fileInput, [oversizedFile]),
        Scene.Command.resolve(
          ReadImageFile,
          Message.FailedReadImageFile({
            file: oversizedFile,
            failure: 'TooLarge',
          }),
        ),
        Scene.expectNoOutMessage(),
        Scene.expect(status).toHaveText('Choose an image smaller than 10 MB.'),
        Scene.expect(uploadedImage).toBeAbsent(),
      )
    })
  })

  describe('focus outside', () => {
    it('closes when focus lands outside the picker', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openModel),
        acknowledgeAnchor,
        acknowledgeBackdrop,
        Scene.Subscription.emit(Message.MovedFocusOutsidePicker()),
        Scene.Mount.expectEnded(
          Popover.AnchorPopover,
          Popover.PortalPopoverBackdrop,
        ),
        acknowledgeFocusButton,
        Scene.expect(panel).toBeAbsent(),
        Scene.expectNoOutMessage(),
      )
    })
  })
})
