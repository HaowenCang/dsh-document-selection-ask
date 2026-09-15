/**
 * Selection kernel: transient state and notification.
 *
 * The kernel is the only component that holds a captured selection across time,
 * which makes two of its properties observable by the user rather than
 * internal. A stale snapshot must not survive a capture that produced no
 * selection, or the Ask overlay would offer to quote text the reader has
 * already deselected. And a listener that throws must not leave the kernel
 * holding a different answer from the one it just published, because the
 * listeners are the UI layer and an exception there is a rendering defect, not
 * a state transition.
 *
 * The specs drive the kernel through a real {@link SelectionAdapterRegistry}
 * with scripted adapters rather than a mock, so the boundary the kernel
 * actually consumes is the one under test.
 */

import { describe, expect, it } from 'vitest'

import { createSelectionKernel } from '../../../src/client/selection/kernel.js'
import { Disposer, disposeAll } from '../../../src/client/selection/lifecycle.js'
import { SelectionAdapterRegistry } from '../../../src/client/selection/registry.js'
import type { SelectionAdapter, SelectionCapture, SelectionContext } from '../../../src/client/selection/registry.js'
import type { SelectionRejectReason, SelectionSnapshot } from '../../../src/client/selection/types.js'
import { snapshot } from '../selection/snapshot.js'

const context: SelectionContext = { selection: null, target: null, now: 1_700_000_000_000 }

/** A capture result with `snapshot` populated. */
function accepted(text = 'alpha beta'): SelectionCapture {
  return { snapshot: snapshot({ text }), rejectReason: null }
}

/** A capture result with `rejectReason` populated. */
function refused(reason: SelectionRejectReason): SelectionCapture {
  return { snapshot: null, rejectReason: reason }
}

/**
 * Build a registry with one adapter that claims every context and returns
 * whatever the supplied producer currently yields.
 * @param produce - called once per capture.
 * @returns a registry whose single adapter owns every context.
 */
function registryCapturing(produce: () => SelectionCapture): SelectionAdapterRegistry {
  const registry = new SelectionAdapterRegistry()
  const adapter: SelectionAdapter = {
    id: 'scripted',
    canHandle: () => true,
    capture: produce,
  }
  registry.register(adapter)
  return registry
}

/**
 * Build a registry whose only adapter declines every context.
 * @returns a registry with no reachable owner.
 */
function registryDeclining(): SelectionAdapterRegistry {
  const registry = new SelectionAdapterRegistry()
  const adapter: SelectionAdapter = {
    id: 'declining',
    canHandle: () => false,
    capture: () => refused('cross-root'),
  }
  registry.register(adapter)
  return registry
}

describe('SelectionKernel capture', () => {
  it('returns the registry verdict unchanged', () => {
    const capture = accepted()
    const kernel = createSelectionKernel(registryCapturing(() => capture))

    expect(kernel.capture(context)).toBe(capture)
  })

  it('starts with no snapshot', () => {
    const kernel = createSelectionKernel(new SelectionAdapterRegistry())

    expect(kernel.getSnapshot()).toBeNull()
  })

  it('stores the exact snapshot object the adapter produced', () => {
    // The kernel must not rewrite or re-wrap the snapshot: the adapter is the
    // component that knows the format, and a copy taken here could drop a
    // provenance field without any test noticing.
    const captured = snapshot({ text: 'alpha', location: { kind: 'document' } })
    const kernel = createSelectionKernel(registryCapturing(() => ({ snapshot: captured, rejectReason: null })))

    kernel.capture(context)

    expect(kernel.getSnapshot()).toBe(captured)
    expect(kernel.getSnapshot()?.location).toEqual({ kind: 'document' })
  })

  it('surfaces a rejection reason instead of swallowing it', () => {
    const kernel = createSelectionKernel(registryCapturing(() => refused('too-large')))

    const result = kernel.capture(context)

    expect(result.rejectReason).toBe('too-large')
    expect(kernel.getSnapshot()).toBeNull()
  })

  it('replaces the stored snapshot with the newest capture', () => {
    const texts = ['first', 'second']
    let index = 0
    const kernel = createSelectionKernel(
      registryCapturing(() => accepted(texts[index++] ?? 'exhausted')),
    )

    kernel.capture(context)
    kernel.capture(context)

    expect(kernel.getSnapshot()?.text).toBe('second')
  })
})

