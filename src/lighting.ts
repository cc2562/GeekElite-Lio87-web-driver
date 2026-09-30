import { CHUNK_SIZE, PAYLOAD_SIZE, type Rgb, withChecksum } from './protocol'

/**
 * 逐键颜色表（自定义灯光）与灯效语义。
 *
 * 依据 docs/GeekElite_Leo87_Lighting_Protocol.md：
 * - 普通灯效通过 `06 27` 报文下发，payload[8] = effect_id、payload[9] = brightness、
 *   payload[10] = speed（数值越小越快：0 最快、4 最慢）、payload[12] = 静态/轮换标志、
 *   payload[13..15] = RGB；
 * - 自定义逐键颜色使用命令 `0x0B`，总长 384 字节 = 128 record × 3 字节，
 *   分段方式与 keymap 完全一致，record 索引也与 keymap 共用同一套编号；
 * - 使用逐键颜色前需要先切到自定义灯效 `0x13`。
 *
 * 本模块只做纯数据处理，不接触设备与浏览器 API，便于用固定字节样本测试。
 */

// 逐键颜色表的写入命令。
export const COLOR_MAP_COMMAND = 0x0b
// 启用自定义模式的灯效 ID。注意 0x0B 同时也是一次灯效 ID（百花齐放），两者语义不同，不可合并。
export const CUSTOM_EFFECT_ID = 0x13
export const COLOR_MAP_SIZE = 384
export const COLOR_RECORD_SIZE = 3
export const COLOR_RECORD_COUNT = COLOR_MAP_SIZE / COLOR_RECORD_SIZE
// 与 keymap 的物理位置表对齐：record index → 颜色表偏移为 index × 3。
export const COLOR_RECORD_STRIDE = COLOR_RECORD_SIZE
export const DEFAULT_EFFECT_ID = 0x06
export const DEFAULT_SPEED = 1

export type EffectOption = { id: number; label: string }
export type ColorRecordChange = { index: number; before: Rgb; after: Rgb }
export type PresetColor = { label: string; hex: string }

/**
 * 已确认灯效 ID 表。
 *
 * 只收录 docs/GeekElite_Leo87_Lighting_Protocol.md §4 中通过实机抓包确认的灯效；
 * `0x11` 尚未抓到，故意不在此表中：界面不会显示，`assertEffectId` 也会拒绝下发。
 */
export const EFFECT_OPTIONS: ReadonlyArray<EffectOption> = [
  { id: 0x01, label: '波浪' },
  { id: 0x02, label: '彩虹' },
  { id: 0x03, label: '转圈' },
  { id: 0x04, label: '光谱' },
  { id: 0x05, label: '呼吸' },
  { id: 0x06, label: '常亮' },
  { id: 0x07, label: '按键反应' },
  { id: 0x08, label: '涟漪' },
  { id: 0x09, label: '奔腾' },
  { id: 0x0a, label: '繁星' },
  { id: 0x0b, label: '百花齐放' },
  { id: 0x0c, label: '滚动' },
  { id: 0x0d, label: '大鹏展翅' },
  { id: 0x0e, label: '厚积薄发' },
  { id: 0x0f, label: '雨中漫步' },
  { id: 0x10, label: '扫描' },
  { id: 0x12, label: '跑马灯' },
  { id: CUSTOM_EFFECT_ID, label: '自定义' },
]

// 来自协议笔记中经过实机验证的颜色样本。
export const PRESET_COLORS: ReadonlyArray<PresetColor> = [
  { label: '红', hex: '#FF0000' },
  { label: '橙', hex: '#FFA800' },
  { label: '黄', hex: '#FFF005' },
  { label: '绿', hex: '#00D70F' },
  { label: '浅蓝', hex: '#0099FF' },
  { label: '深蓝', hex: '#3153FF' },
  { label: '紫', hex: '#5E01D2' },
  { label: '浅紫', hex: '#EE00F1' },
  { label: '粉', hex: '#FF008A' },
]

export function effectLabel(id: number): string {
  return EFFECT_OPTIONS.find(effect => effect.id === id)?.label ?? `未知灯效 0x${id.toString(16).toUpperCase().padStart(2, '0')}`
}

