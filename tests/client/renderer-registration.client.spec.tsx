// @vitest-environment jsdom
/**
 * One registration owner for the whole client runtime.
 *
 * Before Task 12 the plugin's contributions were owned five different ways: each
 * adapter was wrapped in its own `ctx.effect`, each renderer registered its
 * definition and its style sheet through further effects, and the two Ask slot
 * contributions were made with the disposer `slots.inject` returned thrown away.
 * A teardown therefore released most of the runtime and leaked the slot entries,
 * and nothing in the repository could see it: the effect labels were asserted one
 * renderer at a time, never against the runtime that owns them.
 *
 * This suite states the contract that replaced it, against a context shaped like
 * the one the DSH web boot hands `apply`:
 *
 * - one `apply` registers exactly one top-level effect, and that effect owns one
 *   runtime with one idempotent `dispose`;
 * - the four extension renderers are the only renderer definitions, in the exact
 *   metadata the document-preview registry ranks;
 * - the five adapters are registered in the frozen priority order;
 * - the builtin definitions seeded before the plugin are neither removed nor
 *   replaced;
 * - serial apply/dispose cycles leave no definition, slot entry, listener or
 *   style node behind, and a second cycle installs exactly one set again;
 * - a registration that fails halfway releases everything registered before it
 *   and rethrows the original failure;
 * - a throwing child disposer does not stop the sweep.
 *
 * The fake registry models the two rules the real one publishes — a disposer that
 * removes exactly the entry it created, and a duplicate live implementation name
 * throwing — because a fake that accepted duplicates would let the leak this
 * suite exists for pass.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DSH_TEXT_ADAPTER_ID } from '../../src/client/adapters/dsh-text/adapter.js'
import { PDF_SELECTION_ADAPTER_ID } from '../../src/client/adapters/pdf/adapter.js'
import type { ClientContext, DocumentPreviewDefinition } from '../../src/client/dsh/contracts.js'
import {
  ASK_SURFACE_ENTRY_ID,
  ASK_SURFACE_SLOT,
  COMPOSER_TARGET_ENTRY_ID,
  COMPOSER_TARGET_SLOT,
  applyClient,
} from '../../src/client/dsh/register.js'
import { apply } from '../../src/client/index.js'
import { DOCX_RENDERER_ID, DOCX_SELECTION_ADAPTER_ID } from '../../src/client/renderers/docx/identity.js'
import { DOCUMENT_BODY_SLOT } from '../../src/client/renderers/pdf/register.js'
import { PDF_RENDERER_ID } from '../../src/client/renderers/pdf/identity.js'
import { PPTX_RENDERER_ID, PPTX_SELECTION_ADAPTER_ID } from '../../src/client/renderers/pptx/identity.js'
import { XLSX_RENDERER_ID, XLSX_SELECTION_ADAPTER_ID } from '../../src/client/renderers/xlsx/identity.js'
import { SelectionAdapterRegistry } from '../../src/client/selection/registry.js'

/** The plugin's four extension renderer ids, in registration order. */
const RENDERER_IDS = [XLSX_RENDERER_ID, PDF_RENDERER_ID, DOCX_RENDERER_ID, PPTX_RENDERER_ID]

/** The plugin's five adapter ids, in the frozen priority order. */
const ADAPTER_IDS = [
  XLSX_SELECTION_ADAPTER_ID,
  PDF_SELECTION_ADAPTER_ID,
  DOCX_SELECTION_ADAPTER_ID,
  PPTX_SELECTION_ADAPTER_ID,
  DSH_TEXT_ADAPTER_ID,
]

/** Extensions the builtin text previews own; a replacement for one would break them. */
const BUILTIN_TEXT_EXTENSIONS = ['txt', 'text', 'md', 'markdown', 'csv', 'json', 'ts', 'js', 'yml', 'yaml']

/**
 * The builtin PDF definition, as the installed rc.1 package publishes it.
 *
 * Seeded before the plugin, so "the plugin does not disturb a foreign
 * registration" is asserted against an entry that was already live rather than
 * against one the plugin itself created.
 */
const BUILTIN_PDF: DocumentPreviewDefinition = {
  id: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf',
  extensions: ['pdf'],
  priority: 'builtin',
  loading: 'bytes-complete',
  wrap: false,
  title: () => 'PDF',
}

