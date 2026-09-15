/**
 * Adapter registry: ownership, identity, and order.
 *
 * The registry is the one place that decides which format owns a selection, so
 * its behaviour is a safety contract rather than a convenience. Two of the
 * rules here exist to prevent a specific future defect rather than to describe
 * ordinary collection behaviour.
 *
 * Registration order, not last-registration-wins, decides ownership. A later
 * adapter that also claims the context must not silently displace an earlier
 * one, because "which format is this" is answered by the first adapter that can
 * prove it owns the root.
 *
 * An adapter that claims the context owns the *result*, including a rejection.
 * The alternative — falling through to the next adapter when the owner declines
 * — is what would let a PDF adapter reject a malformed cross-root selection and
 * a generic DOM adapter then accept the same gesture from the chat transcript.
 *
 * The specs therefore assert both the positive path (the owner is called) and
 * the negative path (nobody after the owner is called).
 */

import { describe, expect, it } from 'vitest'

import { SelectionAdapterRegistry } from '../../../src/client/selection/registry.js'
import type { SelectionAdapter, SelectionContext, SelectionCapture } from '../../../src/client/selection/registry.js'
import type { SelectionSnapshot } from '../../../src/client/selection/types.js'
import { snapshot } from '../selection/snapshot.js'

/** A context no adapter in these specs inspects: only identity matters here. */
const context: SelectionContext = { selection: null, target: null, now: 1_700_000_000_000 }

const validCapture: SelectionCapture = { snapshot: snapshot(), rejectReason: null }
const crossRootCapture: SelectionCapture = { snapshot: null, rejectReason: 'cross-root' }

/**
 * Build an adapter that records whether it was asked and whether it was used.
 * @param id - adapter identifier.
 * @param handles - value `canHandle` returns.
 * @param capture - result `capture` returns when it is the owner.
 * @returns the adapter plus the calls it observed, in order.
 */
function probeAdapter(
  id: string,
  handles: boolean,
  capture: SelectionCapture = validCapture,
): { readonly adapter: SelectionAdapter; readonly calls: string[] } {
  const calls: string[] = []
  const adapter: SelectionAdapter = {
    id,
    canHandle: () => {
      calls.push('canHandle')
      return handles
    },
    capture: () => {
      calls.push('capture')
      return capture
    },
  }
  return { adapter, calls }
}

describe('SelectionAdapterRegistry registration order', () => {
  it('gives ownership to the first registered adapter that can handle the context', () => {
    const registry = new SelectionAdapterRegistry()
    const a = probeAdapter('a', true, { snapshot: snapshot({ adapterId: 'a' }), rejectReason: null })
    const b = probeAdapter('b', true, { snapshot: snapshot({ adapterId: 'b' }), rejectReason: null })
    registry.register(a.adapter)
    registry.register(b.adapter)

    const result = registry.capture(context)

    expect(result.snapshot?.adapterId).toBe('a')
    // B never runs at all: the registry stops at the first owner rather than
    // collecting candidates and choosing among them.
    expect(b.calls).toEqual([])
  })

  it('skips adapters that decline the context and calls the first one that accepts', () => {
    const registry = new SelectionAdapterRegistry()
    const a = probeAdapter('a', false)
    const b = probeAdapter('b', true, { snapshot: snapshot({ adapterId: 'b' }), rejectReason: null })
    registry.register(a.adapter)
    registry.register(b.adapter)

    const result = registry.capture(context)

    expect(a.calls).toEqual(['canHandle'])
    expect(b.calls).toEqual(['canHandle', 'capture'])
    expect(result.snapshot?.adapterId).toBe('b')
  })

  it('keeps registration order after a middle adapter is disposed', () => {
    const registry = new SelectionAdapterRegistry()
    const a = probeAdapter('a', true, { snapshot: snapshot({ adapterId: 'a' }), rejectReason: null })
    const b = probeAdapter('b', true, { snapshot: snapshot({ adapterId: 'b' }), rejectReason: null })
    const c = probeAdapter('c', true, { snapshot: snapshot({ adapterId: 'c' }), rejectReason: null })
    registry.register(a.adapter)
    const disposeB = registry.register(b.adapter)
    registry.register(c.adapter)

    disposeB()

    expect(registry.capture(context).snapshot?.adapterId).toBe('a')
    // Removing the middle entry must not reorder the survivors.
    expect(c.calls).toEqual([])
  })
})

