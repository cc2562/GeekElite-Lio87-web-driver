import { CHUNK_SIZE, PAYLOAD_SIZE, withChecksum } from './protocol'

export const MACRO_GET = 0x14
export const MACRO_SET = 0x15
// M1–M10 是键位可绑定的槽位容量；Storage 里实际序列化多少 entry 由 Header 的 entry_count 决定。
export const MACRO_COUNT = 10
export const MACRO_ACTION_LIMIT = 90
// 固定 Header：magic(2) + used_end(2) + entry_count(2) + reserved(10)。
export const MACRO_HEADER_FIXED_SIZE = 0x10
export const MACRO_OFFSET_TABLE = 0x10
export const MACRO_ENTRY_HEADER_SIZE = 4
export const MACRO_ACTION_SIZE = 4
export const MACRO_ENTRY_MARKER = 0x0035
// 最小合法 storage：固定 Header + 1 个 offset + 1 个空 entry。
export const MACRO_MIN_STORAGE_SIZE = MACRO_OFFSET_TABLE + 2 + MACRO_ENTRY_HEADER_SIZE
export const MAX_MACRO_STORAGE_SIZE = 8192
// 首次探测窗口：固定 Header 与 offset table 必须落在这里面。
export const MACRO_HEADER_PROBE = CHUNK_SIZE

