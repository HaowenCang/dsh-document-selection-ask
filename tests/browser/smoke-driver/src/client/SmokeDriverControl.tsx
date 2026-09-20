/**
 * The smoke driver's control: one test-only button per fixture, twenty-six of
 * them, rendered as a bounded grid inside the chat column.
 *
 * **What this module is allowed to do.** Each button calls exactly one public
 * API — `ctx.sidebarRight.openResource(address)` — and nothing else. It does not
 * query the document, click a hidden shell control, write layout state, build a
 * preview element, or call a preview component. Every `data-textpreview-*` node
 * the smoke waits for is produced by the DSH document preview itself, mounting
 * because the shell navigated; that is the property Task 5B exists to prove, and
 * a driver that helped would destroy it.
 *
 * **Why the kind is named.** `openResource` may be asked for one registered tab
 * type instead of the registry's ranking, and this driver names the product's
 * document preview — the `text` kind, the one
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` registers. That is not a
 * preference. On this machine's profiles the ranking does **not** reach the
 * product preview: `dsh-better-sidebar` registers a file viewer at
 * `priority: 'extension'` with `patterns: ['dsh-resource://file/**']`, which
 * outranks the preview's own `fallback` band, so a bare `openResource` lands in
 * that plugin's editor and no `data-textpreview-*` node is ever produced (the
 * Task 5B probes recorded exactly that). Naming the kind is the published option
 * that selects the implementation under test; it changes nothing about who
 * renders, and DSH still mounts the preview itself.
 *
 * **Where the session identity comes from.** The control occupies
 * `conversation.input.overlay`, a **session-scoped** list slot, so the framework
 * passes the current session id to the component as a standard prop. That is the
 * only source of the identity used in a fixture address — no `localStorage`
 * read, no page scrape, no global.
 *
 * **Why the control is loud.** It is a test control on a smoke profile and can
 * be on screen while a developer drives the same instance by hand, so it says
 * what it is. It renders no preview markup of any kind, which is the property
 * the unit suite asserts against this file's source.
 *
 * **Why the strip is bounded.** The strip is the *only* way any smoke case opens
 * a fixture, and every case opens it with an ordinary actionability-checked
 * `locator.click()` — no forced click, no DOM-dispatched event, no viewport
 * widening, no `scrollIntoViewIfNeeded`. A control the browser will not accept
 * as clickable is therefore a failing case, and the strip has to put all
 * twenty-five controls where the browser will accept them.
 *
 * It did not. As one unbounded `flex` row the twenty-four labels measured
 * 1,568 px against a 1,280 px viewport, and the five XLSX controls at the tail of
 * `SMOKE_FIXTURES` lay 294 px past the right edge: Playwright reported "element
 * is outside of the viewport" and the XLSX suite failed before the plugin under
 * test was ever exercised. Spanning the window instead then lost controls to two
 * overlays the strip does not own — the shell's resize handle, and the preview
 * column, which wins the hit test over anything that reaches under it because of
 * where the overlay slot sits in the stacking order. Both are measured in
 * `CONTROL_STYLE` below, together with the bounds that avoid them.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { JSX } from 'react'

import { SMOKE_FIXTURES, smokeFixtureAddress } from './fixtures.js'

/**
 * The one navigation call the driver makes.
 *
 * Declared structurally rather than imported so this module depends on the
 * published shape only: `ctx.sidebarRight` is typed by
 * `@deepseek-ai/dsh-client-ui-sidebar-right/client`, whose augmentation is
 * imported by the client entry, and the call below is the call that contract
 * declares.
 */
export type OpenResource = (address: string) => void

/**
 * Props the driver's slot entry receives.
 *
 * The framework share is the published standard props of the session-scoped
 * `conversation.input.overlay` slot — the same shape the shipping plugin's
 * overlay is registered against, which is what makes `sessionId` a contract
 * rather than a convention — and the driver adds exactly one injected member.
 */
