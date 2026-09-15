/**
 * Snapshot factory shared by the pure unit specs.
 *
 * Task 2 does not capture selections, so no spec constructs a browser `Range`.
 * These specs need snapshots only as data, and the defaults below keep each test
 * stating just the field it is about — a limit, a location variant, or a file
 * name — instead of repeating eight boilerplate properties.
 */

import type { SelectionSnapshot } from '../../../src/client/selection/types.js'

/**
 * Build a snapshot with neutral defaults.
 * @param overrides - fields this test cares about.
 * @returns the merged snapshot.
 */
export function snapshot(overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return {
    adapterId: 'test-adapter',
    resourceAddress: 'file:///tmp/alpha.txt',
    fileName: 'alpha.txt',
    documentKind: 'text',
    text: 'alpha',
    location: { kind: 'lines', start: 1, end: 1 },
    rects: [],
    capturedAt: 1_700_000_000_000,
    ...overrides,
  }
}
