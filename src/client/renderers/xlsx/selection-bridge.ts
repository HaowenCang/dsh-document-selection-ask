/**
 * XLSX Semantic Selection Bridge.
 *
 * Mediates between react-xlsx's internal public selection model and the
 * DSH selection adapter/kernel. Owns tokenized owner isolation so unmounting
 * older workbooks cannot clear selections from newer active workbooks.
 *
 * Instantiated per `applyClient()` context.
 */

export interface XlsxRangeSelection {
  readonly resourceAddress: string
  readonly root: HTMLElement
  readonly sheet: string
  readonly range: string
  readonly values: readonly (readonly string[])[]
  readonly cellCount: number
  readonly rect: DOMRectReadOnly | null
  readonly ownerToken: symbol
  readonly generation: number
}

export type XlsxSelectionPublishInput = Omit<XlsxRangeSelection, 'ownerToken' | 'generation'>

export interface XlsxSelectionOwner {
  readonly token: symbol
  readonly resourceAddress: string
  readonly root: HTMLElement
  publish(input: XlsxSelectionPublishInput): void
  clear(): void
  dispose(): void
}

export interface XlsxSelectionBridge {
  createOwner(resourceAddress: string, root: HTMLElement): XlsxSelectionOwner
  getSelection(): XlsxRangeSelection | null
  subscribe(listener: (selection: XlsxRangeSelection | null) => void): () => void
  clear(): void
}

/**
 * Deep-clone and freeze an array of string rows to guarantee immutability.
 */
function cloneAndFreezeValues(values: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return Object.freeze(values.map((row) => Object.freeze([...row])))
}

/**
 * Create a new isolated XLSX semantic selection bridge.
 */
export function createXlsxSelectionBridge(): XlsxSelectionBridge {
  let currentSelection: XlsxRangeSelection | null = null
  let generationCounter = 0
  const listeners = new Set<(selection: XlsxRangeSelection | null) => void>()

  function notify(): void {
    for (const listener of listeners) {
      listener(currentSelection)
    }
  }

  function clear(): void {
    if (currentSelection !== null) {
      currentSelection = null
      notify()
    }
  }

  function getSelection(): XlsxRangeSelection | null {
    return currentSelection
  }

  function subscribe(listener: (selection: XlsxRangeSelection | null) => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function createOwner(resourceAddress: string, root: HTMLElement): XlsxSelectionOwner {
    const token = Symbol('xlsx-owner')
    let disposed = false

    return {
      token,
      resourceAddress,
      root,
      publish(input: XlsxSelectionPublishInput): void {
        if (disposed) return
        generationCounter += 1
        currentSelection = {
          resourceAddress: input.resourceAddress,
          root: input.root,
          sheet: input.sheet,
          range: input.range,
          values: cloneAndFreezeValues(input.values),
          cellCount: input.cellCount,
          rect: input.rect,
          ownerToken: token,
          generation: generationCounter,
        }
        notify()
      },
      clear(): void {
        if (currentSelection?.ownerToken === token) {
          clear()
        }
      },
      dispose(): void {
        if (disposed) return
        disposed = true
        if (currentSelection?.ownerToken === token) {
          clear()
        }
      },
    }
  }

  return {
    createOwner,
    getSelection,
    subscribe,
    clear,
  }
}