/** One live renderer-definition registration. */
interface PreviewEntry {
  readonly definition: DocumentPreviewDefinition
  live: boolean
  disposals: number
}

/** One live slot contribution. */
interface SlotEntry {
  readonly slot: string
  readonly key: string | undefined
  readonly id: string | undefined
  readonly component: unknown
  live: boolean
  disposals: number
}

/** What one fake context records, and what it can be made to fail on. */
interface FakeHost {
  readonly ctx: ClientContext
  readonly previews: PreviewEntry[]
  readonly slots: SlotEntry[]
  /** Labels of the effects the plugin asked the fiber to own. */
  readonly effectLabels: string[]
  /** Run every effect disposer the fiber collected, as unloading the plugin does. */
  unloadFiber(): void
  /** Ids of the live preview registrations, in registration order. */
  livePreviewIds(): string[]
  /** `slot` or `slot#key` of every live slot contribution, in registration order. */
  liveSlotKeys(): string[]
  /** Style nodes this plugin installed. */
  styleTags(): number
}

/** Faults a case can inject into the fake context. */
interface HostOptions {
  /** Register this builtin definition before the plugin is applied. */
  readonly seedBuiltinPdf?: boolean
  /** Throw when a definition with this id registers. */
  readonly failPreviewId?: string
  /** Throw when a contribution to this slot registers. */
  readonly failSlotName?: string
  /** Make the disposer of this slot's contribution throw once. */
  readonly throwingSlotName?: string
  /** Omit the document-preview service, as a host without it would. */
  readonly withoutPreviews?: boolean
}

/**
 * Build the fake host.
 *
 * @param options - the seeded builtin and any injected fault.
 * @returns the recorded contributions and the context to apply.
 */
function fakeHost(options: HostOptions = {}): FakeHost {
  const previews: PreviewEntry[] = []
  const slots: SlotEntry[] = []
  const effectLabels: string[] = []
  const fiberDisposers: (() => void)[] = []

  if (options.seedBuiltinPdf === true) {
    previews.push({ definition: BUILTIN_PDF, live: true, disposals: 0 })
  }

  /**
   * Register one entry and hand back its own idempotent disposer.
   * @param entry - the entry to track.
   * @param faults - whether this registration throws, and whether its disposer throws.
   * @returns the disposer the registry would return.
   */
  function own(
    entry: { live: boolean; disposals: number },
    faults: { readonly fail: boolean; readonly throwing: boolean },
  ): () => void {
    if (faults.fail) {
      throw new Error('injected registration failure')
    }
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      entry.live = false
      entry.disposals += 1
      if (faults.throwing) {
        throw new Error('injected cleanup failure')
      }
    }
  }

  const ctx = {
    ...(options.withoutPreviews === true
      ? {}
      : {
          documentPreviews: {
            register(definition: DocumentPreviewDefinition): () => void {
              if (previews.some((entry) => entry.live && entry.definition.id === definition.id)) {
                throw new Error(`duplicate document preview id: ${definition.id}`)
              }
              const entry: PreviewEntry = { definition, live: true, disposals: 0 }
              const dispose = own(entry, { fail: definition.id === options.failPreviewId, throwing: false })
              previews.push(entry)
              return dispose
            },
          },
        }),
    slots: {
      inject(slot: string, callback: () => () => void): () => void {
        const dispose = callback()
        return () => {
          dispose()
        }
      },
      register(
        entry: { readonly name: string; readonly key?: string; readonly id?: string },
        component: unknown,
      ): () => void {
        const record: SlotEntry = {
          slot: entry.name,
          key: entry.key,
          id: entry.id,
          component,
          live: true,
          disposals: 0,
        }
        const dispose = own(record, {
          fail: entry.name === options.failSlotName,
          throwing: entry.name === options.throwingSlotName,
        })
        slots.push(record)
        return dispose
      },
    },
    effect(body: () => unknown, label?: string): () => void {
      effectLabels.push(label ?? '(unlabelled)')
      const produced = body()
      const dispose = typeof produced === 'function' ? (produced as () => void) : () => undefined
      fiberDisposers.push(dispose)
      return dispose
    },
  }

  return {
    ctx: ctx as unknown as ClientContext,
    previews,
    slots,
    effectLabels,
    unloadFiber(): void {
      for (const dispose of fiberDisposers.splice(0)) {
        dispose()
      }
    },
    livePreviewIds(): string[] {
      return previews.filter((entry) => entry.live).map((entry) => entry.definition.id)
    },
    liveSlotKeys(): string[] {
      return slots
        .filter((entry) => entry.live)
        .map((entry) => {
          const identity = entry.key ?? entry.id
          return identity === undefined ? entry.slot : `${entry.slot}#${identity}`
        })
    },
    styleTags(): number {
      return document.querySelectorAll('style[data-plugin-css]').length
    },
  }
}

beforeEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('one top-level effect per apply', () => {
  it('registers exactly one plugin-owned effect, labelled as the client runtime', () => {
    const host = fakeHost()

    apply(host.ctx)

    expect(host.effectLabels).toEqual(['dsh-document-selection-ask: client runtime'])
  })

  it('owns the runtime through that effect, so unloading the fiber releases it', () => {
    const host = fakeHost()
    apply(host.ctx)
    expect(host.livePreviewIds()).toHaveLength(4)

    host.unloadFiber()

    expect(host.livePreviewIds()).toEqual([])
    expect(host.liveSlotKeys()).toEqual([])
    expect(host.styleTags()).toBe(0)
  })

  it('keeps every nested contribution out of its own effect', () => {
    // The auxiliary source gate: behaviour is the primary evidence, and this is
    // what catches a new contribution added later with its own `ctx.effect`.
    const clientRoot = join(process.cwd(), 'src', 'client')
    const files: string[] = []
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.tsx?$/u.test(entry.name)) files.push(path)
      }
    }
    walk(clientRoot)

    const offenders = files.filter((path) => readFileSync(path, 'utf8').includes('ctx.effect('))

    expect(files.length).toBeGreaterThan(10)
    expect(offenders.map((path) => path.replaceAll('\\', '/').split('/src/client/')[1])).toEqual([
      'index.tsx',
    ])
    const entryPath = files.find((path) => path.endsWith('index.tsx'))
    expect(entryPath).toBeDefined()
    const entry = readFileSync(entryPath ?? '', 'utf8')
    expect(entry.match(/ctx\.effect\(/gu)).toHaveLength(1)
  })
})

describe('renderer definitions', () => {
  it('registers exactly four extension renderers with the frozen metadata', () => {
    const host = fakeHost()

    applyClient(host.ctx)

    const definitions = host.previews.map((entry) => entry.definition)
    expect(definitions.map((definition) => definition.id)).toEqual(RENDERER_IDS)
    for (const definition of definitions) {
      expect(definition.priority).toBe('extension')
      expect(definition.loading).toBe('bytes-complete')
      expect(definition.wrap).toBe(false)
      expect(typeof definition.title).toBe('function')
    }
    expect(definitions.map((definition) => definition.extensions)).toEqual([
      ['xlsx'],
      ['pdf'],
      ['docx'],
      ['pptx'],
    ])
  })

  it('registers no replacement renderer for a builtin text class', () => {
    const host = fakeHost()

    applyClient(host.ctx)

    const claimed = host.previews.flatMap((entry) => entry.definition.extensions)
    for (const extension of BUILTIN_TEXT_EXTENSIONS) {
      expect(claimed).not.toContain(extension)
    }
  })

  it('contributes one keyed body per renderer under the definition id', () => {
    const host = fakeHost()

    applyClient(host.ctx)

    for (const id of RENDERER_IDS) {
      expect(host.liveSlotKeys()).toContain(`${DOCUMENT_BODY_SLOT}#${id}`)
    }
  })

  it('contributes the Ask surface and the composer target registrar', () => {
    const host = fakeHost()

    applyClient(host.ctx)

    expect(host.liveSlotKeys()).toContain(`${ASK_SURFACE_SLOT}#${ASK_SURFACE_ENTRY_ID}`)
    expect(host.liveSlotKeys()).toContain(`${COMPOSER_TARGET_SLOT}#${COMPOSER_TARGET_ENTRY_ID}`)
  })
})

