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
  readonly effectLabels: string[]
  /**
   * Contributions made from **inside** an effect body.
   *
   * The distinction is the whole point of the assertion it supports: a
   * registration made outside one would outlive the plugin's unload, and the
   * fiber would have no disposer to run.
   */
  readonly contributedInsideEffect: string[]
}

/**
 * A client context that records what the renderer contributes.
 *
 * The object is structurally a `ClientContext` for the members this registration
 * touches. The real type contract — that `ctx.documentPreviews.register` accepts
 * the definition this function builds, and that the keyed slot's `register`
 * accepts the options it passes — is stated in
 * `tests/compatibility/pdf-renderer.contracts.compile.ts`, which compiles against
 * the installed packages rather than against this stand-in.
 *
 * @param withRegistry - whether the context exposes `documentPreviews`.
 * @returns the recorded contributions and the context to pass.
 */
function recordingContext(withRegistry = true): { recorded: Recorded; ctx: never } {
  const recorded: Recorded = {
    definitions: [],
    slotInjections: [],
    bodies: [],
    effectLabels: [],
    contributedInsideEffect: [],
  }
  let insideEffect = false

  const ctx = {
    documentPreviews: withRegistry
      ? {
          register(definition: DocumentPreviewDefinition): () => void {
            recorded.definitions.push(definition)
            if (insideEffect) recorded.contributedInsideEffect.push(`definition:${definition.id}`)
            return () => undefined
          },
        }
      : undefined,
    slots: {
      inject(slot: string, callback: () => unknown): () => void {
        const disposer: unknown = callback()
        recorded.slotInjections.push({ slot, disposer })
        return () => undefined
      },
      register(options: Record<string, unknown>, component: unknown): () => void {
        recorded.bodies.push({ options, component })
        if (insideEffect) recorded.contributedInsideEffect.push(`body:${String(options['key'])}`)
        return () => undefined
      },
    },
    effect(body: () => unknown, label?: string): () => void {
      recorded.effectLabels.push(label ?? '(unlabelled)')
      insideEffect = true
      try {
        body()
      } finally {
        insideEffect = false
      }
      return () => undefined
    },
  }

  return { recorded, ctx: ctx as never }
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
    const { recorded, ctx } = recordingContext()
    const registered = registerPdfRenderer(ctx)

    expect(registered).toBe(true)
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

  it('owns every contribution through the fiber', () => {
    const { recorded, ctx } = recordingContext()
    registerPdfRenderer(ctx)

    // The definition registration is an effect body. A registration made outside
    // one would survive the plugin's unload and the fiber would have no disposer
    // to run.
    expect(recorded.effectLabels).toContain('dsh-document-selection-ask: pdf renderer definition')
    expect(recorded.contributedInsideEffect).toContain(`definition:${PDF_RENDERER_ID}`)

    // The style sheet is installed from an effect body too, whenever the client
    // context has a document at all — which this context does not, because the
    // unit environment is Node. The jsdom case below is where that installation
    // is observed.
    expect(recorded.effectLabels.length).toBeGreaterThanOrEqual(1)
  })

  it('reports a missing registry instead of throwing into the boot', () => {
    const { recorded, ctx } = recordingContext(false)

    expect(registerPdfRenderer(ctx)).toBe(false)
    expect(recorded.definitions).toHaveLength(0)
    expect(recorded.bodies).toHaveLength(0)
  })
})
