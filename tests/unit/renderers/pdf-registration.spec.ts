/**
 * Renderer registration contract.
 *
 * Two facts about the registration cannot be seen in a rendered preview and are
 * exactly the ones a release can break: which implementation the DSH
 * document-preview registry ranks first for a `.pdf` path, and whether the
 * builtin renderer still exists beside it. Both are answered here against the
 * installed `@deepseek-ai/dsh-client-ui-sidebar-documentpreview@0.1.5-rc.1`
 * ranking rule rather than against a local restatement of it, because a local
 * restatement would pass while the shell behaved differently.
 *
 * The rc.1 rule, read from the installed bundle's compiled `matchingDocumentPreviews`:
 *
 * ```text
 * rank = definition.priority === 'builtin' ? 0 : 1     // descending
 * then longest matching extension
 * then registration order
 * ```
 *
 * So a definition that is not `builtin` sorts above one that is, whatever order
 * the two were registered in — which is what makes `priority: 'extension'` an
 * automatic selection rather than a preference.
 */

import { describe, expect, it } from 'vitest'

import type { DocumentPreviewDefinition } from '../../../src/client/dsh/contracts.js'
import {
  DOCUMENT_BODY_SLOT,
  pdfRendererDefinition,
  registerPdfRenderer,
} from '../../../src/client/renderers/pdf/register.js'
import { PDF_RENDERER_ID } from '../../../src/client/renderers/pdf/identity.js'

/**
 * The builtin PDF definition, as the installed rc.1 package publishes it.
 *
 * Copied from the installed bundle's `pdfBodyDefinition`, whose source is
 * `{ id: PDF_BODY_ID, extensions: ['pdf'], priority: 'builtin', title, loading:
 * 'bytes-complete', wrap: false }`. The builtin's `title` is locale-owned and
 * irrelevant to ranking, so a fixed string stands in for it.
 */
const BUILTIN_PDF: DocumentPreviewDefinition = {
  id: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf',
  extensions: ['pdf'],
  priority: 'builtin',
  loading: 'bytes-complete',
  wrap: false,
  title: () => 'PDF',
}

/**
 * Rank definitions the way the installed rc.1 registry does.
 *
 * @param definitions - the live registrations, in registration order.
 * @param path - the file path being opened.
 * @returns the matching definitions, best first.
 */
function rank(definitions: readonly DocumentPreviewDefinition[], path: string): readonly DocumentPreviewDefinition[] {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  return definitions
    .map((definition, order) => ({
      definition,
      order,
      rank: definition.priority === 'builtin' ? 0 : 1,
      length: Math.max(
        0,
        ...definition.extensions
          .map((extension) => extension.toLowerCase().replace(/^\./u, ''))
          .filter((extension) => name.endsWith(`.${extension}`))
          .map((extension) => extension.length),
      ),
    }))
    .filter((candidate) => candidate.length > 0)
    .sort((left, right) => right.rank - left.rank || right.length - left.length || left.order - right.order)
    .map((candidate) => candidate.definition)
}

/** What one call to `registerPdfRenderer` recorded. */
interface Recorded {
  readonly definitions: DocumentPreviewDefinition[]
  readonly slotInjections: { slot: string; disposer: unknown }[]
  readonly bodies: { options: Record<string, unknown>; component: unknown }[]
  /**
   * Contributions released by the registration's own disposer, in order.
   *
   * Every contribution is tracked, so "the registration owns all three of them"
   * is a count rather than an intention: a definition or a body that outlived the
   * disposer would leave this list short.
   */
  readonly released: string[]
}

/**
 * A resolved host that records what the renderer contributes.
 *
 * The object is structurally a `RendererRegistrationHost` for the members this
 * registration touches. The real type contract — that the host's `previews`
 * accepts the definition this function builds, and that the keyed slot's
 * `register` accepts the options it passes — is stated in
 * `tests/compatibility/contracts.compile.ts`, which compiles against the
 * installed packages rather than against this stand-in.
 *
 * The host carries no context and no `effect`, which is the point: since Task 12
 * the runtime resolves the services once and the renderer receives them, so a
 * renderer cannot register an effect of its own. A host without a preview registry
 * is refused by the runtime before this function is reached, which
 * `tests/client/renderer-registration.client.spec.tsx` covers.
 *
 * @returns the recorded contributions and the host to pass.
 */
function recordingHost(): { recorded: Recorded; host: never } {
  const recorded: Recorded = {
    definitions: [],
    slotInjections: [],
    bodies: [],
    released: [],
  }

  const host = {
    previews: {
      register(definition: DocumentPreviewDefinition): () => void {
        recorded.definitions.push(definition)
        return () => {
          recorded.released.push(`definition:${definition.id}`)
        }
      },
    },
    slots: {
      inject(slot: string, callback: () => unknown): () => void {
        const disposer: unknown = callback()
        recorded.slotInjections.push({ slot, disposer })
        return () => {
          recorded.released.push(`inject:${slot}`)
          if (typeof disposer === 'function') (disposer as () => void)()
        }
      },
      register(options: Record<string, unknown>, component: unknown): () => void {
        recorded.bodies.push({ options, component })
        return () => {
          recorded.released.push(`body:${String(options['key'])}`)
        }
      },
    },
    document: undefined,
  }

  return { recorded, host: host as never }
}