describe('adapter priority', () => {
  it('registers the five adapters in the frozen order', () => {
    const host = fakeHost()
    const registerSpy = vi.spyOn(SelectionAdapterRegistry.prototype, 'register')

    try {
      applyClient(host.ctx)

      expect(registerSpy.mock.calls.map((call) => call[0].id)).toEqual(ADAPTER_IDS)
    } finally {
      registerSpy.mockRestore()
    }
  })
})

describe('builtin retention', () => {
  it('adds the plugin definitions beside the builtin one', () => {
    const host = fakeHost({ seedBuiltinPdf: true })

    const runtime = applyClient(host.ctx)

    expect(host.livePreviewIds()).toEqual([BUILTIN_PDF.id, ...RENDERER_IDS])
    // The same object, not a re-registered equivalent: a plugin that replaced the
    // entry would pass an id comparison and still be a regression.
    expect(host.previews[0]?.definition).toBe(BUILTIN_PDF)
    expect(runtime.dispose).toBeTypeOf('function')
  })

  it('removes only its own definitions on dispose', () => {
    const host = fakeHost({ seedBuiltinPdf: true })
    const runtime = applyClient(host.ctx)

    runtime.dispose()

    expect(host.livePreviewIds()).toEqual([BUILTIN_PDF.id])
    expect(host.previews[0]?.definition).toBe(BUILTIN_PDF)
    expect(host.previews[0]?.live).toBe(true)
    // A teardown that disposed a registration it did not make would show here.
    expect(host.previews.filter((entry) => entry.disposals > 0)).toHaveLength(4)
  })
})

