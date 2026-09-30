import { describe, expect, it } from 'vitest'
import {
  MACRO_ACTION_LIMIT, MacroLayoutError, inspectMacroHeader, macroPacket, macroTriggerDescription, macroTriggerRecord,
  macroUsedEnd, parseMacroStorage, replaceMacro, serializeMacroEntry,
} from './macro'

// 实机样本：entry_count = 1，M1 只有一条「A 抬起，延后 870 ms」，used_end = 26（0x1A）。
function liveMacroStorage(): Uint8Array {
  return Uint8Array.from([
    0xaa, 0x55, 0x1a, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x12, 0x00,
    0x01, 0x00, 0x35, 0x00,
    0x66, 0x03, 0x0a, 0x04,
  ])
}

// 10 个 entry 的完整表：M2 为文档中的 A 按下 + A 抬起。
function fullMacroStorage(): Uint8Array {
  const offsets = [0x24, 0x28, 0x34, 0x38, 0x3c, 0x40, 0x44, 0x48, 0x4c, 0x50]
  const bytes = new Uint8Array(0x54)
  bytes.set([0xaa, 0x55, 0x54, 0x00, 0x0a, 0x00])
  offsets.forEach((offset, index) => bytes.set([offset, 0], 0x10 + index * 2))
  offsets.forEach((offset, index) => bytes.set(index === 1
    ? Uint8Array.from([0x02, 0x00, 0x35, 0x00, 0x01, 0x00, 0x8a, 0x04, 0x00, 0x00, 0x0a, 0x04])
    : Uint8Array.from([0x00, 0x00, 0x35, 0x00]), offset))
  return bytes
}

