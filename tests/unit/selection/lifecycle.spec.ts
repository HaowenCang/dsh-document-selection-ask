/**
 * Disposal aggregation: every disposer runs, failures are reported at the end.
 *
 * The aggregation exists so that a component teardown is one call. That purpose
 * fails at the one point where it matters most if a throwing disposer can end the
 * loop early: the resources released after the throwing one — a worker, an object
 * URL, a viewer session — are the ones left behind, and the component is gone, so
 * nothing will ever release them. Fault tolerance here is therefore not a
 * convenience but the reason the helper is worth having.
 *
 * Error semantics are deliberately narrow. One failure rethrows the original
 * error object, so a caller matching on `instanceof` or on a custom `name` still
 * sees what it threw. Several failures become an `AggregateError` whose `errors`
 * follow execution order, and `errors` rather than `cause` is used because it is
 * the standard shape that consumers already know how to read. Errors are never
 * combined into a message string: a stringified stack cannot be matched on.
 *
 * Both exported forms are covered. They are two spellings of one contract —
 * a caller that already holds a list and a caller that wants lifetime management
 * must not disagree about what happens when a step fails.
 *
 * The suite deliberately stops short of async teardown. `Dispose` is
 * synchronous, and an `AsyncDisposer` introduced here would fix a shape that the
 * renderer tasks have not yet shown they need.
 */

import { describe, expect, it } from 'vitest'

import { Disposer, disposeAll } from '../../../src/client/selection/lifecycle.js'
import type { Dispose } from '../../../src/client/selection/lifecycle.js'

/** The two exported spellings of one contract, named so failures identify the form. */
const forms: readonly (readonly [string, (disposers: readonly Dispose[]) => void])[] = [
  [
    'Disposer#disposeAll',
    (disposers) => {
      const aggregator = new Disposer()
      for (const disposer of disposers) {
        aggregator.add(disposer)
      }
      aggregator.disposeAll()
    },
  ],
  ['disposeAll', (disposers) => disposeAll(disposers)],
]

describe.each(forms)('%s', (_name, run) => {
  it('runs every disposer when none throws', () => {
    const calls: string[] = []

    run([() => calls.push('a'), () => calls.push('b'), () => calls.push('c')])

    expect(calls).toEqual(['a', 'b', 'c'])
  })

  it('runs the later disposers when the first one throws', () => {
    const calls: string[] = []

    expect(() =>
      run([
        () => {
          calls.push('a')
          throw new Error('a failed')
        },
        () => calls.push('b'),
        () => calls.push('c'),
      ]),
    ).toThrow('a failed')

    expect(calls).toEqual(['a', 'b', 'c'])
  })

  it('runs the later disposers when a middle one throws', () => {
    const calls: string[] = []

    expect(() =>
      run([
        () => calls.push('a'),
        () => {
          calls.push('b')
          throw new Error('b failed')
        },
        () => calls.push('c'),
      ]),
    ).toThrow('b failed')

    // 'c' is the disposer the old behaviour dropped, and dropping it is the
    // defect: the resource it owns would stay live in a torn-down component.
    expect(calls).toEqual(['a', 'b', 'c'])
  })

  it('runs all three disposers in order when two of them throw', () => {
    const calls: string[] = []

    expect(() =>
      run([
        () => {
          calls.push('a')
          throw new Error('a failed')
        },
        () => calls.push('b'),
        () => {
          calls.push('c')
          throw new Error('c failed')
        },
      ]),
    ).toThrow(AggregateError)

    expect(calls).toEqual(['a', 'b', 'c'])
  })

  it('preserves the identity of a single error', () => {
    const failure = new Error('only failure')

    let thrown: unknown
    try {
      run([() => undefined, () => {
        throw failure
      }])
    } catch (error: unknown) {
      thrown = error
    }

    // Identity, not message equality: a caller that matches on `instanceof` or
    // on a custom `name` keeps working, and a single failure is not wrapped in
    // an aggregate the caller would have to unwrap.
    expect(thrown).toBe(failure)
  })

  it('preserves the identity of a non-Error single throw', () => {
    const sentinel = { code: 'TEARDOWN_FAILED' }

    let thrown: unknown
    try {
      run([
        () => {
          throw sentinel
        },
      ])
    } catch (error: unknown) {
      thrown = error
    }

    // A teardown callback is `() => void`, so whatever it throws is rethrown
    // as-is rather than being coerced into an `Error` on the way out.
    expect(thrown).toBe(sentinel)
  })

  it('reports multiple failures as one AggregateError', () => {
    const first = new Error('first failed')
    const second = new Error('second failed')

    let thrown: unknown
    try {
      run([
        () => {
          throw first
        },
        () => undefined,
        () => {
          throw second
        },
      ])
    } catch (error: unknown) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AggregateError)
    expect((thrown as AggregateError).errors).toEqual([first, second])
    expect((thrown as AggregateError).message).toContain('disposing')
  })

  it('keeps the aggregate error order stable across runs', () => {
    const make = (): { readonly disposers: readonly Dispose[]; readonly errors: readonly Error[] } => {
      const errors = [new Error('one'), new Error('two'), new Error('three')]
      const disposers = errors.map((error) => () => {
        throw error
      })
      return { disposers, errors }
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { disposers, errors } = make()

      let thrown: unknown
      try {
        run(disposers)
      } catch (error: unknown) {
        thrown = error
      }

      // Execution order, not report order chosen by the aggregator: a caller
      // reading `errors[0]` must get the failure it caused first.
      expect((thrown as AggregateError).errors).toEqual(errors)
    }
  })
})

describe('Disposer#disposeAll idempotence after a failure', () => {
  it('does not re-run or re-throw on a second call', () => {
    const disposer = new Disposer()
    const calls: string[] = []
    disposer.add(() => {
      calls.push('a')
      throw new Error('a failed')
    })
    disposer.add(() => calls.push('b'))

    expect(() => disposer.disposeAll()).toThrow('a failed')
    // The attempt is finished and the failure has been reported; repeating it
    // would run teardown against a torn-down component a second time.
    expect(() => disposer.disposeAll()).not.toThrow()
    expect(calls).toEqual(['a', 'b'])
  })

  it('runs each child disposer at most once across repeated calls', () => {
    const disposer = new Disposer()
    const calls: string[] = []
    disposer.add(() => {
      calls.push('a')
      throw new Error('a failed')
    })
    disposer.add(() => calls.push('b'))

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        disposer.disposeAll()
      } catch {
        // The first call throws; later calls are no-ops.
      }
    }

    expect(calls).toEqual(['a', 'b'])
  })

  it('releases late additions immediately and never rethrows the earlier failure', () => {
    const disposer = new Disposer()
    const calls: string[] = []
    disposer.add(() => {
      throw new Error('a failed')
    })

    expect(() => disposer.disposeAll()).toThrow('a failed')
    disposer.add(() => calls.push('late'))

    expect(() => disposer.disposeAll()).not.toThrow()
    expect(calls).toEqual(['late'])
  })
})

describe('Disposer#disposeAll execution order', () => {
  it('keeps the Task 3 call-order contract, unchanged', () => {
    const disposer = new Disposer()
    const calls: string[] = []
    disposer.add(() => calls.push('first'))
    disposer.add(() => calls.push('second'))
    disposer.add(() => calls.push('third'))

    disposer.disposeAll()

    // Dispose order is call order. Fault tolerance must not smuggle in a
    // reversal: reordering teardown is a separate decision with its own
    // regression tests, not a side effect of this fix.
    expect(calls).toEqual(['first', 'second', 'third'])
  })
})
