import { CHUNK_SIZE, PAYLOAD_SIZE, withChecksum } from './protocol'

export const MACRO_GET = 0x14
export const MACRO_SET = 0x15
export const MACRO_COUNT = 10
export const MACRO_ACTION_LIMIT = 90
export const MACRO_HEADER_MIN_SIZE = 0x24
export const MACRO_OFFSET_TABLE = 0x10
export const MAX_MACRO_STORAGE_SIZE = 8192

export type MacroAction = { delayMs: number; pressed: boolean; usage: number }
export type MacroEntry = { raw: Uint8Array; actions: MacroAction[]; editable: boolean }
export type MacroStorage = {
  raw: Uint8Array
  usedEnd: number
  offsets: number[]
  entries: MacroEntry[]
}

function uint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | bytes[offset + 1] << 8
}

function setUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = value >>> 8
}

export function macroPacket(command: typeof MACRO_GET | typeof MACRO_SET, offset: number, length: number, data?: Uint8Array): Uint8Array {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || offset > 0xffff || length < 1 || length > CHUNK_SIZE) {
    throw new Error('无效的宏数据分段')
  }
  if (offset + length > MAX_MACRO_STORAGE_SIZE) throw new Error('宏数据超出安全读取范围')
  if (command === MACRO_SET && data?.length !== length) throw new Error('宏 SET 数据长度错误')
  const packet = new Uint8Array(PAYLOAD_SIZE)
  packet[2] = command
  packet[3] = length
  packet[4] = offset & 0xff
  packet[5] = offset >>> 8
  if (data) packet.set(data, 7)
  return withChecksum(packet)
}

export function parseMacroResponse(payload: Uint8Array, command: typeof MACRO_GET | typeof MACRO_SET, offset: number, length: number): Uint8Array {
  if (payload.length !== PAYLOAD_SIZE) throw new Error('宏响应长度错误')
  const request = macroPacket(command, offset, length, command === MACRO_SET ? payload.slice(7, 7 + length) : undefined)
  if (payload[0] !== request[0] || payload[1] !== request[1] || payload[2] !== command || payload[3] !== length || payload[4] !== (offset & 0xff) || payload[5] !== (offset >>> 8) || payload[6] !== 0) {
    throw new Error(`宏响应与请求不匹配：offset=0x${offset.toString(16)}`)
  }
  return payload.slice(7, 7 + length)
}

export function macroChunks(length: number): Array<{ offset: number; length: number }> {
  if (!Number.isInteger(length) || length < 1 || length > MAX_MACRO_STORAGE_SIZE) throw new Error('宏存储长度无效')
  const result = []
  for (let offset = 0; offset < length; offset += CHUNK_SIZE) result.push({ offset, length: Math.min(CHUNK_SIZE, length - offset) })
  return result
}

export function macroUsedEnd(header: Uint8Array): number {
  if (header.length < 6 || header[0] !== 0xaa || header[1] !== 0x55) throw new Error('宏存储 Magic 无效')
  const usedEnd = uint16(header, 2)
  if (usedEnd < MACRO_HEADER_MIN_SIZE || usedEnd > MAX_MACRO_STORAGE_SIZE) throw new Error(`宏存储 used_end 无效：${usedEnd}`)
  return usedEnd
}

export function parseMacroStorage(raw: Uint8Array): MacroStorage {
  const usedEnd = macroUsedEnd(raw)
  if (raw.length !== usedEnd) throw new Error(`宏数据长度 ${raw.length} 与 used_end ${usedEnd} 不一致`)
  if (uint16(raw, 4) !== MACRO_COUNT) throw new Error('宏槽位数量不是 10')
  const offsets = Array.from({ length: MACRO_COUNT }, (_, index) => uint16(raw, MACRO_OFFSET_TABLE + index * 2))
  if (offsets[0] < MACRO_HEADER_MIN_SIZE) throw new Error('首个宏 offset 越过 Header')
  for (let index = 0; index < offsets.length; index++) {
    const next = index + 1 < offsets.length ? offsets[index + 1] : usedEnd
    if (offsets[index] > next || offsets[index] < MACRO_HEADER_MIN_SIZE || next > usedEnd) throw new Error('宏 offsets 无效或未单调递增')
    if (next - offsets[index] < 4) throw new Error(`M${index + 1} entry 长度不足`)
  }
  const entries = offsets.map((offset, index): MacroEntry => {
    const end = index + 1 < offsets.length ? offsets[index + 1] : usedEnd
    const entry = raw.slice(offset, end)
    if (uint16(entry, 0) !== 0x0035) throw new Error(`M${index + 1} marker 无效`)
    const actionCount = uint16(entry, 2)
    if (actionCount > MACRO_ACTION_LIMIT) throw new Error(`M${index + 1} 超过 ${MACRO_ACTION_LIMIT} 条动作`)
    if (entry.length !== 4 + actionCount * 4) throw new Error(`M${index + 1} action_count 与 entry 长度不一致`)
    const actions: MacroAction[] = []
    let editable = true
    for (let actionIndex = 0; actionIndex < actionCount; actionIndex++) {
      const position = 4 + actionIndex * 4
      const eventType = entry[position + 2]
      if (eventType !== 0x8a && eventType !== 0x0a) editable = false
      actions.push({ delayMs: uint16(entry, position), pressed: eventType === 0x8a, usage: entry[position + 3] })
    }
    return { raw: entry, actions, editable }
  })
  return { raw: raw.slice(), usedEnd, offsets, entries }
}