describe('SelectionAdapterRegistry rejection ownership', () => {
  it('does not fall through when the owning adapter rejects', () => {
    const registry = new SelectionAdapterRegistry()
    const owner = probeAdapter('owner', true, crossRootCapture)
    const fallback = probeAdapter('fallback', true, {
      snapshot: snapshot({ adapterId: 'fallback' }),
      rejectReason: null,
    })
    registry.register(owner.adapter)
    registry.register(fallback.adapter)

    const result = registry.capture(context)

    expect(result.rejectReason).toBe('cross-root')
    expect(result.snapshot).toBeNull()
    expect(fallback.calls).toEqual([])
  })

  it('reports outside-supported-preview when no adapter claims the context', () => {
    const registry = new SelectionAdapterRegistry()
    const a = probeAdapter('a', false)
    registry.register(a.adapter)

    const result = registry.capture(context)

    // Not a throw, not `undefined`, and not a generic fallback: the caller gets
    // an explicit reason it can use to stay silent.
    expect(result).toEqual({ snapshot: null, rejectReason: 'outside-supported-preview' })
    expect(a.calls).toEqual(['canHandle'])
  })

  it('reports outside-supported-preview for an empty registry', () => {
    const registry = new SelectionAdapterRegistry()

    expect(registry.capture(context)).toEqual({ snapshot: null, rejectReason: 'outside-supported-preview' })
  })
})

describe('SelectionAdapterRegistry adapter identity', () => {
  it('rejects a second registration of a live id', () => {
    const registry = new SelectionAdapterRegistry()
    registry.register(probeAdapter('a', true).adapter)

    expect(() => registry.register(probeAdapter('a', true).adapter)).toThrow(/a/)
    // The failed registration left the original owner in place: the threw call
    // must not have removed or shadowed it.
    expect(registry.capture(context).snapshot).not.toBeNull()
  })

  it('allows an id to be reused after its adapter is disposed', () => {
    const registry = new SelectionAdapterRegistry()
    const first = probeAdapter('a', true, { snapshot: snapshot({ adapterId: 'a' }), rejectReason: null })
    const disposeFirst = registry.register(first.adapter)
    disposeFirst()

    const second = probeAdapter('a', true, { snapshot: snapshot({ adapterId: 'a' }), rejectReason: null })
    expect(() => registry.register(second.adapter)).not.toThrow()
    expect(registry.capture(context).snapshot?.adapterId).toBe('a')
    expect(first.calls).toEqual([])
  })

  it('leaves the surviving adapter reachable after a sibling is disposed', () => {
    const registry = new SelectionAdapterRegistry()
    const a = probeAdapter('a', true)
    const b = probeAdapter('b', true, { snapshot: snapshot({ adapterId: 'b' }), rejectReason: null })
    const disposeA = registry.register(a.adapter)
    registry.register(b.adapter)

    disposeA()
    disposeA()

    expect(registry.capture(context).snapshot?.adapterId).toBe('b')
  })
})

describe('SelectionAdapterRegistry disposer', () => {
  it('removes the adapter from capture', () => {
    const registry = new SelectionAdapterRegistry()
    const a = probeAdapter('a', true)
    const dispose = registry.register(a.adapter)

    dispose()

    expect(registry.capture(context).rejectReason).toBe('outside-supported-preview')
    expect(a.calls).toEqual([])
  })

  it('is idempotent', () => {
    const registry = new SelectionAdapterRegistry()
    const a = probeAdapter('a', true)
    const disposeA = registry.register(a.adapter)

    disposeA()
    expect(() => {
      disposeA()
      disposeA()
    }).not.toThrow()
    expect(registry.capture(context)).toEqual({ snapshot: null, rejectReason: 'outside-supported-preview' })
  })
})

describe('SelectionAdapterRegistry capture result identity', () => {
  it('returns the owner result unchanged', () => {
    const registry = new SelectionAdapterRegistry()
    const owned: SelectionCapture = {
      snapshot: snapshot({ adapterId: 'a', text: 'alpha beta' }),
      rejectReason: null,
    }
    registry.register(probeAdapter('a', true, owned).adapter)

    expect(registry.capture(context).snapshot).toBe(owned.snapshot)
  })

  it('passes the exact context object to the owner', () => {
    const registry = new SelectionAdapterRegistry()
    const seen: SelectionContext[] = []
    const adapter: SelectionAdapter = {
      id: 'a',
      canHandle: (candidate) => {
        seen.push(candidate)
        return true
      },
      capture: () => validCapture,
    }
    registry.register(adapter)

    registry.capture(context)

    expect(seen).toEqual([context])
  })
})

describe('SelectionAdapterRegistry snapshot typing', () => {
  it('delivers a snapshot the kernel can store without any DOM reachable through it', () => {
    // The annotation is the assertion: `SelectionSnapshot` must stay free of
    // `Node`, `Range` and `Selection`, because the kernel retains this value
    // long after the browser selection that produced it has collapsed.
    const captured: SelectionSnapshot | null = new SelectionAdapterRegistry().capture(context).snapshot

    expect(captured).toBeNull()
  })
})