/** 下发前的白名单校验：未确认的灯效（如 0x11）不允许出现在报文里。 */
export function assertEffectId(id: number): void {
  if (!EFFECT_OPTIONS.some(effect => effect.id === id)) throw new Error(`未确认的灯效 ID：0x${Number(id).toString(16).toUpperCase().padStart(2, '0')}`)
}

export function assertLightingLevel(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 4) throw new Error(`${name}必须在 0–4 之间`)
}

/** 逐键颜色表的一次完整分段写入报文：`?? ?? 0B length offsetLE 00 data...`。 */
export function colorMapPacket(offset: number, data: Uint8Array): Uint8Array {
  if (!Number.isInteger(offset) || offset < 0 || offset > 0xffff || data.length < 1 || data.length > CHUNK_SIZE || offset + data.length > COLOR_MAP_SIZE) {
    throw new Error('无效的逐键颜色分段')
  }
  const packet = new Uint8Array(PAYLOAD_SIZE)
  packet[2] = COLOR_MAP_COMMAND
  packet[3] = data.length
  packet[4] = offset & 0xff
  packet[5] = offset >>> 8
  packet[6] = 0x00
  packet.set(data, 7)
  return withChecksum(packet)
}

export function createColorMap(): Uint8Array {
  return new Uint8Array(COLOR_MAP_SIZE)
}

export function validateColorMap(bytes: Uint8Array): void {
  if (bytes.length !== COLOR_MAP_SIZE) throw new Error('逐键颜色表必须正好为 384 字节')
}

export function assertRecordIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= COLOR_RECORD_COUNT) throw new Error('record 索引错误')
}

export function colorAt(map: Uint8Array, index: number): Rgb {
  validateColorMap(map)
  assertRecordIndex(index)
  const at = index * COLOR_RECORD_STRIDE
  return { r: map[at], g: map[at + 1], b: map[at + 2] }
}

export function withRecordColor(map: Uint8Array, index: number, color: Rgb): Uint8Array {
  validateColorMap(map)
  assertRecordIndex(index)
  assertColor(color)
  const next = map.slice()
  const at = index * COLOR_RECORD_STRIDE
  next[at] = color.r
  next[at + 1] = color.g
  next[at + 2] = color.b
  return next
}

/** 清空单个 record：`00 00 00`。是否等于“关闭该键灯光”尚待实机确认。 */
export function clearRecordColor(map: Uint8Array, index: number): Uint8Array {
  return withRecordColor(map, index, { r: 0, g: 0, b: 0 })
}

export function clearColorMap(map: Uint8Array): Uint8Array {
  validateColorMap(map)
  return createColorMap()
}

export function diffColorMap(before: Uint8Array, after: Uint8Array): ColorRecordChange[] {
  validateColorMap(before)
  validateColorMap(after)
  const result: ColorRecordChange[] = []
  for (let index = 0; index < COLOR_RECORD_COUNT; index++) {
    const oldColor = colorAt(before, index)
    const newColor = colorAt(after, index)
    if (oldColor.r !== newColor.r || oldColor.g !== newColor.g || oldColor.b !== newColor.b) {
      result.push({ index, before: oldColor, after: newColor })
    }
  }
  return result
}

export function coloredRecordCount(map: Uint8Array): number {
  validateColorMap(map)
  let count = 0
  for (let index = 0; index < COLOR_RECORD_COUNT; index++) {
    const color = colorAt(map, index)
    if (color.r !== 0 || color.g !== 0 || color.b !== 0) count += 1
  }
  return count
}

export function assertColor(color: Rgb): void {
  for (const [value, name] of [[color.r, '红色'], [color.g, '绿色'], [color.b, '蓝色']] as Array<[number, string]>) {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`${name}超出字节范围`)
  }
}

export function parseHexColor(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error('颜色必须为 #RRGGBB 格式')
  return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) }
}

export function hexColor(color: Rgb): string {
  assertColor(color)
  return `#${[color.r, color.g, color.b].map(value => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}
