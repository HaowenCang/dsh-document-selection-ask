/**
 * React mounting for the client specs.
 *
 * The client specs render real components into a real jsdom document rather than
 * calling them as functions, because the behaviours under test are the ones a
 * render lifecycle produces: a selector hook that must re-render when its source
 * changes, a layout effect that must run after the DOM exists, and a click
 * handler that must read the state its own render committed.
 *
 * `act` is enabled through `IS_REACT_ACT_ENVIRONMENT` rather than a testing
 * library. React 18.3 exports `act` from `react` itself, and this project ships
 * no DOM testing library, so the environment flag plus React's own `act` is the
 * whole harness — one fewer dependency between the test and the behaviour.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** A mounted React tree and its teardown. */
export interface MountedTree {
  /** The element the tree was rendered into. */
  readonly container: HTMLElement
  /**
   * Run a state-changing callback inside React's act queue.
   * @param body - the callback that mutates component-visible state.
   */
  act(body: () => void): void
  /** Unmount the tree and detach its container. */
  unmount(): void
}

/**
 * Mount a React element into a container attached to a parent.
 *
 * The parent matters for the overlay: it resolves the composer card by walking
 * up from its own DOM, so a container outside the card would exercise a
 * different branch of the code than the one the product uses.
 *
 * @param element - the element to render.
 * @param parent - the element to attach the container to; defaults to the body.
 * @returns the mounted tree.
 */
export function mountTree(element: ReactElement, parent: HTMLElement = document.body): MountedTree {
  const container = document.createElement('div')
  parent.appendChild(container)

  let root: Root | null = null
  act(() => {
    root = createRoot(container)
    root.render(element)
  })

  return {
    container,
    act(body: () => void): void {
      act(body)
    },
    unmount(): void {
      const mounted = root
      root = null
      if (mounted !== null) {
        act(() => {
          mounted.unmount()
        })
      }
      container.remove()
    },
  }
}

/**
 * Dispatch a pointer press followed by a click, as a real button receives them.
 *
 * Both events are dispatched rather than only the click, because the component's
 * protection against focus-driven selection collapse lives on `pointerdown`:
 * dispatching the click alone would let the test pass while the guard was
 * missing.
 *
 * @param element - the element to press.
 */
export function pressWithPointer(element: HTMLElement): void {
  element.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
  element.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
}
