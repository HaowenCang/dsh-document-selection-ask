/**
 * The single statements of the DSH client contract this plugin builds on.
 *
 * Every `import type {} from …` below is load-bearing rather than incidental:
 * the DSH client surfaces declare themselves by augmenting shared tables —
 * `@deepseek-ai/cordis` `Context` for services, `@deepseek-ai/dsh-client-ui-slots`
 * `SlotMap` for slots. TypeScript applies those augmentations only when the
 * declaring module is part of the program, and the module specifiers are
 * content-addressed by the type checker (each carries its own `declare module`
 * statements). Importing the module that declares the augmentation is how a
 * plugin states, in one auditable place, which DSH contracts it consumes.
 *
 * `skipLibCheck` is enabled in `tsconfig.client.json` because several DSH client
 * packages reference optional peer packages a plugin consumer is not expected
 * to install. It does not soften these imports: each one below resolves to a
 * real declaration, and every package on this contract graph is pinned to one
 * exact release in `devDependencies`, so `pnpm install` supplies the whole graph
 * inside this project and `pnpm dsh:doctor` reports the pin against the DSH
 * installation on this machine. A named import that cannot be resolved would
 * degrade to `any` silently, so the probe annotates what it reads.
 *
 * Public import paths only. The DSH packages also publish `./src/*`; this
 * plugin never uses it, and `tests/compatibility/contracts.compile.ts` fails to
 * compile if any of the contracts below are renamed, moved, or withdrawn.
 */

// `ctx.documentPreviews` and the `sidebar.right.tab.document` keyed slot: both
// are declared by this package's `client` entry.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
// The `shell.overlay` root-scoped list slot, the frame's own additive seat for a
// surface that floats over the whole application. Declared by this package's
// `client` entry, which is also the entry that renders it — an external plugin
// cannot declare the slot itself.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// `PropsRuntime` plus the `SlotMap`/`GlobalStandardProps`/`SessionStandardProps`
// declaration-merging tables the whole slot contract is composed from.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// `useSessions` — the global standard prop the Ask surface reads the active
// session through — and the session-scoped standard props. Declared by this
// package's `client` entry.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// `ctx.slots` — the renderer-owned slot registry — and the `slots/changed`
// event. Declared by this package's `client` entry, and the reason the client
// half lists `slots` in its runtime `inject`: a slot contribution made before
// the registry is available throws instead of waiting.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// `InputActions`, `InputState`, and the `conversation.input.overlay` list slot.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import type { Context } from '@deepseek-ai/cordis'
import type {
  DocumentLoadMode,
  DocumentPreviewDefinition,
} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  InputActions,
  InputState,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The client root context DSH hands to a plugin's browser `apply`. */
export type ClientContext = Context

/**
 * The document-preview registry service.
 *
 * Stated as an indexed access rather than as an import because the class behind
 * it is not re-exported from the package's `./client` entry: that entry declares
 * `ctx.documentPreviews` by augmenting `Context`, which is the published route to
 * the type. Reaching for the declaration file directly would be the private
 * import this project forbids, and re-spelling the registry structurally would
 * let a renamed method keep compiling.
 */
export type DocumentPreviewRegistry = ClientContext['documentPreviews']

/**
 * The DSH services one renderer registration contributes through.
 *
 * Resolved once by the client runtime before any renderer is registered, and
 * passed down as this explicit face rather than as the whole context. Two
 * consequences are deliberate: a renderer cannot reach a service the runtime did
 * not vouch for, and the absence of a required service fails the runtime's own
 * validation instead of half-installing a renderer that would only report the
 * problem to the console.
 */
export interface RendererRegistrationHost {
  /** The extension-renderer registry the definition is ranked in. */
  readonly previews: DocumentPreviewRegistry
  /** The slot registry the renderer's keyed body is mounted from. */
  readonly slots: SlotRegistry
  /** The document a renderer's style sheet is installed into, when there is one. */
  readonly document?: Document | undefined
}

/** The renderer-owned slot registry the Ask overlay registers into. */
export type { SlotRegistry }

/** Standard props every document body registered under a preview key receives. */
export type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'

/** Props of one occupant of the floating `conversation.input.overlay` list. */
export type ConversationInputOverlayProps = PropsRuntime<'conversation.input.overlay'>

/**
 * Props of one occupant of the frame-wide `shell.overlay` list.
 *
 * The root scope carries the **global** standard props rather than the session
 * ones, which is exactly why the Ask surface needs the target registry: the
 * session-scoped composer contract is not available at this seat, and
 * `useSessions` — the published route to the active session — is.
 */
export type ShellOverlayProps = PropsRuntime<'shell.overlay'>

/** The published selector hook over the shell's session list and selection. */
export type ShellUseSessions = ShellOverlayProps['useSessions']

/** The public, stable composer action face: `setDraft`, attachments, `submit`. */
export type ComposerInputActions = InputActions

/** The published per-session composer state, including the current draft text. */
export type ComposerInputState = InputState

/** One renderer registration the document preview registry accepts. */
export type { DocumentPreviewDefinition, DocumentLoadMode }
