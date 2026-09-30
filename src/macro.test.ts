import { describe, expect, it } from 'vitest'
import {
  MACRO_ACTION_LIMIT, macroPacket, macroTriggerDescription, macroTriggerRecord, parseMacroStorage,
  replaceMacro, serializeMacroEntry,
} from './macro'

function sampleStorage(): Uint8Array {
  const offsets = [0x24, 0x28, 0x34, 0x38, 0x3c, 0x40, 0x44, 0x48, 0x4c, 0x50]
  const bytes = new Uint8Array(0x54)
  bytes.set([0xaa, 0x55, 0x54, 0, 10, 0])
  offsets.forEach((offset, index) => bytes.set([offset, 0], 0x10 + index * 2))
  offsets.forEach((offset, index) => {
    const entry = index === 1
      ? serializeMacroEntry([{ delayMs: 1, pressed: true, usage: 0x04 }, { delayMs: 0, pressed: false, usage: 0x04 }])
      : serializeMacroEntry([])
    bytes.set(entry, offset)
  })
  return bytes
}

describe('macro protocol', () => {
  it('解析文档中的 M2 A down/up 样本', () => {
    const parsed = parseMacroStorage(sampleStorage())
    expect(parsed.entries[1].actions).toEqual([
      { delayMs: 1, pressed: true, usage: 0x04 },
      { delayMs: 0, pressed: false, usage: 0x04 },
    ])
    expect(parsed.entries[1].editable).toBe(true)
  })

  it('重建变长宏并重算全部 offsets 与 used_end', () => {
    const parsed = parseMacroStorage(sampleStorage())
    const actions = Array.from({ length: 4 }, (_, index) => ({ delayMs: index, pressed: index % 2 === 0, usage: 0x05 }))
    const rebuilt = replaceMacro(parsed, 0, actions)
    const next = parseMacroStorage(rebuilt)
    expect(next.entries[0].actions).toEqual(actions)
    expect(next.offsets).toEqual([0x24, 0x38, 0x44, 0x48, 0x4c, 0x50, 0x54, 0x58, 0x5c, 0x60])
    expect(next.usedEnd).toBe(0x64)
  })

  it('限制每个宏最多 90 条动作', () => {
    const action = { delayMs: 1, pressed: true, usage: 0x04 }
    expect(serializeMacroEntry(Array(MACRO_ACTION_LIMIT).fill(action))).toHaveLength(364)
    expect(() => serializeMacroEntry(Array(MACRO_ACTION_LIMIT + 1).fill(action))).toThrow('最多 90 条')
  })

  it('封装宏分段并生成四种触发 record', () => {
    expect(Array.from(macroPacket(0x14, 0x38, 0x38).slice(0, 7))).toEqual([0x84, 0, 0x14, 0x38, 0x38, 0, 0])
    expect(macroTriggerRecord(1, 'normal')).toEqual([0x70, 1, 0])
    expect(macroTriggerRecord(1, 'release')).toEqual([0x70, 1, 1])
    expect(macroTriggerRecord(1, 'press')).toEqual([0x70, 1, 2])
    expect(macroTriggerRecord(1, 'repeat', 21)).toEqual([0x71, 1, 21])
    expect(macroTriggerDescription([0x71, 1, 21])).toBe('M2 · 播放 21 次')
  })
})
