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
 * real declaration, and `scripts/link-dsh-deps.mjs` fails the install if any
 * package on this contract graph is missing or is present at a version that
 * does not match the installed DSH. A named import that cannot be resolved
 * would degrade to `any` silently, so the probe annotates what it reads.
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
// `InputActions`, `InputState`, and the `conversation.input.overlay` list slot.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import type { Context } from '@deepseek-ai/cordis'
import type {
  DocumentLoadMode,
  DocumentPreviewDefinition,
} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  InputActions,
  InputState,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The client root context DSH hands to a plugin's browser `apply`. */
export type ClientContext = Context

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