describe('PDF renderer definition', () => {
  it('declares the exact metadata the document preview registry ranks', () => {
    const definition = pdfRendererDefinition()

    expect(definition.id).toBe(PDF_RENDERER_ID)
    expect(definition.extensions).toEqual(['pdf'])
    expect(definition.priority).toBe('extension')
    expect(definition.loading).toBe('bytes-complete')
    expect(definition.wrap).toBe(false)
    // A thunk, because the registry reads it every time the viewer lists its
    // alternatives and the string must follow the active locale by Task 12.
    expect(typeof definition.title).toBe('function')
    expect(typeof definition.title()).toBe('string')
  })
})

describe('automatic selection for a .pdf path', () => {
  it('ranks the plugin renderer above the builtin one in either registration order', () => {
    const plugin = pdfRendererDefinition()

    const pluginFirst = rank([plugin, BUILTIN_PDF], 'dsh-resource://file/session/s1/paper.pdf')
    const builtinFirst = rank([BUILTIN_PDF, plugin], 'dsh-resource://file/session/s1/paper.pdf')

    expect(pluginFirst[0]?.id).toBe(PDF_RENDERER_ID)
    expect(builtinFirst[0]?.id).toBe(PDF_RENDERER_ID)
  })

  it('keeps the builtin renderer as a live alternative', () => {
    const candidates = rank([BUILTIN_PDF, pdfRendererDefinition()], 'report.pdf')

    expect(candidates).toHaveLength(2)
    expect(candidates.map((candidate) => candidate.id)).toContain(BUILTIN_PDF.id)
  })

  it('does not claim a path that is not a PDF', () => {
    expect(rank([BUILTIN_PDF, pdfRendererDefinition()], 'notes.md')).toHaveLength(0)
  })

  it('loses to nothing on a compound suffix it does not declare', () => {
    // A control for the ranking helper itself: the plugin must not be ranked for
    // a file whose extension merely ends with the letters `pdf`.
    expect(rank([pdfRendererDefinition()], 'report.pdf.txt')).toHaveLength(0)
  })
})

describe('registerPdfRenderer', () => {
  it('registers the definition and the keyed body under the same id', () => {
    const { recorded, host } = recordingHost()
    const dispose = registerPdfRenderer(host)

    expect(typeof dispose).toBe('function')
    expect(recorded.definitions).toHaveLength(1)
    expect(recorded.definitions[0]?.id).toBe(PDF_RENDERER_ID)

    expect(recorded.slotInjections).toHaveLength(1)
    expect(recorded.slotInjections[0]?.slot).toBe(DOCUMENT_BODY_SLOT)
    expect(typeof recorded.slotInjections[0]?.disposer).toBe('function')

    expect(recorded.bodies).toHaveLength(1)
    expect(recorded.bodies[0]?.options['name']).toBe(DOCUMENT_BODY_SLOT)
    // The body is looked up by the definition's own id, so the two strings must
    // be the same one rather than two that currently agree.
    expect(recorded.bodies[0]?.options['key']).toBe(recorded.definitions[0]?.id)
    expect(typeof recorded.bodies[0]?.component).toBe('function')
  })

  it('owns every contribution through one disposer', () => {
    const { recorded, host } = recordingHost()

    const dispose = registerPdfRenderer(host)
    expect(recorded.released).toEqual([])

    dispose()

    // The definition and the body are both released, and in registration order.
    expect(recorded.released).toContain(`definition:${PDF_RENDERER_ID}`)
    expect(recorded.released).toContain(`body:${PDF_RENDERER_ID}`)
    // A style sheet is only installed when the host has a document; this host has
    // none, because the unit environment is Node. The jsdom case below observes
    // that installation.
    expect(recorded.released).toHaveLength(3)
  })

  it('releases twice without releasing anything twice', () => {
    const { recorded, host } = recordingHost()
    const dispose = registerPdfRenderer(host)

    dispose()
    const afterFirst = [...recorded.released]
    dispose()

    expect(recorded.released).toEqual(afterFirst)
  })

  it('needs no context and therefore registers no effect of its own', () => {
    // The gate the runtime's one-effect contract depends on: a registration that
    // took a context would be free to call `ctx.effect`, and the plugin's
    // top-level effect count would then grow with the number of renderers.
    const { host } = recordingHost()

    expect(() => {
      registerPdfRenderer(host)
    }).not.toThrow()
  })

  it('releases what it installed when a later step of its own throws', () => {
    const recorded: Recorded = { definitions: [], slotInjections: [], bodies: [], released: [] }
    const host = {
      previews: {
        register(definition: DocumentPreviewDefinition): () => void {
          recorded.definitions.push(definition)
          return () => {
            recorded.released.push(`definition:${definition.id}`)
          }
        },
      },
      slots: {
        inject(): () => void {
          throw new Error('the document body slot is not declared')
        },
        register(): () => void {
          return () => undefined
        },
      },
      document: undefined,
    }

    expect(() => registerPdfRenderer(host as never)).toThrow('the document body slot is not declared')

    // The definition was registered before the slot failed, and the registration's
    // own rollback released it: no renderer definition outlives a body that was
    // never contributed.
    expect(recorded.released).toEqual([`definition:${PDF_RENDERER_ID}`])
  })
})