export type SmokeDriverProps = PropsRuntime<'conversation.input.overlay'> & {
  /** The client root context, injected by the driver's own registrar. */
  readonly ctx: Context
}

/**
 * Style for the control strip.
 *
 * ## Why it is bounded, and why these bounds
 *
 * The strip is anchored to the bottom of the **chat column** and bounded on both
 * axes, at values measured in the live application at the 1,280 x 720 viewport
 * the smoke runs at. Both naive placements lose controls to overlays the strip
 * does not own:
 *
 * - Spanning the window (`left: 12px; right: 12px`) was the first attempt. The
 *   composer's column establishes a stacking context around the overlay slot
 *   this control is mounted in, so the preview column — painted later at the
 *   root — wins the hit test over every control that reaches under it. That
 *   column starts at `x = 704`, and a window-wide strip put the five XLSX
 *   controls of its last row underneath it.
 * - A window-wide strip narrower than the window but still starting at
 *   `left: 12px` loses controls to the shell's right-sidebar **resize handle**,
 *   an 8 px column at `x = 276` laid over the chat column. Measured with a
 *   `left: 12px; width: 680px` strip: `pptx-external-media` landed on the handle
 *   and no click reached it.
 *
 * `left: 292px` clears the handle's far edge, and `width: 408px` ends 12 px
 * short of the preview column, so neither overlay can intercept a control. The
 * third bound is vertical: the composer's published box ends at `y = 447` and
 * the strip's bottom inset leaves it at `y = 708`, so the strip has to stay under
 * 261 px tall to keep its top edge below the composer.
 *
 * `repeat(4, minmax(0, 1fr))` is the track that resolves every bound at once.
 * Twenty-four controls at four per row made seven rows, and seven rows measured
 * 218 px — inside the vertical bound, with the strip's top edge at `y = 490`
 * against the composer's 447. The track is clipping rather than intrinsic for a
 * measured reason: `minmax(0, max-content)` is as wide as the longest label in
 * its column, and the twenty-four labels at this font measure 2,672 px in total
 * against the 400 px the bounds leave available, so an intrinsic track either
 * widens the grid past the preview column — where its controls were measured to
 * become unreachable — or is clamped back to a share of the container anyway.
 * A `1fr` track states that share explicitly and crops a long label instead of
 * letting it escape, and `overflow: hidden` on the strip keeps the whole box
 * inside its own bounds.
 *
 * Task 13 added the twenty-fifth fixture, the CSV file the universal acceptance
 * suite needed, and the row count is what that costs: twenty-five controls plus
 * the strip's own label are twenty-six grid items, and `ceil(26 / 4)` is still
 * seven rows, so the bounds above hold unchanged. Re-measured after the addition
 * on the real `dsa-smoke` instance at 1,280 x 720: the strip box is
 * `292, 490.4, 408 x 217.6` and all twenty-five controls remain inside the
 * viewport and clickable by an ordinary actionability-checked `locator.click()`.
 * The fixture count is therefore a measured quantity here rather than an
 * assumption, and the next fixture added will have to re-measure it too.
 *
 * The twenty-sixth fixture did, and that is the whole of what it cost.
 * `xlsx-corrupt` — the deliberately truncated workbook Task 15UR added so the
 * renderer's refusal path has a real surface to measure — makes it twenty-six
 * controls and twenty-seven grid items, and `ceil(27 / 4)` is still seven rows.
 * Re-measured on the release-verification profile at 1,280 x 720: the strip box
 * is `292, 490.4, 408 x 217.6` — the same y and the same height, to the fraction,
 * as the measurement above — with all twenty-six controls inside the viewport,
 * none hidden, and the composer's card still ending 43.4 px above the strip's top
 * edge at `y = 447`.
 *
 * ## Why a grid rather than a wrapping flex row
 *
 * A wrapping flex row picks its own break points from whichever controls share a
 * line, so its height follows the label text and drifts when a label changes. A
 * grid fixes the column count, so the strip's height is a function of the fixture
 * count alone and its top edge cannot creep into the composer. Measured during
 * Task 12R with the then twenty-four controls at the same width: 218 px tall
 * as one flex arrangement and 156 px as another, and a `max-content` track pushed
 * a 388 px strip's grid to 719 px.
 *
 * The fixture key each control publishes stays the full, uncropped identity, and
 * every control keeps its natural size: nothing here scales, transforms or zooms.
 */
