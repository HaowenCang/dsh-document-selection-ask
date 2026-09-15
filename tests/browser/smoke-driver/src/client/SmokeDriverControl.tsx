/**
 * The smoke driver's control: three test-only buttons, one per fixture.
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

/** Style for the control strip: bottom-left, out of the preview's way. */
const CONTROL_STYLE = {
  position: 'fixed',
  left: '12px',
  bottom: '12px',
  zIndex: 2147483000,
  display: 'flex',
  gap: '6px',
  padding: '4px',
  background: 'rgba(17,17,17,0.86)',
  borderRadius: '6px',
  font: '12px/1.4 system-ui, sans-serif',
} as const

/** Style for one button. */
const BUTTON_STYLE = {
  padding: '3px 8px',
  border: '1px solid rgba(255,255,255,0.35)',
  borderRadius: '4px',
  background: 'transparent',
  color: '#fff',
  cursor: 'pointer',
  font: 'inherit',
} as const

/**
 * The registry kind of the product's document preview.
 *
 * Read from the installed
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview@0.1.5-rc.1` bundle, where
 * it is the `TEXTPREVIEW_KIND` constant the `text` tab definition registers
 * under, and where `TEXTPREVIEW_ID` is
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`. The kind is a public
 * registry key rather than an internal name: `openResource` documents
 * `options.kind` as "name the opening type instead of letting the registry rank
 * claims".
 */
const PRODUCT_PREVIEW_KIND = 'text'

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
      <span data-dsa-smoke-label="" style={{ color: '#bbb', alignSelf: 'center' }}>
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
            // the tab and reveals the column in one step, so the driver asks
            // for nothing else; `kind` selects the implementation under test
            // (see the module comment).
            ctx.sidebarRight.openResource(smokeFixtureAddress(sessionId, fixture.path), {
              kind: PRODUCT_PREVIEW_KIND,
            })
          }}
        >
          {fixture.label}
        </button>
      ))}
    </div>
  )
}
