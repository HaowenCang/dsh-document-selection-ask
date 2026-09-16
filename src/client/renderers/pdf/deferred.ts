/**
 * The deferral primitive for waiting on something that has not happened yet.
 *
 * `Promise.withResolvers` would say the same thing, but it is an ES2024 library
 * addition and this project compiles against ES2023 while targeting browsers the
 * project does not otherwise constrain. The three lines below have no version
 * requirement and no behaviour of their own to get wrong.
 */

/** A promise and the two functions that settle it. */
export interface Deferred<T> {
  /** The promise to await. */
  readonly promise: Promise<T>
  /** Settle it successfully. */
  readonly resolve: (value: T) => void
  /** Settle it with a failure. */
  readonly reject: (reason: unknown) => void
}

/**
 * Create a promise with its own settling functions.
 *
 * @returns the promise and its two settle functions.
 */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