const CONTROL_STYLE = {
  position: 'fixed',
  left: '292px',
  bottom: '12px',
  width: '408px',
  zIndex: 2147483000,
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  justifyContent: 'start',
  overflow: 'hidden',
  alignItems: 'start',
  gap: '6px',
  padding: '4px',
  boxSizing: 'border-box',
  background: 'rgba(17,17,17,0.86)',
  borderRadius: '6px',
  font: '12px/1.4 system-ui, sans-serif',
} as const

/**
 * Style for one button.
 *
 * `white-space: nowrap` keeps each label on one line, so a control's height is
 * the strip's own and the row count is what decides the strip's height.
 * `min-width: 0` with `overflow: hidden` keeps a label inside its column.
 */
const BUTTON_STYLE = {
  padding: '3px 8px',
  border: '1px solid rgba(255,255,255,0.35)',
  borderRadius: '4px',
  background: 'transparent',
  color: '#fff',
  cursor: 'pointer',
  font: 'inherit',
  whiteSpace: 'nowrap',
  minWidth: '0',
  overflow: 'hidden',
} as const

/**
 * The registry kind of the product's document preview, as Task 5B established
 * it. Read from the installed
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview@0.1.5-rc.1` bundle, where
 * it is the `TEXTPREVIEW_KIND` constant the `text` tab definition registers
 * under, and where `TEXTPREVIEW_ID` is
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`. The kind is a public
 * registry key rather than an internal name: `openResource` documents
 * `options.kind` as "name the opening type instead of letting the registry rank
 * claims".
 *
 * It names the **tab** type, and says nothing about how the opened file is read.
 * A PDF opened through this tab still reaches the renderer registry, which ranks
 * this plugin's `priority: 'extension'` PDF definition above the builtin one and
 * reads the file according to that definition's `loading: 'bytes-complete'`. See
 * `SmokeFixture.tabKind` for why every fixture names it.
 */
const PRODUCT_PREVIEW_KIND = 'text'

/**
 * The options one fixture's navigation passes.
 *
 * @param tabKind - the tab kind the fixture names, or `undefined` to let the tab
 * registry rank the types that claim the address.
 * @returns the options argument, or nothing at all when the fixture names none.
 */
function openOptions(tabKind: string | undefined): { kind: string } | undefined {
  return tabKind === undefined ? undefined : { kind: tabKind }
}

/**
 * Render the fixture controls.
 *
 * @param props - the session id and the client context they act on.
 * @returns the control strip.
 */
export function SmokeDriverControl(props: SmokeDriverProps): JSX.Element {
  const { ctx, sessionId } = props

  return (
    <div data-dsa-smoke-driver="" style={CONTROL_STYLE}>
      <span data-dsa-smoke-label="" style={{ color: '#bbb', whiteSpace: 'nowrap' }}>
        dsa-smoke
      </span>
      {SMOKE_FIXTURES.map((fixture) => (
        <button
          key={fixture.key}
          type="button"
          data-dsa-smoke-open={fixture.key}
          style={BUTTON_STYLE}
          onClick={() => {
            // The whole navigation. `openResource` claims the address, places
            // the tab and reveals the column in one step, so the driver asks for
            // nothing else. Which renderer then draws the file is decided by the
            // document preview's own registry, not by anything here.
            const address = smokeFixtureAddress(sessionId, fixture.path)
            const options = openOptions(fixture.tabKind)
            if (options === undefined) ctx.sidebarRight.openResource(address)
            else ctx.sidebarRight.openResource(address, options)
          }}
        >
          {fixture.label}
        </button>
      ))}
    </div>
  )
}