describe('macro protocol', () => {
  it('解析实机样本：entry_count = 1 且 used_end = 26 合法', () => {
    const parsed = parseMacroStorage(liveMacroStorage())
    expect(parsed.usedEnd).toBe(0x1a)
    expect(parsed.entryCount).toBe(1)
    expect(parsed.offsets).toEqual([0x12])
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0].actions).toEqual([{ delayMs: 0x0366, pressed: false, usage: 0x04 }])
    expect(parsed.entries[0].editable).toBe(true)
  })

  it('entry 头顺序为 action_count 在前、35 00 marker 在后', () => {
    expect(Array.from(serializeMacroEntry([]))).toEqual([0x00, 0x00, 0x35, 0x00])
    expect(Array.from(serializeMacroEntry([
      { delayMs: 1, pressed: true, usage: 0x04 },
      { delayMs: 0, pressed: false, usage: 0x04 },
    ]))).toEqual([0x02, 0x00, 0x35, 0x00, 0x01, 0x00, 0x8a, 0x04, 0x00, 0x00, 0x0a, 0x04])
  })

  it('解析 10 个 entry 完整表的 M2 A down/up 样本', () => {
    const parsed = parseMacroStorage(fullMacroStorage())
    expect(parsed.entryCount).toBe(10)
    expect(parsed.offsets[0]).toBe(0x24)
    expect(parsed.entries[1].actions).toEqual([
      { delayMs: 1, pressed: true, usage: 0x04 },
      { delayMs: 0, pressed: false, usage: 0x04 },
    ])
    expect(parsed.entries[1].editable).toBe(true)
  })

  it('重建变长宏并重算 entry_count、offsets 与 used_end', () => {
    const parsed = parseMacroStorage(fullMacroStorage())
    const actions = Array.from({ length: 4 }, (_, index) => ({ delayMs: index, pressed: index % 2 === 0, usage: 0x05 }))
    const next = parseMacroStorage(replaceMacro(parsed, 0, actions))
    expect(next.entries[0].actions).toEqual(actions)
    expect(next.entryCount).toBe(10)
    expect(next.offsets).toEqual([0x24, 0x38, 0x44, 0x48, 0x4c, 0x50, 0x54, 0x58, 0x5c, 0x60])
    expect(next.usedEnd).toBe(0x64)
  })

  it('写入尚未序列化的槽位时按空 entry 补齐，不清除已有 entry', () => {
    const parsed = parseMacroStorage(liveMacroStorage())
    const next = parseMacroStorage(replaceMacro(parsed, 2, [{ delayMs: 5, pressed: true, usage: 0x05 }]))
    expect(next.entryCount).toBe(3)
    expect(next.offsets).toEqual([0x16, 0x1e, 0x22])
    expect(next.entries[0].actions).toEqual([{ delayMs: 0x0366, pressed: false, usage: 0x04 }])
    expect(next.entries[1].actions).toEqual([])
    expect(next.entries[2].actions).toEqual([{ delayMs: 5, pressed: true, usage: 0x05 }])
    expect(next.offsets[2] + next.entries[2].raw.length).toBe(next.usedEnd)
  })

  it('清空已有槽位会保留空 entry，不改变其它槽位编号', () => {
    const parsed = parseMacroStorage(fullMacroStorage())
    const next = parseMacroStorage(replaceMacro(parsed, 1, []))
    expect(next.entryCount).toBe(10)
    expect(next.entries[1].actions).toEqual([])
    expect(next.entries[1].raw).toHaveLength(4)
    expect(next.offsets).toEqual([0x24, 0x28, 0x2c, 0x30, 0x34, 0x38, 0x3c, 0x40, 0x44, 0x48])
    expect(next.usedEnd).toBe(0x4c)
  })

  it('限制每个宏最多 90 条动作', () => {
    const action = { delayMs: 1, pressed: true, usage: 0x04 }
    expect(serializeMacroEntry(Array(MACRO_ACTION_LIMIT).fill(action))).toHaveLength(364)
    expect(() => serializeMacroEntry(Array(MACRO_ACTION_LIMIT + 1).fill(action))).toThrow('最多 90 条')
  })

  it('拒绝 marker 错位与超容量 entry_count', () => {
    const wrongMarker = liveMacroStorage()
    wrongMarker.set([0x00, 0x35], 0x14)
    expect(() => parseMacroStorage(wrongMarker)).toThrow('M1 marker 无效')

    const tooMany = liveMacroStorage()
    tooMany.set([0x0b, 0x00], 4)
    expect(() => parseMacroStorage(tooMany)).toThrow('超出 1–10')

    const badLength = liveMacroStorage()
    badLength.set([0x02, 0x00], 0x12)
    expect(() => parseMacroStorage(badLength)).toThrow('action_count 与 entry 长度不一致')
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

describe('宏存储诊断', () => {
  it('used_end 越界时抛出携带原始样本的 MacroLayoutError', () => {
    const probe = new Uint8Array(0x38)
    probe.set([0xaa, 0x55, 0x0a, 0x00, 0x01, 0x00])
    let caught: unknown
    try { macroUsedEnd(probe) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(MacroLayoutError)
    const layoutError = caught as MacroLayoutError
    expect(layoutError.message).toBe('宏存储 used_end 无效：10')
    expect(layoutError.header).toEqual(probe)
    expect(layoutError.report).toContain('0x02 used_end')
    expect(layoutError.report).toContain('hexdump')
  })

  it('magic 未命中时同样保留样本与报告', () => {
    const probe = new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44, 0x55])
    let caught: unknown
    try { macroUsedEnd(probe) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(MacroLayoutError)
    expect((caught as MacroLayoutError).report).toContain('未命中 AA 55')
  })

  it('诊断报告按 entry_count 解析 offset table 与 entry 头', () => {
    const report = inspectMacroHeader(liveMacroStorage())
    expect(report).toContain('0x04 entry_count        LE=1')
    expect(report).toContain('offset table（0x10 起，1 × uint16 = 2 字节）')
    expect(report).toContain('0x10 → offset=0x0012')
    expect(report).toContain('action_count=1')
    expect(report).toContain('marker=35 00（命中）')
    expect(report).toContain('entry_end=0x001A')
  })

  it('10 个 entry 的表不会被当成唯一合法形态', () => {
    const report = inspectMacroHeader(fullMacroStorage())
    expect(report).toContain('0x04 entry_count        LE=10')
    expect(report).toContain('offset table（0x10 起，10 × uint16 = 20 字节）')
    expect(report).toContain('0x12 → offset=0x0028')
  })
})
