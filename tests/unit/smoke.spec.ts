import { describe, expect, it } from 'vitest'

import { applyClient } from '../../src/client/dsh/register.js'

describe('package smoke', () => {
  it('exports the client registrar', () => {
    expect(typeof applyClient).toBe('function')
  })
})
