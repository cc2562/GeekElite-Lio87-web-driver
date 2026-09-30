import { describe, expect, it } from 'vitest'
import { usageForCode, usageLabel } from './macro'

describe('probe usage map', () => {
  it('dump', () => {
    const codes = [
      'KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyF', 'KeyW', 'KeyZ',
      'Digit0', 'Digit1', 'Digit2', 'Digit5', 'Digit9',
      'Space', 'Enter', 'Semicolon', 'Comma', 'ArrowUp', 'F1', 'F12', 'Numpad1',
    ]
    console.log(codes.map(code => `${code} -> ${usageForCode(code)}`).join('\n'))
    console.log('labels: ' + [0x04, 0x05, 0x1d, 0x1e, 0x26, 0x27].map(u => `${u}=${usageLabel(u)}`).join(' '))
    expect(true).toBe(true)
  })
})