describe('apply and dispose cycles', () => {
  it('leaves nothing behind after a cycle and installs exactly one set on the next', () => {
    const host = fakeHost({ seedBuiltinPdf: true })

    const first = applyClient(host.ctx)
    const firstCounts = {
      previews: host.livePreviewIds().length,
      slots: host.liveSlotKeys().length,
      styles: host.styleTags(),
    }
    expect(firstCounts).toEqual({ previews: 5, slots: 6, styles: 5 })

    first.dispose()
    expect({
      previews: host.livePreviewIds(),
      slots: host.liveSlotKeys(),
      styles: host.styleTags(),
    }).toEqual({ previews: [BUILTIN_PDF.id], slots: [], styles: 0 })

    const second = applyClient(host.ctx)
    expect({
      previews: host.livePreviewIds().length,
      slots: host.liveSlotKeys().length,
      styles: host.styleTags(),
    }).toEqual(firstCounts)
    expect(host.livePreviewIds()).toEqual([BUILTIN_PDF.id, ...RENDERER_IDS])
    expect(new Set(host.liveSlotKeys()).size).toBe(host.liveSlotKeys().length)

    second.dispose()
    expect(host.livePreviewIds()).toEqual([BUILTIN_PDF.id])
    expect(host.liveSlotKeys()).toEqual([])
    expect(host.styleTags()).toBe(0)
  })

  it('disposes every registration exactly once, and a second dispose is a no-op', () => {
    const host = fakeHost()
    const runtime = applyClient(host.ctx)

    runtime.dispose()
    runtime.dispose()
    host.unloadFiber()

    expect(host.previews.map((entry) => entry.disposals)).toEqual([1, 1, 1, 1])
    expect(host.slots.map((entry) => entry.disposals)).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('fails the second apply on the registry rule when the first was not disposed', () => {
    const host = fakeHost()
    const first = applyClient(host.ctx)

    expect(() => applyClient(host.ctx)).toThrow(/duplicate document preview id/u)

    // The failed second apply released everything it had registered and left the
    // first runtime's registrations exactly as they were.
    expect(host.livePreviewIds()).toEqual(RENDERER_IDS)
    expect(new Set(host.liveSlotKeys()).size).toBe(host.liveSlotKeys().length)
    first.dispose()
    expect(host.livePreviewIds()).toEqual([])
  })

  it('keeps two client runtimes independent', () => {
    const first = fakeHost()
    const second = fakeHost()

    const firstRuntime = applyClient(first.ctx)
    const secondRuntime = applyClient(second.ctx)

    firstRuntime.dispose()

    expect(second.livePreviewIds()).toEqual(RENDERER_IDS)
    expect(secondRuntime.registry).not.toBe(firstRuntime.registry)
    expect(secondRuntime.kernel).not.toBe(firstRuntime.kernel)
    expect(secondRuntime.kernel.getSnapshot()).toBeNull()

    secondRuntime.dispose()
  })
})

describe('registration failure', () => {
  it('releases everything registered before the failure and rethrows the original error', () => {
    const host = fakeHost({ failPreviewId: PDF_RENDERER_ID })

    expect(() => applyClient(host.ctx)).toThrow('injected registration failure')

    // Nothing partial: no definition, no slot entry, no style node.
    expect(host.livePreviewIds()).toEqual([])
    expect(host.liveSlotKeys()).toEqual([])
    expect(host.styleTags()).toBe(0)
    // And the registrations that succeeded before the failure were released
    // rather than left for a runtime that was never returned.
    expect(host.previews.map((entry) => entry.live)).toEqual([false])
    expect(host.previews[0]?.disposals).toBe(1)
  })

  it('releases the adapters it registered before the failure', () => {
    const host = fakeHost({ failPreviewId: PDF_RENDERER_ID })
    const registerSpy = vi.spyOn(SelectionAdapterRegistry.prototype, 'register')
    let registry: SelectionAdapterRegistry | undefined

    try {
      expect(() => {
        applyClient(host.ctx)
      }).toThrow('injected registration failure')

      expect(registerSpy).toHaveBeenCalledTimes(ADAPTER_IDS.length)
      registry = registerSpy.mock.instances[0] as SelectionAdapterRegistry | undefined
    } finally {
      registerSpy.mockRestore()
    }

    expect(registry).toBeDefined()
    // The five adapter registrations were made before the renderer that failed, in
    // a registry no caller can reach because the runtime was never returned. Each
    // id being registrable again is what shows the aggregator released them.
    for (const id of ADAPTER_IDS) {
      expect(() => {
        registry?.register({
          id,
          canHandle: () => false,
          capture: () => ({ snapshot: null, rejectReason: null }),
        })
      }).not.toThrow()
    }
  })

  it('releases the slot contributions made before the failure', () => {
    const host = fakeHost({ failSlotName: DOCUMENT_BODY_SLOT })

    expect(() => applyClient(host.ctx)).toThrow('injected registration failure')

    expect(host.liveSlotKeys()).toEqual([])
    expect(host.slots.every((entry) => entry.disposals <= 1)).toBe(true)
    expect(host.livePreviewIds()).toEqual([])
    expect(host.styleTags()).toBe(0)
  })

  it('keeps the registration failure primary when cleanup also fails', () => {
    const host = fakeHost({ failPreviewId: PDF_RENDERER_ID, throwingSlotName: ASK_SURFACE_SLOT })

    let thrown: unknown
    try {
      applyClient(host.ctx)
    } catch (error: unknown) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AggregateError)
    const aggregate = thrown as AggregateError
    expect(aggregate.errors[0]).toMatchObject({ message: 'injected registration failure' })
    expect(aggregate.cause).toMatchObject({ message: 'injected registration failure' })
    // The sweep still ran: the ask surface, the composer target and the XLSX
    // renderer were all released even though one of them threw.
    expect(host.liveSlotKeys()).toEqual([])
    expect(host.livePreviewIds()).toEqual([])
  })

  it('continues the sweep when a child disposer throws on an ordinary dispose', () => {
    const host = fakeHost({ throwingSlotName: ASK_SURFACE_SLOT })
    const runtime = applyClient(host.ctx)

    expect(() => {
      runtime.dispose()
    }).toThrow('injected cleanup failure')

    expect(host.livePreviewIds()).toEqual([])
    expect(host.liveSlotKeys()).toEqual([])
    expect(host.styleTags()).toBe(0)
    // The failure does not make the runtime disposable twice.
    expect(() => {
      runtime.dispose()
    }).not.toThrow()
  })
})

describe('required services', () => {
  it('throws instead of half-installing when the preview registry is absent', () => {
    const host = fakeHost({ withoutPreviews: true })

    expect(() => applyClient(host.ctx)).toThrow(/document preview registry/u)
    expect(host.liveSlotKeys()).toEqual([])
    expect(host.styleTags()).toBe(0)
  })

  it('does not register a single definition before the services are validated', () => {
    const host = fakeHost({ withoutPreviews: true })

    expect(() => applyClient(host.ctx)).toThrow()
    expect(host.previews).toEqual([])
  })
})
