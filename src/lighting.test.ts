import { describe, expect, it } from 'vitest'
import {
  COLOR_MAP_COMMAND, COLOR_MAP_SIZE, CUSTOM_EFFECT_ID, EFFECT_OPTIONS, PRESET_COLORS, assertEffectId, assertLightingLevel,
  clearColorMap, clearRecordColor, colorAt, colorMapPacket, coloredRecordCount, createColorMap, diffColorMap, effectLabel,
  hexColor, parseHexColor, validateColorMap, withRecordColor,
} from './lighting'
import { chunks } from './protocol'

describe('灯效表', () => {
  it('只收录实机确认过的灯效，0x11 既不在表中也不允许下发', () => {
    expect(EFFECT_OPTIONS.map(effect => effect.id)).toEqual([
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
      0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x12, 0x13,
    ])
    expect(EFFECT_OPTIONS.some(effect => effect.id === 0x11)).toBe(false)
    expect(() => assertEffectId(0x11)).toThrow('未确认的灯效 ID')
    expect(() => assertEffectId(0x13)).not.toThrow()
    expect(effectLabel(0x06)).toBe('常亮')
    expect(effectLabel(0x13)).toBe('自定义')
    expect(effectLabel(0x11)).toBe('未知灯效 0x11')
    expect(CUSTOM_EFFECT_ID).toBe(0x13)
  })

  it('亮度与速度都限制在 0–4', () => {
    expect(() => assertLightingLevel(0, '亮度')).not.toThrow()
    expect(() => assertLightingLevel(4, '速度')).not.toThrow()
    expect(() => assertLightingLevel(-1, '亮度')).toThrow('0–4')
    expect(() => assertLightingLevel(5, '速度')).toThrow('0–4')
    expect(() => assertLightingLevel(1.5, '亮度')).toThrow('0–4')
  })
})

describe('逐键颜色表报文', () => {
  it('分段结构与协议笔记一致，末段为 0x30', () => {
    expect(chunks()).toEqual([
      { offset: 0x0000, length: 0x38 }, { offset: 0x0038, length: 0x38 }, { offset: 0x0070, length: 0x38 },
      { offset: 0x00a8, length: 0x38 }, { offset: 0x00e0, length: 0x38 }, { offset: 0x0118, length: 0x38 },
      { offset: 0x0150, length: 0x30 },
    ])
    // 笔记 §10 的两个样例头：?? ?? 0B 38 A8 00 00 与 ?? ?? 0B 30 50 01 00。
    const middle = colorMapPacket(0x00a8, new Uint8Array(0x38))
    expect(Array.from(middle.slice(2, 7))).toEqual([0x0b, 0x38, 0xa8, 0x00, 0x00])
    const last = colorMapPacket(0x0150, new Uint8Array(0x30))
    expect(Array.from(last.slice(2, 7))).toEqual([0x0b, 0x30, 0x50, 0x01, 0x00])
    // 全零数据时累加校验只由报文头决定：0x0B + 0x38 + 0xA8 = 0x00EB。
    expect(Array.from(middle.slice(0, 2))).toEqual([0xeb, 0x00])
    expect(Array.from(last.slice(0, 2))).toEqual([0x0b + 0x30 + 0x50 + 0x01, 0x00])
    expect(middle[7 + 0x38 - 1]).toBe(0)
  })

  it('数据写在 offset 7 之后，越界与超长分段被拒绝', () => {
    const data = Uint8Array.from({ length: 0x38 }, (_, index) => index + 1)
    const packet = colorMapPacket(0x0038, data)
    expect(Array.from(packet.slice(7, 7 + 0x38))).toEqual(Array.from(data))
    expect(() => colorMapPacket(0x0150, new Uint8Array(0x38))).toThrow('无效的逐键颜色分段')
    expect(() => colorMapPacket(-1, new Uint8Array(1))).toThrow('无效的逐键颜色分段')
    expect(() => colorMapPacket(0, new Uint8Array(57))).toThrow('无效的逐键颜色分段')
  })
})

describe('逐键颜色表数据', () => {
  it('record 索引与 keymap 对齐，偏移为 index × 3', () => {
    expect(COLOR_MAP_SIZE).toBe(384)
    const map = withRecordColor(createColorMap(), 63, { r: 0, g: 215, b: 15 })
    expect(map[189]).toBe(0)
    expect(map[190]).toBe(215)
    expect(map[191]).toBe(15)
    expect(colorAt(map, 63)).toEqual({ r: 0, g: 215, b: 15 })
    expect(coloredRecordCount(map)).toBe(1)
  })

  it('原表不被修改，清除与清空行为正确', () => {
    const original = createColorMap()
    const painted = withRecordColor(original, 12, { r: 255, g: 0, b: 0 })
    expect(original.every(byte => byte === 0)).toBe(true)
    expect(colorAt(clearRecordColor(painted, 12), 12)).toEqual({ r: 0, g: 0, b: 0 })
    expect(clearColorMap(painted).every(byte => byte === 0)).toBe(true)
    expect(coloredRecordCount(painted)).toBe(1)
  })

  it('差异按 record 计算，长度非法时拒绝', () => {
    const before = withRecordColor(createColorMap(), 3, { r: 255, g: 0, b: 0 })
    const after = withRecordColor(withRecordColor(before, 3, { r: 0, g: 0, b: 255 }), 20, { r: 0, g: 215, b: 15 })
    expect(diffColorMap(before, after)).toEqual([
      { index: 3, before: { r: 255, g: 0, b: 0 }, after: { r: 0, g: 0, b: 255 } },
      { index: 20, before: { r: 0, g: 0, b: 0 }, after: { r: 0, g: 215, b: 15 } },
    ])
    expect(diffColorMap(before, before)).toEqual([])
    expect(() => validateColorMap(new Uint8Array(383))).toThrow('384 字节')
    expect(() => withRecordColor(new Uint8Array(383), 0, { r: 0, g: 0, b: 0 })).toThrow('384 字节')
    expect(() => colorAt(createColorMap(), 128)).toThrow('record 索引错误')
    expect(() => withRecordColor(createColorMap(), 0, { r: 256, g: 0, b: 0 })).toThrow('超出字节范围')
  })

  it('颜色表命令字与 0x0B 灯效（百花齐放）互不混用', () => {
    expect(COLOR_MAP_COMMAND).toBe(0x0b)
    expect(EFFECT_OPTIONS.find(effect => effect.id === 0x0b)?.label).toBe('百花齐放')
    expect(colorMapPacket(0, new Uint8Array(1))[2]).toBe(COLOR_MAP_COMMAND)
  })

  it('十六进制颜色与实机样本往返一致', () => {
    for (const preset of PRESET_COLORS) {
      expect(hexColor(parseHexColor(preset.hex))).toBe(preset.hex.toUpperCase())
    }
    expect(hexColor({ r: 0, g: 215, b: 15 })).toBe('#00D70F')
    expect(parseHexColor('#3153ff')).toEqual({ r: 0x31, g: 0x53, b: 0xff })
    expect(parseHexColor('5E01D2')).toEqual({ r: 0x5e, g: 0x01, b: 0xd2 })
    expect(() => parseHexColor('#12345')).toThrow('#RRGGBB')
  })
})
