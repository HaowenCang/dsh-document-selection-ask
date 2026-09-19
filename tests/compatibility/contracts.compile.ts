/**
 * DSH public contract compile probe.
 *
 * This file is a compile-time assertion, not a test with runtime behaviour: it
 * has no `expect`, no runner, and no runtime entry point. `pnpm typecheck`
 * compiles it under `tsconfig.client.json` against the DSH packages actually
 * installed on this machine, so a contract that is missing, renamed, moved
 * behind a private path, or narrowed stops the build.
 *
 * Two rules govern the file, and both exist so that a passing probe means
 * something:
 *
 * 1. No escape hatch. No `any`, no `as`, no `@ts-ignore`, no `@ts-expect-error`,
 *    no private `@deepseek-ai/.../src/...` import, no DSH-internal type copied
 *    into this repository. If a contract is absent, this file fails to compile
 *    and the task reports BLOCKED; it never becomes a shim. `satisfies` and
 *    plain annotated bindings are the only assertion mechanisms used: they
 *    check without widening, so a missing member is an error rather than a
 *    silent structural match.
 *
 * 2. Every declared value is read, and every contract is named by a DSH
 *    declaration rather than by an assertion this repository writes about
 *    itself. A `declare const` that nothing touches would prove only that the
 *    *type* resolves, not that the contract's members exist or that the slot
 *    key is declared — so each value below contributes at least one member
 *    access whose result reaches the returned array.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'

import type {
  ClientContext,
  ComposerInputActions,
  ComposerInputState,
  ConversationInputOverlayProps,
  DocumentLoadMode,
  DocumentPreviewDefinition,
  ShellOverlayProps,
  ShellUseSessions,
} from '../../src/client/dsh/contracts.js'
import { applyClient } from '../../src/client/dsh/register.js'
import type { SelectionAskOverlayProps } from '../../src/client/ui/SelectionAskOverlay.js'

declare const ctx: Context
declare const documentProps: DocumentPreviewProps
declare const overlayProps: PropsRuntime<'conversation.input.overlay'>
declare const shellOverlayProps: PropsRuntime<'shell.overlay'>
declare const inputActions: InputActions

/** The overlay props as the plugin's own contract module publishes them. */
declare const overlayViaContracts: ConversationInputOverlayProps
/** The shell-overlay props as the plugin's own contract module publishes them. */
declare const shellOverlayViaContracts: ShellOverlayProps
/** The active-session hook as the plugin's own contract module publishes it. */
declare const shellUseSessions: ShellUseSessions
/** The Ask surface's own prop contract, which the slot must be able to satisfy. */
declare const askSurfaceProps: SelectionAskOverlayProps
/** The composer action face read through the plugin's own contract module. */
declare const composerActions: ComposerInputActions
/** The published composer state read through the plugin's own contract module. */
declare const composerState: ComposerInputState
/** The client context as the plugin's registrar receives it. */
declare const clientCtx: ClientContext

/**
 * Read every contract the plugin depends on.
 *
 * The returned array is typed by construction, so the compiler checks each
 * member access on the way out; nothing here is discarded before that happens.
 * @returns one entry per verified contract, for a reader who wants the list.
 */
