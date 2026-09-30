import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BEGIN_FRAME, CURRENT_CONFIG_FRAME, END_FRAME, chunks, diffRecords, getPacket, lightPacket, parseGetResponse, readPacket, recordAt, replaceRecord, setPacket } from './protocol'

describe('Leo87 报文', () => {
  it('与实机灯光样例一致', () => {
    const red = lightPacket({ effectId: 0x06, brightness: 4, speed: 4, mode: 'static', color: { r: 255, g: 0, b: 0 } })
    expect(Array.from(red.slice(0, 16))).toEqual([0x3a, 0x02, 0x06, 0x27, 0, 0, 0, 0, 0x06, 0x04, 0x04, 0, 0, 0xff, 0, 0])
    expect(red[27]).toBe(0xff)
    expect(red[36]).toBe(1)
    expect(Array.from(lightPacket({ effectId: 0x06, brightness: 4, speed: 4, mode: 'static', color: { r: 123, g: 45, b: 67 } }).slice(0, 2))).toEqual([0x26, 0x02])
    expect(Array.from(BEGIN_FRAME.slice(0, 3))).toEqual([1, 0, 1])
    expect(Array.from(END_FRAME.slice(0, 3))).toEqual([2, 0, 2])
  })

  it('灯效、亮度与速度按参数落到 payload[8..12]，越界被拒绝', () => {
    const wave = lightPacket({ effectId: 0x01, brightness: 0, speed: 1, mode: 'cycle', color: { r: 0, g: 0, b: 0 } })
    expect(wave[8]).toBe(0x01)
    expect(wave[9]).toBe(0)
    expect(wave[10]).toBe(1)
    expect(wave[12]).toBe(1)
    const baseline = { effectId: 0x06, brightness: 0, speed: 0, mode: 'static' as const, color: { r: 0, g: 0, b: 0 } }
    expect(() => lightPacket({ ...baseline, brightness: 5 })).toThrow('亮度')
    expect(() => lightPacket({ ...baseline, speed: -1 })).toThrow('速度')
    expect(() => lightPacket({ ...baseline, effectId: 0x100 })).toThrow('灯效')
  })

  it('七段请求与笔记吻合，末段只有 48 字节', () => {
    expect(chunks()).toEqual([
      { offset: 0, length: 56 }, { offset: 0x38, length: 56 }, { offset: 0x70, length: 56 },
      { offset: 0xa8, length: 56 }, { offset: 0xe0, length: 56 }, { offset: 0x118, length: 56 },
      { offset: 0x150, length: 48 },
    ])
    expect(Array.from(getPacket(0, 56).slice(0, 7))).toEqual([0x3f, 0, 7, 0x38, 0, 0, 0])
    expect(Array.from(getPacket(0x150, 48).slice(0, 7))).toEqual([0x88, 0, 7, 0x30, 0x50, 1, 0])
    expect(Array.from(CURRENT_CONFIG_FRAME.slice(0, 4))).toEqual([0x25, 0, 3, 0x22])
    expect(Array.from(readPacket(0x08, 0, 56).slice(0, 7))).toEqual([0x40, 0, 8, 0x38, 0, 0, 0])
  })

  it('解析日志中的七段真实响应和 128 条 record', () => {
    const log = readFileSync('docs/j键位结果.txt', 'utf8')
    const lines = [...log.matchAll(/^RX: (04 [0-9A-F ]+)$/gm)]
    const complete = lines.slice(-7)
    expect(complete).toHaveLength(7)
    const keymap = new Uint8Array(384)
    chunks().forEach(({ offset, length }, index) => {
      const bytes = Uint8Array.from(complete[index][1].trim().split(/\s+/).map(value => parseInt(value, 16)))
      expect(bytes.length).toBe(64)
      expect(bytes[0]).toBe(4)
      keymap.set(parseGetResponse(bytes.slice(1), offset, length), offset)
    })
    expect(recordAt(keymap, 0)).toEqual([0x20, 0, 0x29])
    expect(recordAt(keymap, 85)).toEqual([0x30, 0xb6, 0])
    expect(recordAt(keymap, 87)).toEqual([0x30, 0xb5, 0])
    expect(recordAt(keymap, 127)).toEqual([0x20, 0, 0])
  })

  it('错位响应拒绝，SET 数据边界和差异准确', () => {
    const response = getPacket(0, 56)
    response[4] = 0x38
    expect(() => parseGetResponse(response, 0, 56)).toThrow('不匹配')
    const original = new Uint8Array(384)
    const changed = replaceRecord(original, 15, [0x20, 0, 0x04])
    expect(diffRecords(original, changed)).toHaveLength(1)
    expect(Array.from(setPacket(0, changed.slice(0, 56)).slice(0, 7))).toEqual([0x65, 0, 9, 56, 0, 0, 0])
    expect(() => setPacket(0, new Uint8Array(57))).toThrow()
  })
})