describe('SelectionKernel stale state', () => {
  it('clears a stored snapshot when the next capture is rejected', () => {
    let next = accepted()
    const kernel = createSelectionKernel(registryCapturing(() => next))

    kernel.capture(context)
    expect(kernel.getSnapshot()).not.toBeNull()

    next = refused('collapsed')
    kernel.capture(context)

    // The reader deselected: the overlay must not be able to quote the text
    // that was selected a moment ago.
    expect(kernel.getSnapshot()).toBeNull()
  })

  it('clears a stored snapshot when the next context belongs to no adapter', () => {
    let owned = true
    const registry = new SelectionAdapterRegistry()
    registry.register({
      id: 'scripted',
      canHandle: () => owned,
      capture: () => accepted(),
    })
    const kernel = createSelectionKernel(registry)
    kernel.capture(context)
    expect(kernel.getSnapshot()).not.toBeNull()

    // The owning adapter is gone, so the same context is now unclaimed.
    owned = false

    expect(kernel.capture(context).rejectReason).toBe('outside-supported-preview')
    expect(kernel.getSnapshot()).toBeNull()
  })

  it('holds no snapshot when nothing was ever captured from a declining registry', () => {
    const kernel = createSelectionKernel(registryDeclining())

    kernel.capture(context)

    expect(kernel.getSnapshot()).toBeNull()
  })
})

describe('SelectionKernel clear', () => {
  it('removes the stored snapshot', () => {
    const kernel = createSelectionKernel(registryCapturing(() => accepted()))
    kernel.capture(context)

    kernel.clear()

    expect(kernel.getSnapshot()).toBeNull()
  })

  it('is idempotent and silent on an empty kernel', () => {
    const kernel = createSelectionKernel(new SelectionAdapterRegistry())
    let count = 0
    kernel.subscribe(() => {
      count += 1
    })

    expect(() => {
      kernel.clear()
      kernel.clear()
    }).not.toThrow()
    expect(kernel.getSnapshot()).toBeNull()
    expect(count).toBe(0)
  })

  it('notifies once when it actually removes a snapshot', () => {
    const kernel = createSelectionKernel(registryCapturing(() => accepted()))
    kernel.capture(context)
    let count = 0
    kernel.subscribe(() => {
      count += 1
    })

    kernel.clear()
    kernel.clear()

    expect(count).toBe(1)
  })
})

describe('SelectionKernel subscription', () => {
  it('notifies subscribers when a capture stores a snapshot', () => {
    const kernel = createSelectionKernel(registryCapturing(() => accepted()))
    let count = 0
    kernel.subscribe(() => {
      count += 1
    })

    kernel.capture(context)

    expect(count).toBe(1)
  })

  it('notifies subscribers when a rejection clears a snapshot', () => {
    let next = accepted()
    const kernel = createSelectionKernel(registryCapturing(() => next))
    kernel.capture(context)
    let count = 0
    kernel.subscribe(() => {
      count += 1
    })

    next = refused('collapsed')
    kernel.capture(context)

    expect(count).toBe(1)
  })

  it('does not notify when a rejection changes nothing', () => {
    const kernel = createSelectionKernel(registryCapturing(() => refused('collapsed')))
    let count = 0
    kernel.subscribe(() => {
      count += 1
    })

    kernel.capture(context)
    kernel.capture(context)

    // Silence is the correct behaviour for "there is still no selection": the
    // overlay has nothing to redraw.
    expect(count).toBe(0)
  })

  it('stops notifying a disposed listener and tolerates repeated disposal', () => {
    const kernel = createSelectionKernel(registryCapturing(() => accepted()))
    let count = 0
    const dispose = kernel.subscribe(() => {
      count += 1
    })

    dispose()
    dispose()
    kernel.capture(context)

    expect(count).toBe(0)
  })

  it('reaches every live listener and skips the disposed one', () => {
    const kernel = createSelectionKernel(registryCapturing(() => accepted()))
    const order: string[] = []
    const disposeFirst = kernel.subscribe(() => order.push('first'))
    kernel.subscribe(() => order.push('second'))

    disposeFirst()
    kernel.capture(context)

    expect(order).toEqual(['second'])
  })

  it('notifies each listener once per real state change', () => {
    let next = accepted()
    const kernel = createSelectionKernel(registryCapturing(() => next))
    let count = 0
    kernel.subscribe(() => {
      count += 1
    })

    kernel.capture(context)
    next = refused('collapsed')
    kernel.capture(context)
    kernel.clear()

    // Two real transitions, and nothing for the redundant clear.
    expect(count).toBe(2)
  })

  it('keeps state consistent when a listener throws', () => {
    const captured = snapshot({ text: 'alpha beta' })
    const kernel = createSelectionKernel(registryCapturing(() => ({ snapshot: captured, rejectReason: null })))
    kernel.subscribe(() => {
      throw new Error('listener failed')
    })

    // The exception is the listener's, and it propagates; what must not happen
    // is a kernel left holding a previous or partial answer.
    expect(() => {
      kernel.capture(context)
    }).toThrow('listener failed')
    expect(kernel.getSnapshot()).toBe(captured)
  })
})

