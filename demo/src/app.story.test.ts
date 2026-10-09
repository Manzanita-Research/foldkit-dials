import { Array, Option } from 'effect'
import {
  DialPanel,
  DialTimeline,
  ImagePicker,
  ScrubSlider,
} from 'foldkit-dials'
import * as Story from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { fromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'

import { FileDrop, Popover } from '@foldkit/ui'

import { Message, init, update } from './app'
import * as Gallery from './gallery/examples'
import { AppRoute, routeFromUrl } from './route'

const url = (path: string) =>
  Option.getOrThrow(fromString(`https://example.test${path}`))

// ROUTE

describe('gallery routes', () => {
  it.each([
    ['/', AppRoute.Home()],
    ['/gallery', AppRoute.Controls()],
    ['/gallery/panels', AppRoute.Panels()],
    ['/gallery/timeline', AppRoute.Timeline()],
    ['/missing', AppRoute.NotFound({ path: '/missing' })],
  ])('parses %s', (path, route) => {
    expect(routeFromUrl(url(path))).toEqual(route)
  })

  it('drops hidden gesture state while retaining both pages’ values', () => {
    const initial = init(url('/gallery')).model
    const dragging = Gallery.update(
      initial.gallery,
      Gallery.Message.GotSliderMessage({
        message: ScrubSlider.Message.PressedTrack({
          value: 70,
          originValue: 40,
        }),
      }),
    )
    const start = modifyFields(initial, { gallery: () => dragging.model })
    Story.story(
      update,
      Story.given(start),
      Story.message(Message.ChangedUrl({ url: url('/') })),
      Story.model(model => {
        expect(model.route).toEqual(AppRoute.Home())
        expect(model.gallery.amount).toBe(70)
        expect(ScrubSlider.isDragging(model.gallery.slider)).toBe(false)
        expect(model.gallery.dock.isPlaying).toBe(false)
        expect(model.home.app.tuning.radius).toBe(20)
      }),
      Story.message(Message.ChangedUrl({ url: url('/gallery') })),
      Story.model(model => {
        expect(model.gallery.amount).toBe(70)
        expect(model.gallery.page).toBe('Controls')
      }),
    )
  })

  it.each(['/', '/gallery/timeline'])(
    'ends hidden timeline gestures from %s without discarding edits or transport settings',
    path => {
      const initial = init(url(path)).model
      const original =
        path === '/' ? initial.home.app.intro : initial.gallery.dock
      const edited = DialTimeline.update(
        original,
        DialTimeline.Message.PressedBarNudge({
          row: DialTimeline.BarRow.Clip({
            key: path === '/' ? 'card' : 'fade',
          }),
          direction: 'Later',
          size: 'Fine',
        }),
      ).model
      const configured = modifyFields(edited, {
        zoom: () => 2,
        viewStart: () => 0.2,
        dockHeight: () => 350,
        copyVersion: () => 9,
      })
      const dragging = DialTimeline.update(
        configured,
        DialTimeline.Message.PressedRuler({ fraction: 0.4, gesture: 'Seek' }),
      ).model
      expect(dragging.dragState._tag).toBe('Scrubbing')
      const start =
        path === '/'
          ? modifyFields(initial, {
              home: home =>
                modifyFields(home, {
                  app: app => modifyFields(app, { intro: () => dragging }),
                }),
            })
          : modifyFields(initial, {
              gallery: gallery =>
                modifyFields(gallery, { dock: () => dragging }),
            })
      const left = update(
        start,
        Message.ChangedUrl({ url: url('/gallery/panels') }),
      ).model
      const returned = update(
        left,
        Message.ChangedUrl({ url: url(path) }),
      ).model
      const dock =
        path === '/' ? returned.home.app.intro : returned.gallery.dock
      expect(dock.dragState._tag).toBe('Idle')
      expect(dock.isPlaying).toBe(false)
      expect(dock.timeline).toEqual(edited.timeline)
      expect(dock.time).toBe(dragging.time)
      expect(dock.zoom).toBe(2)
      expect(dock.viewStart).toBe(0.2)
      expect(dock.dockHeight).toBe(350)
      expect(dock.copyVersion).toBe(9)
      expect(
        DialTimeline.update(
          dock,
          DialTimeline.Message.MovedLanePointer({ fraction: 0.9 }),
        ).model,
      ).toEqual(dock)
    },
  )

  it('closes a hidden timeline editor while preserving its completed edits', () => {
    const initial = init(url('/gallery/timeline')).model
    const opened = DialTimeline.update(
      initial.gallery.dock,
      DialTimeline.Message.PressedEnterOnBar({
        row: DialTimeline.BarRow.Clip({ key: 'fade' }),
        maybeStepIndex: Option.none(),
      }),
    ).model
    expect(Option.isSome(opened.maybeEditor)).toBe(true)
    const durationSlider = Option.getOrThrow(
      Array.findFirst(
        Option.getOrThrow(opened.maybeEditor).sliders,
        slider => slider.field._tag === 'Duration',
      ),
    )
    const edited = DialTimeline.update(
      opened,
      DialTimeline.Message.GotSliderMessage({
        sliderId: durationSlider.slider.id,
        message: ScrubSlider.Message.PressedKeyboardNavigation({
          direction: 'StepIncrement',
          value: 0.8,
        }),
      }),
    ).model
    expect(edited.timeline).not.toEqual(initial.gallery.dock.timeline)
    const start = modifyFields(initial, {
      gallery: gallery => modifyFields(gallery, { dock: () => edited }),
    })
    const left = update(
      start,
      Message.ChangedUrl({ url: url('/gallery') }),
    ).model
    expect(Option.isNone(left.gallery.dock.maybeEditor)).toBe(true)
    expect(left.gallery.dock.timeline).toEqual(edited.timeline)
  })

  it('clears home header, child and held-shortcut state without resetting versions or persistence guards', () => {
    let model = init(url('/')).model
    const send = (message: DialPanel.Message) => {
      model = update(
        model,
        Message.GotHomeMessage({
          message: DialPanel.AttachMessage.GotDialPanelMessage({ message }),
        }),
      ).model
    }
    send(DialPanel.Message.PressedPanelHeader({ clientX: 1000, clientY: 40 }))
    send(DialPanel.Message.MovedPanelPointer({ clientX: 1040, clientY: 70 }))
    send(
      DialPanel.Message.GotSliderMessage({
        dialId: 'radius',
        message: ScrubSlider.Message.PressedTrack({
          value: 30,
          originValue: 20,
        }),
      }),
    )
    send(
      DialPanel.Message.PressedShortcutKey({
        key: 'r',
        maybeModifier: Option.none(),
      }),
    )
    send(DialPanel.Message.ClickedSaveVersion())
    const before = model.home.dials
    expect(before.headerDrag._tag).toBe('Dragging')
    expect(before.heldShortcutKeys).toEqual(['r'])
    expect(ScrubSlider.isDragging(before.sliders.radius!)).toBe(true)
    const left = update(
      model,
      Message.ChangedUrl({ url: url('/gallery') }),
    ).model
    model = update(left, Message.ChangedUrl({ url: url('/') })).model
    expect(model.home.dials.headerDrag._tag).toBe('Idle')
    expect(model.home.dials.heldShortcutKeys).toEqual([])
    expect(ScrubSlider.isDragging(model.home.dials.sliders.radius!)).toBe(false)
    expect(model.home.dials.versions).toEqual(before.versions)
    expect(model.home.dials.persistVersion).toBe(before.persistVersion)
    expect(model.home.dials.copyVersion).toBe(before.copyVersion)
    expect(model.home.dials.isPersistLoadPending).toBe(
      before.isPersistLoadPending,
    )
    expect(model.home.dials.offset).toEqual(before.offset)
    send(DialPanel.Message.MovedPanelPointer({ clientX: 1200, clientY: 200 }))
    send(DialPanel.Message.ScrolledWithShortcut({ direction: 1 }))
    expect(model.home.dials.offset).toEqual(before.offset)
    expect(model.home.app.tuning.radius).toBe(30)
  })

  it('retains gallery versions and a pending image read across page changes without reopening or stealing focus', () => {
    const initial = init(url('/gallery')).model
    const file = new globalThis.File(['image'], 'sample.png', {
      type: 'image/png',
    })
    let gallery = Gallery.update(
      initial.gallery,
      Gallery.Message.GotPanelMessage({
        message: DialPanel.Message.ClickedSaveVersion(),
      }),
    ).model
    gallery = Gallery.update(
      gallery,
      Gallery.Message.SelectedLayout({ layout: 'Floating' }),
    ).model
    gallery = Gallery.update(
      gallery,
      Gallery.Message.GotImageMessage({
        message: ImagePicker.Message.GotPopoverMessage({
          message: Popover.Message.RequestedOpen(),
        }),
      }),
    ).model
    gallery = Gallery.update(
      gallery,
      Gallery.Message.GotImageMessage({
        message: ImagePicker.Message.GotFileDropMessage({
          message: FileDrop.Message.DroppedFiles({ files: [file] }),
        }),
      }),
    ).model
    expect(gallery.image.uploadState._tag).toBe('Reading')
    gallery = modifyFields(gallery, {
      picker: picker => modifyFields(picker, { selectedFormat: () => 'Oklch' }),
      transition: transition =>
        modifyFields(transition, {
          cache: cache =>
            modifyFields(cache, {
              physicsSpring: spring =>
                modifyFields(spring, { stiffness: () => 333 }),
            }),
        }),
    })
    const start = modifyFields(initial, { gallery: () => gallery })
    const left = update(
      start,
      Message.ChangedUrl({ url: url('/gallery/panels') }),
    ).model
    expect(left.gallery.panel.versions).toEqual(gallery.panel.versions)
    expect(left.gallery.panel.activeVersionId).toBe(
      gallery.panel.activeVersionId,
    )
    expect(left.gallery.panel.persistVersion).toBe(gallery.panel.persistVersion)
    expect(left.gallery.layout).toBe('Floating')
    expect(left.gallery.transition.cache).toEqual(gallery.transition.cache)
    expect(left.gallery.picker.selectedFormat).toBe('Oklch')
    expect(left.gallery.image.uploadState).toEqual(gallery.image.uploadState)
    expect(left.gallery.image.popover.isOpen).toBe(false)
    const completed = update(
      left,
      Message.GotGalleryMessage({
        message: Gallery.Message.GotImageMessage({
          message: ImagePicker.Message.SucceededReadImageFile({
            file,
            dataUrl: 'data:image/png;base64,sample',
          }),
        }),
      }),
    )
    expect(completed.model.gallery.artwork).toBe('data:image/png;base64,sample')
    expect(completed.model.gallery.image.uploads).toEqual([
      { value: 'data:image/png;base64,sample', label: 'sample.png' },
    ])
    expect(completed.model.gallery.image.popover.isOpen).toBe(false)
    expect(completed.commands ?? []).toEqual([])
  })
})