export function serializeMacroEntry(actions: MacroAction[]): Uint8Array {
  if (actions.length > MACRO_ACTION_LIMIT) throw new Error(`每个宏最多 ${MACRO_ACTION_LIMIT} 条动作`)
  const entry = new Uint8Array(4 + actions.length * 4)
  setUint16(entry, 0, 0x0035)
  setUint16(entry, 2, actions.length)
  actions.forEach((action, index) => {
    if (!Number.isInteger(action.delayMs) || action.delayMs < 0 || action.delayMs > 0xffff) throw new Error('宏延时必须在 0–65535 ms 之间')
    if (!Number.isInteger(action.usage) || action.usage < 0 || action.usage > 0xff) throw new Error('宏 HID Usage 无效')
    const position = 4 + index * 4
    setUint16(entry, position, action.delayMs)
    entry[position + 2] = action.pressed ? 0x8a : 0x0a
    entry[position + 3] = action.usage
  })
  return entry
}

export function replaceMacro(storage: MacroStorage, macroIndex: number, actions: MacroAction[]): Uint8Array {
  if (!Number.isInteger(macroIndex) || macroIndex < 0 || macroIndex >= MACRO_COUNT) throw new Error('宏槽位索引无效')
  const replacement = serializeMacroEntry(actions)
  const entryBytes = storage.entries.map((entry, index) => index === macroIndex ? replacement : entry.raw)
  const headerSize = storage.offsets[0]
  const usedEnd = headerSize + entryBytes.reduce((total, entry) => total + entry.length, 0)
  if (usedEnd > MAX_MACRO_STORAGE_SIZE) throw new Error('宏数据超过安全存储范围')
  const output = new Uint8Array(usedEnd)
  output.set(storage.raw.slice(0, headerSize))
  setUint16(output, 2, usedEnd)
  let offset = headerSize
  entryBytes.forEach((entry, index) => {
    setUint16(output, MACRO_OFFSET_TABLE + index * 2, offset)
    output.set(entry, offset)
    offset += entry.length
  })
  parseMacroStorage(output)
  return output
}

const codeUsages: Record<string, number> = {
  Escape: 0x29, Backquote: 0x35, Minus: 0x2d, Equal: 0x2e, Backspace: 0x2a,
  Tab: 0x2b, BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31,
  CapsLock: 0x39, Semicolon: 0x33, Quote: 0x34, Enter: 0x28,
  Comma: 0x36, Period: 0x37, Slash: 0x38, Space: 0x2c,
  PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49, Home: 0x4a,
  PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e,
  ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
}
for (let index = 0; index < 26; index++) codeUsages[`Key${String.fromCharCode(65 + index)}`] = 0x04 + index
for (let index = 1; index <= 9; index++) codeUsages[`Digit${index}`] = 0x1d + index
codeUsages.Digit0 = 0x27
for (let index = 1; index <= 12; index++) codeUsages[`F${index}`] = 0x39 + index

export function usageForCode(code: string): number | null {
  return codeUsages[code] ?? null
}

export function usageLabel(usage: number): string {
  const action = Object.entries(codeUsages).find(([, value]) => value === usage)?.[0]
  if (!action) return `HID 0x${usage.toString(16).padStart(2, '0').toUpperCase()}`
  if (action.startsWith('Key')) return action.slice(3)
  if (action.startsWith('Digit')) return action.slice(5)
  return action.replace('Arrow', '')
}

export type MacroTriggerMode = 'normal' | 'release' | 'press' | 'repeat'

export function macroTriggerRecord(macroIndex: number, mode: MacroTriggerMode, repeatCount = 1): readonly [number, number, number] {
  if (!Number.isInteger(macroIndex) || macroIndex < 0 || macroIndex >= MACRO_COUNT) throw new Error('宏槽位索引无效')
  if (mode === 'repeat') {
    if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 255) throw new Error('宏重复次数必须在 1–255 之间')
    return [0x71, macroIndex, repeatCount]
  }
  return [0x70, macroIndex, mode === 'normal' ? 0 : mode === 'release' ? 1 : 2]
}

export function macroTriggerDescription(record: readonly [number, number, number]): string | null {
  if (record[1] >= MACRO_COUNT) return null
  if (record[0] === 0x70 && record[2] <= 2) return `M${record[1] + 1} · ${['正常停止', '释放停止', '按下停止'][record[2]]}`
  if (record[0] === 0x71 && record[2] >= 1) return `M${record[1] + 1} · 播放 ${record[2]} 次`
  return null
}