describe('SelectionKernel isolation', () => {
  it('does not share state between kernels built on the same registry', () => {
    const registry = registryCapturing(() => accepted('alpha'))
    const first = createSelectionKernel(registry)
    const second = createSelectionKernel(registry)

    first.capture(context)

    expect(first.getSnapshot()?.text).toBe('alpha')
    expect(second.getSnapshot()).toBeNull()
  })
})

describe('Disposer', () => {
  it('registers adapters and subscriptions so one teardown releases both', () => {
    const registry = new SelectionAdapterRegistry()
    const kernel = createSelectionKernel(registry)
    const disposer = new Disposer()
    const released: string[] = []

    disposer.add(
      registry.register({
        id: 'scripted',
        canHandle: () => true,
        capture: () => accepted(),
      }),
    )
    disposer.add(kernel.subscribe(() => released.push('notified')))

    kernel.capture(context)
    disposer.disposeAll()
    kernel.capture(context)

    expect(released).toEqual(['notified'])
    // The adapter is gone as well: a later capture from a new kernel over the
    // same registry finds no owner.
    expect(createSelectionKernel(registry).capture(context).rejectReason).toBe('outside-supported-preview')
  })

  it('runs each disposer exactly once, in the order it was added', () => {
    const disposer = new Disposer()
    const order: string[] = []
    disposer.add(() => order.push('first'))
    disposer.add(() => order.push('second'))

    disposer.disposeAll()
    disposer.disposeAll()

    expect(order).toEqual(['first', 'second'])
  })

  it('releases a disposer added after the aggregator has run', () => {
    const disposer = new Disposer()
    const order: string[] = []
    disposer.disposeAll()

    disposer.add(() => order.push('late'))
    disposer.disposeAll()

    // Nothing may be left for a teardown that has already happened.
    expect(order).toEqual(['late'])
  })

  it('propagates a throwing disposer and marks the aggregation released', () => {
    const disposer = new Disposer()
    const released: string[] = []
    disposer.add(() => {
      throw new Error('teardown failed')
    })
    disposer.add(() => released.push('second'))

    // The exception is the disposer's own and it propagates rather than being
    // swallowed, matching how the kernel treats a throwing listener.
    expect(() => {
      disposer.disposeAll()
    }).toThrow('teardown failed')

    // The aggregation is still released, so a retry cannot run any of it a
    // second time. The task's contract is "idempotent and ordered"; a teardown
    // that survives a throwing step needs per-step isolation, which is
    // deliberately not built here.
    expect(() => {
      disposer.disposeAll()
    }).not.toThrow()
    expect(released).toEqual([])
  })

  it('releases a fixed list through disposeAll', () => {
    const order: string[] = []

    disposeAll([() => order.push('a'), () => order.push('b')])

    expect(order).toEqual(['a', 'b'])
  })
})