export type MacroAction = { delayMs: number; pressed: boolean; usage: number }
export type MacroEntry = { raw: Uint8Array; actions: MacroAction[]; editable: boolean }
export type MacroStorage = {
  raw: Uint8Array
  usedEnd: number
  entryCount: number
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

function hex(value: number, width = 2): string {
  return value.toString(16).toUpperCase().padStart(width, '0')
}

function hexDump(bytes: Uint8Array, limit: number): string[] {
  const lines: string[] = []
  for (let offset = 0; offset < Math.min(bytes.length, limit); offset += 16) {
    const row = Array.from(bytes.slice(offset, offset + 16)).map(value => hex(value)).join(' ')
    lines.push(`    ${hex(offset, 4)}  ${row}`)
  }
  return lines
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

/**
 * 把一段无法按当前结构解析的宏数据整理成可复制的只读诊断报告。
 */
export function inspectMacroHeader(bytes: Uint8Array): string {
  const lines: string[] = [`宏存储诊断 · 样本长度 ${bytes.length} 字节`]
  if (bytes.length < 6) return [...lines, '  样本不足 6 字节，无法判定。'].join('\n')
  const magicOk = bytes[0] === 0xaa && bytes[1] === 0x55
  lines.push(`  0x00 magic              ${hex(bytes[0])} ${hex(bytes[1])}${magicOk ? '（命中 AA 55）' : '（未命中 AA 55）'}`)
  const usedEnd = uint16(bytes, 2)
  const usedEndBe = (bytes[2] << 8) | bytes[3]
  const usedEndOk = usedEnd >= MACRO_MIN_STORAGE_SIZE && usedEnd <= MAX_MACRO_STORAGE_SIZE
  lines.push(`  0x02 used_end           LE=${usedEnd}（0x${hex(usedEnd, 4)}） / BE=${usedEndBe} → ${usedEndOk ? '大小合法' : `越界（合法区间 0x${hex(MACRO_MIN_STORAGE_SIZE)}–0x${hex(MAX_MACRO_STORAGE_SIZE)}）`}`)
  const entryCount = uint16(bytes, 4)
  lines.push(`  0x04 entry_count        LE=${entryCount}（槽位容量上限 ${MACRO_COUNT}）`)
  lines.push(`  0x06 reserved           ${bytes.length >= MACRO_HEADER_FIXED_SIZE ? Array.from(bytes.slice(6, MACRO_HEADER_FIXED_SIZE)).map(value => hex(value)).join(' ') : '窗口不足'}`)
  const tableEnd = MACRO_OFFSET_TABLE + entryCount * 2
  if (entryCount >= 1 && entryCount <= MACRO_COUNT && tableEnd <= bytes.length) {
    lines.push(`  offset table（0x10 起，${entryCount} × uint16 = ${entryCount * 2} 字节）：`)
    for (let index = 0; index < entryCount; index++) {
      const at = MACRO_OFFSET_TABLE + index * 2
      const offset = uint16(bytes, at)
      const readable = offset + MACRO_ENTRY_HEADER_SIZE <= bytes.length
      const actionCount = readable ? uint16(bytes, offset) : null
      const marker = readable ? uint16(bytes, offset + 2) : null
      const markerText = marker === null ? '窗口外' : marker === MACRO_ENTRY_MARKER ? '35 00（命中）' : `0x${hex(marker, 4)}（未命中）`
      const endText = actionCount === null ? '' : ` entry_end=0x${hex(offset + MACRO_ENTRY_HEADER_SIZE + actionCount * MACRO_ACTION_SIZE, 4)}`
      lines.push(`    0x${hex(at)} → offset=0x${hex(offset, 4)} action_count=${actionCount ?? '窗口外'} marker=${markerText}${endText}`)
    }
  } else {
    lines.push(`  offset table            无法解析：entry_count=${entryCount} 超出 1–${MACRO_COUNT}，或样本长度不足 0x${hex(tableEnd)}`)
  }
  const markers: number[] = []
  for (let index = 0; index + 1 < bytes.length; index++) {
    if (bytes[index] === 0x35 && bytes[index + 1] === 0x00) markers.push(index)
  }
  lines.push(`  35 00 出现位置          ${markers.length ? markers.map(value => `0x${hex(value, 4)}`).join(' ') : '无'}`)
  lines.push('  hexdump：')
  lines.push(...hexDump(bytes, 128))
  return lines.join('\n')
}

export class MacroLayoutError extends Error {
  readonly header: Uint8Array
  readonly report: string

  constructor(message: string, header: Uint8Array) {
    super(message)
    this.name = 'MacroLayoutError'
    this.header = header.slice()
    this.report = inspectMacroHeader(this.header)
  }
}

export function macroUsedEnd(header: Uint8Array): number {
  if (header.length < 6 || header[0] !== 0xaa || header[1] !== 0x55) throw new MacroLayoutError('宏存储 Magic 无效', header)
  const usedEnd = uint16(header, 2)
  if (usedEnd < MACRO_MIN_STORAGE_SIZE || usedEnd > MAX_MACRO_STORAGE_SIZE) throw new MacroLayoutError(`宏存储 used_end 无效：${usedEnd}`, header)
  return usedEnd
}

export function parseMacroStorage(raw: Uint8Array): MacroStorage {
  const usedEnd = macroUsedEnd(raw)
  if (raw.length !== usedEnd) throw new Error(`宏数据长度 ${raw.length} 与 used_end ${usedEnd} 不一致`)
  const entryCount = uint16(raw, 4)
  if (entryCount < 1 || entryCount > MACRO_COUNT) throw new Error(`宏 entry 数量 ${entryCount} 超出 1–${MACRO_COUNT}`)
  const tableEnd = MACRO_OFFSET_TABLE + entryCount * 2
  if (tableEnd > usedEnd) throw new Error(`宏 offset table 末尾 0x${hex(tableEnd)} 越过 used_end`)
  const offsets = Array.from({ length: entryCount }, (_, index) => uint16(raw, MACRO_OFFSET_TABLE + index * 2))
  const entries = offsets.map((offset, index): MacroEntry => {
    const end = index + 1 < offsets.length ? offsets[index + 1] : usedEnd
    if (offset < tableEnd) throw new Error(`M${index + 1} offset 落在 offset table 内`)
    if (end < offset) throw new Error('宏 offsets 未按顺序递增')
    if (end - offset < MACRO_ENTRY_HEADER_SIZE) throw new Error(`M${index + 1} entry 长度不足`)
    const entry = raw.slice(offset, end)
    const actionCount = uint16(entry, 0)
    if (uint16(entry, 2) !== MACRO_ENTRY_MARKER) throw new Error(`M${index + 1} marker 无效`)
    if (actionCount > MACRO_ACTION_LIMIT) throw new Error(`M${index + 1} 超过 ${MACRO_ACTION_LIMIT} 条动作`)
    // 最后一个 entry 的声明长度必须正好落到 used_end，因此这里一并完成了收尾校验。
    if (entry.length !== MACRO_ENTRY_HEADER_SIZE + actionCount * MACRO_ACTION_SIZE) throw new Error(`M${index + 1} action_count 与 entry 长度不一致`)
    const actions: MacroAction[] = []
    let editable = true
    for (let actionIndex = 0; actionIndex < actionCount; actionIndex++) {
      const position = MACRO_ENTRY_HEADER_SIZE + actionIndex * MACRO_ACTION_SIZE
      const eventType = entry[position + 2]
      if (eventType !== 0x8a && eventType !== 0x0a) editable = false
      actions.push({ delayMs: uint16(entry, position), pressed: eventType === 0x8a, usage: entry[position + 3] })
    }
    return { raw: entry, actions, editable }
  })
  return { raw: raw.slice(), usedEnd, entryCount, offsets, entries }
}

/**
 * 环境只送来了抬起事件时（输入法把字母键的按下截成 `Process / keyCode 229`，或宿主只放行 keyup），
 * 把一次敲击补录成「按下 + 抬起」两条动作，至少让宏可用。
 * 这不是真实按住时长，界面会明确标注为补录。
 */
export function synthesizeTapActions(usage: number, pressDelayMs: number, tapDurationMs: number): MacroAction[] {
  return [
    { delayMs: Math.min(0xffff, Math.max(1, Math.round(pressDelayMs))), pressed: true, usage },
    { delayMs: Math.min(0xffff, Math.max(0, Math.round(tapDurationMs))), pressed: false, usage },
  ]
}

export function serializeMacroEntry(actions: MacroAction[]): Uint8Array {
  if (actions.length > MACRO_ACTION_LIMIT) throw new Error(`每个宏最多 ${MACRO_ACTION_LIMIT} 条动作`)
  const entry = new Uint8Array(MACRO_ENTRY_HEADER_SIZE + actions.length * MACRO_ACTION_SIZE)
  setUint16(entry, 0, actions.length)
  setUint16(entry, 2, MACRO_ENTRY_MARKER)
  actions.forEach((action, index) => {
    if (!Number.isInteger(action.delayMs) || action.delayMs < 0 || action.delayMs > 0xffff) throw new Error('宏延时必须在 0–65535 ms 之间')
    if (!Number.isInteger(action.usage) || action.usage < 0 || action.usage > 0xff) throw new Error('宏 HID Usage 无效')
    const position = MACRO_ENTRY_HEADER_SIZE + index * MACRO_ACTION_SIZE
    setUint16(entry, position, action.delayMs)
    entry[position + 2] = action.pressed ? 0x8a : 0x0a
    entry[position + 3] = action.usage
  })
  return entry
}

/**
 * 替换某个槽位的动作，并重建 entry_count / offsets / used_end。
 * 目标槽位不存在时按空 entry 补齐，让 M 编号始终等于 storage 里的 entry 序号；
 * 已存在的 entry 不会被重新编号，清空槽位也不会删除该 entry。
 */
export function replaceMacro(storage: MacroStorage, macroIndex: number, actions: MacroAction[]): Uint8Array {
  if (!Number.isInteger(macroIndex) || macroIndex < 0 || macroIndex >= MACRO_COUNT) throw new Error('宏槽位索引无效')
  const entryBytes = storage.entries.map(entry => entry.raw)
  while (entryBytes.length <= macroIndex) entryBytes.push(serializeMacroEntry([]))
  entryBytes[macroIndex] = serializeMacroEntry(actions)
  const entryCount = entryBytes.length
  const tableEnd = MACRO_OFFSET_TABLE + entryCount * 2
  const usedEnd = tableEnd + entryBytes.reduce((total, entry) => total + entry.length, 0)
  if (usedEnd > MAX_MACRO_STORAGE_SIZE) throw new Error('宏数据超过安全存储范围')
  const output = new Uint8Array(usedEnd)
  output.set(storage.raw.slice(0, MACRO_HEADER_FIXED_SIZE))
  setUint16(output, 2, usedEnd)
  setUint16(output, 4, entryCount)
  let offset = tableEnd
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

// 旧式 keyCode → HID usage。只在 `code` 缺失时作为降级路径使用，值域与 codeUsages 保持一致。
const legacyKeyCodeUsages: Record<number, number> = {}
for (let index = 0; index < 26; index++) legacyKeyCodeUsages[65 + index] = 0x04 + index
for (let index = 1; index <= 9; index++) legacyKeyCodeUsages[48 + index] = 0x1d + index
legacyKeyCodeUsages[48] = 0x27

export type KeySource = 'code' | 'keyCode' | 'key'
export type KeyResolution = { usage: number | null; source: KeySource | null }

/**
 * 把浏览器键盘事件解析成 HID usage。
 *
 * 标准 `KeyboardEvent.code` 是最可靠的来源，但存在两个已知缺口：
 * 1. 部分内嵌浏览器 / 虚拟键盘不填 `code`，只有旧式 `keyCode`；
 * 2. 输入法处于组合输入时 `keyCode` 会是 229，字母键也可能拿不到 `code`。
 * 因此按 `code` → `keyCode` → `key` 依次降级，三条路都命中不了才算未映射。
 * 未映射不会静默丢弃，调用方会把实际收到的键显示出来。
 */
export function resolveKeyUsage(event: { code?: string | null; keyCode?: number | null; key?: string | null }): KeyResolution {
  if (event.code) {
    const mapped = usageForCode(event.code)
    if (mapped !== null) return { usage: mapped, source: 'code' }
  }
  const legacy = event.keyCode === undefined || event.keyCode === null ? undefined : legacyKeyCodeUsages[event.keyCode]
  if (legacy !== undefined) return { usage: legacy, source: 'keyCode' }
  const key = event.key
  if (key && key.length === 1) {
    const upper = key.toUpperCase()
    if (upper >= 'A' && upper <= 'Z') return { usage: 0x04 + (upper.charCodeAt(0) - 0x41), source: 'key' }
    if (key >= '0' && key <= '9') return { usage: key === '0' ? 0x27 : 0x1d + Number(key), source: 'key' }
  }
  return { usage: null, source: null }
}

/** 录制监视用的单行描述：code / key / keyCode 与解析结果。 */
export function describeKeyEvent(event: { code?: string | null; keyCode?: number | null; key?: string | null }, resolution: KeyResolution): string {
  const raw = `${event.code || '无 code'} / ${event.key || '无 key'} / keyCode ${event.keyCode ?? '—'}`
  if (resolution.usage === null) return `${raw} → 未映射`
  const name = usageLabel(resolution.usage)
  const path = resolution.source === 'code' ? '' : `（经 ${resolution.source} 降级解析）`
  return `${raw} → ${name}${path}`
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
