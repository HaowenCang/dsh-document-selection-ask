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
// `PropsRuntime` plus the `SlotMap`/`GlobalStandardProps`/`SessionStandardProps`
// declaration-merging tables the whole slot contract is composed from.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
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

/** The renderer-owned slot registry the Ask overlay registers into. */
export type { SlotRegistry }

/** Standard props every document body registered under a preview key receives. */
export type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'

/** Props of one occupant of the floating `conversation.input.overlay` list. */
export type ConversationInputOverlayProps = PropsRuntime<'conversation.input.overlay'>

/** The public, stable composer action face: `setDraft`, attachments, `submit`. */
export type ComposerInputActions = InputActions

/** The published per-session composer state, including the current draft text. */
export type ComposerInputState = InputState

/** One renderer registration the document preview registry accepts. */
export type { DocumentPreviewDefinition, DocumentLoadMode }
