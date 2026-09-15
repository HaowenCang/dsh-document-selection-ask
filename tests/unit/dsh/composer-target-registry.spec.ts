// @vitest-environment jsdom
/**
 * The per-session composer target table.
 *
 * This spec is split from the surface's own spec on purpose. The registry is a
 * React-free object — the one part of the Task 5C handoff that has no lifecycle
 * of its own — so its contracts are asserted without a component: registration,
 * replacement, stale-disposer identity, and the subscription the surface
 * subscribes through. The component spec then covers what a render lifecycle
 * adds on top.
 *
 * The jsdom environment is declared because the targets below carry DOM anchors,
 * which is what the focus search consumes; the registry itself never touches the
 * document.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createComposerTargetRegistry,
  createTargetFocus,
} from '../../../src/client/dsh/composer-target-registry.js'
import type { ComposerTarget, ComposerTargetRegistry } from '../../../src/client/dsh/composer-target-registry.js'

/** One recording target, so a case can see which composer was written to. */
interface RecordingTarget extends ComposerTarget {
  /** Every draft written through this target, in order. */
  readonly written: string[]
  /** How many times focus was asked for. */
  readonly focuses: () => number
}

/**
 * Build a target that records what is done through it.
 *
 * @param name - the draft this target initially reports.
 * @param anchor - the DOM element the target belongs to, or `null`.
 * @returns the recording target.
 */
function target(name: string, anchor: Element | null = null): RecordingTarget {
  const written: string[] = []
  let focused = 0
  let draft = name

  return {
    get written(): string[] {
      return written
    },
    focuses: () => focused,
    readDraft: () => draft,
    setDraft: (text: string) => {
      written.push(text)
      draft = text
    },
    focus: () => {
      focused += 1
    },
    anchor,
  }
}

/**
 * Install a toggleable listener and count its calls.
 *
 * @param registry - the table to observe.
 * @returns the counter and the unsubscribe.
 */
function watch(registry: ComposerTargetRegistry): { calls: () => number; stop: () => void } {
  let calls = 0
  const stop = registry.subscribe(() => {
    calls += 1
  })
  return { calls: () => calls, stop }
}

let registry: ComposerTargetRegistry

beforeEach(() => {
  document.body.replaceChildren()
  registry = createComposerTargetRegistry()
})

describe('composer target registry lookup', () => {
  it('answers null for a session that never registered', () => {
    expect(registry.get('s1')).toBeNull()
  })

  it('returns the registered target for its own session', () => {
    const a = target('a')
    registry.register('s1', a)

    expect(registry.get('s1')).toBe(a)
  })

  it('keeps two sessions independent', () => {
    const a = target('a')
    const b = target('b')
    registry.register('s1', a)
    registry.register('s2', b)

    expect(registry.get('s1')).toBe(a)
    expect(registry.get('s2')).toBe(b)

    // Removing one session's target must not disturb the other's.
    registry.register('s1', a)()
    expect(registry.get('s1')).toBeNull()
    expect(registry.get('s2')).toBe(b)
  })
})

describe('composer target registry replacement', () => {
  it('replaces a session target with the newest registration', () => {
    const first = target('first')
    const second = target('second')

    registry.register('s1', first)
    registry.register('s1', second)

    expect(registry.get('s1')).toBe(second)
  })

  it('refuses to let a superseded disposer evict the replacement', () => {
    // The React transition this contract exists for: the new generation mounts
    // and registers before the old generation's cleanup runs.
    const first = target('first')
    const second = target('second')

    const disposeFirst = registry.register('s1', first)
    registry.register('s1', second)
    disposeFirst()

    expect(registry.get('s1')).toBe(second)
  })

  it('lets the current disposer remove its own registration', () => {
    const first = target('first')
    const second = target('second')

    registry.register('s1', first)
    const disposeSecond = registry.register('s1', second)
    disposeSecond()

    // The first registration was superseded, so nothing is live: a disposer that
    // resurrected the previous target would hand the surface a composer from the
    // generation it replaced.
    expect(registry.get('s1')).toBeNull()
  })

  it('is idempotent when a disposer runs twice', () => {
    const first = target('first')
    const second = target('second')

    const disposeFirst = registry.register('s1', first)
    disposeFirst()
    registry.register('s1', second)
    disposeFirst()

    expect(registry.get('s1')).toBe(second)
  })
})

describe('composer target registry subscription', () => {
  it('notifies on registration, replacement and removal', () => {
    const watcher = watch(registry)

    registry.register('s1', target('a'))
    expect(watcher.calls()).toBe(1)

    const dispose = registry.register('s1', target('b'))
    expect(watcher.calls()).toBe(2)

    // The replacement's own disposer, not the superseded one: a stale disposer
    // removes nothing and therefore reports nothing (its own case is below).
    dispose()
    expect(watcher.calls()).toBe(3)
  })

  it('stays silent when a stale disposer does nothing', () => {
    const disposeFirst = registry.register('s1', target('a'))
    registry.register('s1', target('b'))

    const watcher = watch(registry)
    disposeFirst()

    expect(watcher.calls()).toBe(0)
  })

  it('stops notifying after unsubscribe, and unsubscribe is idempotent', () => {
    const watcher = watch(registry)

    registry.register('s1', target('a'))
    expect(watcher.calls()).toBe(1)

    watcher.stop()
    watcher.stop()
    registry.register('s2', target('b'))

    expect(watcher.calls()).toBe(1)
  })

  it('keeps two registries independent', () => {
    const other = createComposerTargetRegistry()
    const watcher = watch(other)

    registry.register('s1', target('a'))

    expect(watcher.calls()).toBe(0)
    expect(other.get('s1')).toBeNull()
  })
})

describe('composer target focus', () => {
  it('focuses the editable surface of the composer that owns the anchor', () => {
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', '')
    const editable = document.createElement('div')
    editable.setAttribute('data-composer-input', '')
    editable.tabIndex = -1
    card.appendChild(editable)

    const anchor = document.createElement('span')
    anchor.setAttribute('data-dsa-composer-target-anchor', '')
    card.appendChild(anchor)
    document.body.appendChild(card)

    const owned = target('a', anchor)
    createTargetFocus(owned)()

    expect(document.activeElement).toBe(editable)
  })

  it('does nothing when the anchor is no longer mounted', () => {
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', '')
    const editable = document.createElement('div')
    editable.setAttribute('data-composer-input', '')
    editable.tabIndex = -1
    card.appendChild(editable)
    document.body.appendChild(card)

    // The anchor was never attached — the composer unmounted between the
    // registration and the click. Focus must not land anywhere.
    createTargetFocus(target('a', null))()

    expect(document.activeElement).not.toBe(editable)
  })
})
