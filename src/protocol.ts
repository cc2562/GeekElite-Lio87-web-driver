export const VENDOR_ID = 0x320f
export const PRODUCT_ID = 0x5055
export const USAGE_PAGE = 0xff1c
export const USAGE = 0x0092
export const REPORT_ID = 0x04
export const PAYLOAD_SIZE = 63
export const KEYMAP_SIZE = 384
export const RECORD_SIZE = 3
export const CHUNK_SIZE = 56

export type Rgb = { r: number; g: number; b: number }
export type Lighting = { color: Rgb; brightness: number; rainbow: boolean }
export type KeyRecord = readonly [number, number, number]

export const BEGIN_FRAME = frame(0x01)
export const END_FRAME = frame(0x02)
export const CURRENT_CONFIG_FRAME = currentConfigFrame()

function frame(command: number): Uint8Array {
  const payload = new Uint8Array(PAYLOAD_SIZE)
  payload[2] = command
  return withChecksum(payload)
}

function currentConfigFrame(): Uint8Array {
  const payload = new Uint8Array(PAYLOAD_SIZE)
  payload[2] = 0x03
  payload[3] = 0x22
  return withChecksum(payload)
}

export function withChecksum(payload: Uint8Array): Uint8Array {
  if (payload.length !== PAYLOAD_SIZE) throw new Error('HID payload 必须为 63 字节')
  let checksum = 0
  for (let i = 2; i < PAYLOAD_SIZE; i++) checksum = (checksum + payload[i]) & 0xffff
  payload[0] = checksum & 0xff
  payload[1] = checksum >>> 8
  return payload
}

function byte(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`${name} 超出字节范围`)
  return value
}

export function lightPacket({ color, brightness, rainbow }: Lighting): Uint8Array {
  if (!Number.isInteger(brightness) || brightness < 0 || brightness > 4) throw new Error('亮度必须在 0–4 之间')
  const packet = new Uint8Array(PAYLOAD_SIZE)
  // 来自 docs/j键位结果.txt 中经过实机验证的静态红色样例。
  packet[2] = 0x06
  packet[3] = 0x27
  packet[8] = 0x06
  packet[9] = brightness
  packet[10] = 0x04
  packet[12] = rainbow ? 1 : 0
  packet[13] = byte(color.r, '红色')
  packet[14] = byte(color.g, '绿色')
  packet[15] = byte(color.b, '蓝色')
  packet[27] = 0xff
  packet[36] = 0x01
  return withChecksum(packet)
}

export function chunks(): Array<{ offset: number; length: number }> {
  const result = []
  for (let offset = 0; offset < KEYMAP_SIZE; offset += CHUNK_SIZE) {
    result.push({ offset, length: Math.min(CHUNK_SIZE, KEYMAP_SIZE - offset) })
  }
  return result
}

function keymapPacket(command: 0x07 | 0x08 | 0x09, offset: number, length: number, data?: Uint8Array): Uint8Array {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 1 || length > CHUNK_SIZE || offset + length > KEYMAP_SIZE) {
    throw new Error('无效的 keymap 分段')
  }
  if (command === 0x09 && data?.length !== length) throw new Error('SET 数据长度错误')
  const packet = new Uint8Array(PAYLOAD_SIZE)
  packet[2] = command
  packet[3] = length
  packet[4] = offset & 0xff
  packet[5] = offset >>> 8
  if (data) packet.set(data, 7)
  return withChecksum(packet)
}

export function readPacket(command: 0x07 | 0x08, offset: number, length: number): Uint8Array {
  return keymapPacket(command, offset, length)
}

export function getPacket(offset: number, length: number): Uint8Array {
  return readPacket(0x07, offset, length)
}

export function setPacket(offset: number, data: Uint8Array): Uint8Array {
  return keymapPacket(0x09, offset, data.length, data)
}

export function parseReadResponse(payload: Uint8Array, command: 0x07 | 0x08, offset: number, length: number): Uint8Array {
  if (payload.length !== PAYLOAD_SIZE) throw new Error('GET 响应长度错误')
  const request = readPacket(command, offset, length)
  if (payload[0] !== request[0] || payload[1] !== request[1] || payload[2] !== command || payload[3] !== length || payload[4] !== (offset & 0xff) || payload[5] !== (offset >>> 8) || payload[6] !== 0) {
    throw new Error(`GET 响应与请求不匹配：offset=0x${offset.toString(16)}`)
  }
  return payload.slice(7, 7 + length)
}

export function parseGetResponse(payload: Uint8Array, offset: number, length: number): Uint8Array {
  return parseReadResponse(payload, 0x07, offset, length)
}

export function validateKeymap(keymap: Uint8Array): void {
  if (keymap.length !== KEYMAP_SIZE) throw new Error('keymap 必须正好为 384 字节')
}

export function recordAt(keymap: Uint8Array, index: number): KeyRecord {
  validateKeymap(keymap)
  if (!Number.isInteger(index) || index < 0 || index >= KEYMAP_SIZE / RECORD_SIZE) throw new Error('record 索引错误')
  const i = index * RECORD_SIZE
  return [keymap[i], keymap[i + 1], keymap[i + 2]]
}

export function replaceRecord(keymap: Uint8Array, index: number, record: KeyRecord): Uint8Array {
  validateKeymap(keymap)
  if (!Number.isInteger(index) || index < 0 || index >= KEYMAP_SIZE / RECORD_SIZE) throw new Error('record 索引错误')
  const next = keymap.slice()
  next.set(record, index * RECORD_SIZE)
  return next
}

export function diffRecords(before: Uint8Array, after: Uint8Array): Array<{ index: number; before: KeyRecord; after: KeyRecord }> {
  validateKeymap(before)
  validateKeymap(after)
  const result = []
  for (let index = 0; index < 128; index++) {
    const oldRecord = recordAt(before, index)
    const newRecord = recordAt(after, index)
    if (oldRecord.some((value, i) => value !== newRecord[i])) result.push({ index, before: oldRecord, after: newRecord })
  }
  return result
}

export function hexRecord(record: KeyRecord): string {
  return record.map(value => value.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}