export function probeDshContracts(): readonly unknown[] {
  // 1. `ctx.documentPreviews` — the renderer registry service. `register`
  //    accepts a `DocumentPreviewDefinition` and returns its disposer.
  const documentPreviews = ctx.documentPreviews
  const definition: DocumentPreviewDefinition = {
    id: 'contract-probe',
    extensions: ['probe'],
    priority: 'extension',
    title: () => 'probe',
    loading: 'bytes-complete',
    wrap: false,
  }
  const previewDisposer: () => void = documentPreviews.register(definition)
  const loadMode: DocumentLoadMode = definition.loading
  const alternativeLoadMode: DocumentLoadMode = 'text-pages'

  // 2. `DocumentPreviewProps` — the standard input of a keyed document body,
  //    carrying the original file address and the owner-prepared content. The
  //    `satisfies` on `content` proves the discriminated union is intact
  //    without widening it away.
  const resourceAddress: string = documentProps.resourceAddress
  const wrap: boolean = documentProps.wrap
  const content = documentProps.content satisfies { readonly kind: 'text' | 'bytes' }
  const contentKind = content.kind

  // 3. `sidebar.right.tab.document` — the keyed slot those bodies register
  //    into. It is named only through `DocumentPreviewProps`, so the key is
  //    declared by DSH: if the key is renamed or its kind changes, the
  //    `DocumentPreviewProps` line above fails and the slot contract needs no
  //    self-written assertion here.

  // 4. `conversation.input.overlay` — session-scoped props: the composer's
  //    published state, its public action face, and the session identity all
  //    arrive through the overlay props rather than through a private read.
  //
  //    The annotated parameter and the two typed bindings inside the callback
  //    are why this is more than a smoke test. When the declarations name a
  //    `@deepseek-ai` package the installation does not ship, TypeScript
  //    degrades the named import to `any` *silently*: the callback parameter
  //    becomes `any`, every member access here would "pass", and the probe
  //    would report a contract as verified while checking nothing. Annotating
  //    the parameter turns that degradation into a compile error.
  const overlayDraft: string = overlayProps.useInput((state: ComposerInputState) => {
    const published: string = state.draft
    const revision: number = state.draftRev
    return `${published}${String(revision)}`
  })
  const overlayActions: InputActions = overlayProps.inputActions
  const overlaySessionId = overlayProps.sessionId
  const overlayDraftViaContracts: string = overlayViaContracts.useInput(
    (state: ComposerInputState) => state.draft,
  )

  // 5. The public `setDraft` action, reached directly and through the overlay
  //    props. This is the only channel the plugin may write the draft through;
  //    a rename or removal is a compile error here.
  inputActions.setDraft('contract-probe')
  overlayActions.setDraft('contract-probe')
  composerActions.setDraft('contract-probe')
  const draft: string = composerState.draft

  // 6. `shell.overlay` — the frame-wide list slot the visible Ask surface moved
  //    to in Task 5C. The annotations are the whole probe: `kind` and `scope` are
  //    literal members of the declaration DSH publishes, so a rename, a change of
  //    kind, or a move to session scope each fails to compile here rather than
  //    silently changing which tree the surface renders in.
  const shellOverlayKind: SlotMap['shell.overlay']['kind'] = 'list'
  const shellOverlayScope: SlotMap['shell.overlay']['scope'] = 'root'

  // 7. The root scope carries the global standard props, and the Ask surface's
  //    own prop contract must be satisfiable from them: `useSessions` is declared
  //    by `@deepseek-ai/dsh-client-ui-session` on `GlobalStandardProps`, so the
  //    `satisfies` line below is the assertion that the active session is
  //    readable through a published seat rather than through a private store.
  const shellActiveSession: string | undefined = shellOverlayProps.useSessions(
    (state) => state.current,
  )
  const shellActiveSessionViaContracts: string | undefined = shellOverlayViaContracts.useSessions(
    (state) => state.current,
  )
  const shellActiveSessionDirect: string | undefined = shellUseSessions((state) => state.current)
  // Explicitly annotated, not inferred: the annotation is what proves the slot's
  // global standard props can satisfy the surface's own contract. An inferred
  // binding would compile even if the two drifted structurally apart.
  const askSurfaceTakeShellProps: Pick<SelectionAskOverlayProps, 'useSessions'> = {
    useSessions: shellOverlayProps.useSessions,
  }
  // The surface's injected face, read through the plugin's own contract: the
  // target table is what replaced the composer's `useInput` at this seat, so its
  // shape is part of the slot contract rather than an implementation detail.
  const askSurfaceDraftAtClick: string | null =
    askSurfaceProps.composerTargets.get('contract-probe')?.readDraft() ?? null

  // 8. The plugin's own registrar keeps the context type the DSH web boot
  //    hands it, so later registration calls type-check against the real
  //    client context rather than against a locally invented shape.
  //
  //    Since Task 12 it returns the one runtime the plugin's single top-level
  //    effect owns. The return type is read through an explicit annotation for
  //    the same reason the overlay parameter above is annotated: a runtime whose
  //    members silently degraded to `any` would still compile as a value here,
  //    while `dispose` — the whole teardown contract — would be unchecked.
  const registerClient: (target: ClientContext) => void = applyClient
  const clientRuntime: { dispose: () => void } = applyClient(clientCtx)

  return [
    documentPreviews,
    previewDisposer,
    loadMode,
    alternativeLoadMode,
    resourceAddress,
    wrap,
    contentKind,
    overlayDraft,
    overlayActions,
    overlaySessionId,
    overlayDraftViaContracts,
    draft,
    shellOverlayKind,
    shellOverlayScope,
    shellActiveSession,
    shellActiveSessionViaContracts,
    shellActiveSessionDirect,
    askSurfaceTakeShellProps,
    askSurfaceDraftAtClick,
    registerClient,
    clientRuntime,
    clientCtx,
  ]
}
