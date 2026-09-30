import { afterEach, describe, expect, it, vi } from 'vitest'
import { Leo87Connection, type HidDevice, type HidInputEvent } from './device'
import { chunks, readPacket } from './protocol'
import { macroPacket, parseMacroStorage, replaceMacro, serializeMacroEntry } from './macro'

function sampleMacroStorage(): Uint8Array {
  const offsets = [0x24, 0x28, 0x34, 0x38, 0x3c, 0x40, 0x44, 0x48, 0x4c, 0x50]
  const bytes = new Uint8Array(0x54)
  bytes.set([0xaa, 0x55, 0x54, 0, 10, 0])
  offsets.forEach((offset, index) => bytes.set([offset, 0], 0x10 + index * 2))
  offsets.forEach((offset, index) => bytes.set(index === 1
    ? serializeMacroEntry([{ delayMs: 1, pressed: true, usage: 4 }, { delayMs: 0, pressed: false, usage: 4 }])
    : serializeMacroEntry([]), offset))
  return bytes
}

class FakeDevice implements HidDevice {
  vendorId = 0x320f
  productId = 0x5055
  productName = 'GeekElite Leo87'
  opened = false
  collections = [{ usagePage: 0xff1c, usage: 0x92, inputReports: [{ reportId: 4 }], outputReports: [{ reportId: 4 }] }]
  reports: Uint8Array[] = []
  memory = Uint8Array.from({ length: 384 }, (_, i) => i & 0xff)
  failAtSet = -1
  wrongOffset = false
  acknowledgeWrites = false
  staleGet = false
  macroMemory = new Uint8Array(4096)
  failAtMacroSet = -1
  macroWrongOffset = false
  macroIgnoreWrites = false
  suppressMacroResponses = false
  private listeners = new Set<(event: HidInputEvent) => void>()
  constructor() { this.macroMemory.set(sampleMacroStorage()) }
  async open() { this.opened = true }
  async close() { this.opened = false }
  addEventListener(_type: 'inputreport', listener: (event: HidInputEvent) => void) { this.listeners.add(listener) }
  removeEventListener(_type: 'inputreport', listener: (event: HidInputEvent) => void) { this.listeners.delete(listener) }
  async sendReport(reportId: number, data: Uint8Array) {
    expect(reportId).toBe(4)
    this.reports.push(data.slice())
    const command = data[2]
    if (command === 9) {
      if (this.reports.filter(item => item[2] === 9).length === this.failAtSet) throw new Error('模拟写入中断')
      this.memory.set(data.slice(7, 7 + data[3]), data[4] | data[5] << 8)
      if (this.acknowledgeWrites) {
        const payload = data.slice()
        queueMicrotask(() => this.listeners.forEach(listener => listener({ reportId: 4, data: new DataView(payload.buffer) })))
      }
    }
    if (command === 7 || command === 8) {
      const offset = data[4] | data[5] << 8
      const payload = readPacket(command, offset, data[3])
      payload.set(this.staleGet ? new Uint8Array(data[3]) : this.memory.slice(offset, offset + data[3]), 7)
      if (this.wrongOffset) payload[4] ^= 1
      queueMicrotask(() => {
        const event = { reportId: 4, data: new DataView(payload.buffer) }
        this.listeners.forEach(listener => listener(event))
      })
    }
    if (command === 0x14) {
      if (this.suppressMacroResponses) return
      const offset = data[4] | data[5] << 8
      const payload = macroPacket(0x14, offset, data[3])
      payload.set(this.macroMemory.slice(offset, offset + data[3]), 7)
      if (this.macroWrongOffset) payload[4] ^= 1
      queueMicrotask(() => this.listeners.forEach(listener => listener({ reportId: 4, data: new DataView(payload.buffer) })))
    }
    if (command === 0x15) {
      if (this.suppressMacroResponses) return
      const setCount = this.reports.filter(item => item[2] === 0x15).length
      if (setCount === this.failAtMacroSet) throw new Error('模拟宏写入中断')
      const offset = data[4] | data[5] << 8
      const body = data.slice(7, 7 + data[3])
      if (!this.macroIgnoreWrites) this.macroMemory.set(body, offset)
      const payload = macroPacket(0x15, offset, data[3], body)
      queueMicrotask(() => this.listeners.forEach(listener => listener({ reportId: 4, data: new DataView(payload.buffer) })))
    }
  }
}

describe('Leo87Connection', () => {
  afterEach(() => vi.useRealTimers())
  it('读取完整键位并逐段验证', async () => {
    const fake = new FakeDevice()
    const connection = new Leo87Connection(fake)
    await connection.open()
    expect(await connection.readKeymap()).toEqual(fake.memory)
    expect(fake.reports.map(report => report[2])).toEqual([1, 3, ...Array(7).fill(8), 2])
  })

  it('写入时始终发送完整七段并回读', async () => {
    const fake = new FakeDevice()
    fake.acknowledgeWrites = true
    const connection = new Leo87Connection(fake)
    const target = new Uint8Array(384).fill(0x20)
    expect(await connection.writeAndVerify(target)).toEqual({ readback: target, mismatchOffset: null, readError: null })
    expect(fake.reports.map(report => report[2])).toEqual([1, ...Array(7).fill(9), 2, 1, 3, ...Array(7).fill(8), 2])
    expect(fake.reports.filter(report => report[2] === 9).map(report => report[3])).toEqual(chunks().map(chunk => chunk.length))
    expect(fake.reports.filter(report => report[2] === 7)).toHaveLength(0)
  })

  it('中途失败不发送 Commit；错位响应被拒绝', async () => {
    const fake = new FakeDevice()
    fake.failAtSet = 2
    const connection = new Leo87Connection(fake)
    await expect(connection.writeAndVerify(new Uint8Array(384))).rejects.toThrow('模拟写入中断')
    expect(fake.reports.map(report => report[2])).toEqual([1, 9, 9])
    fake.wrongOffset = true
    await expect(connection.readKeymap()).rejects.toThrow('不匹配')
  })

  it('0x08 回读未反映写入时报告待确认，而非断言设备未写入', async () => {
    const fake = new FakeDevice()
    fake.staleGet = true
    const result = await new Leo87Connection(fake).writeAndVerify(new Uint8Array(384).fill(0x20))
    expect(result.mismatchOffset).toBe(0)
    expect(result.readError).toBeNull()
    expect(fake.reports.filter(report => report[2] === 9)).toHaveLength(7)
  })

  it('Commit 后的 0x08 回读异常被标为未确认，不再误报写入中断', async () => {
    const fake = new FakeDevice()
    fake.wrongOffset = true
    const result = await new Leo87Connection(fake).writeAndVerify(new Uint8Array(384))
    expect(result.readback).toBeNull()
    expect(result.readError).toContain('不匹配')
    expect(fake.reports.some(report => report[2] === 2)).toBe(true)
  })

  it('按 used_end 分段读取完整宏存储', async () => {
    const fake = new FakeDevice()
    const result = await new Leo87Connection(fake).readMacroStorage()
    expect(result).toEqual(sampleMacroStorage())
    expect(fake.reports.map(report => [report[2], report[3], report[4]])).toEqual([[0x14, 56, 0], [0x14, 28, 56]])
  })

  it('写宏前探测范围，完整写入并回读验证', async () => {
    const fake = new FakeDevice()
    const original = parseMacroStorage(sampleMacroStorage())
    const target = replaceMacro(original, 0, Array.from({ length: 20 }, (_, index) => ({ delayMs: index, pressed: index % 2 === 0, usage: 4 })))
    const result = await new Leo87Connection(fake).writeMacroAndVerify(target)
    expect(result).toEqual(target)
    expect(fake.reports.filter(report => report[2] === 0x15)).toHaveLength(Math.ceil(target.length / 56))
    expect(fake.reports.findIndex(report => report[2] === 0x15)).toBeGreaterThanOrEqual(Math.ceil(target.length / 56))
  })

  it('宏写入中断或回读不一致时停止且不发送 keymap SET', async () => {
    const failed = new FakeDevice()
    failed.failAtMacroSet = 2
    const target = replaceMacro(parseMacroStorage(sampleMacroStorage()), 0, Array.from({ length: 20 }, () => ({ delayMs: 1, pressed: true, usage: 4 })))
    await expect(new Leo87Connection(failed).writeMacroAndVerify(target)).rejects.toThrow('模拟宏写入中断')
    expect(failed.reports.filter(report => report[2] === 0x15)).toHaveLength(2)
    expect(failed.reports.some(report => report[2] === 9)).toBe(false)

    const stale = new FakeDevice()
    stale.macroIgnoreWrites = true
    await expect(new Leo87Connection(stale).writeMacroAndVerify(target)).rejects.toThrow('回读不一致')
    expect(stale.reports.some(report => report[2] === 9)).toBe(false)
  })

  it('宏错位响应被拒绝', async () => {
    const fake = new FakeDevice()
    fake.macroWrongOffset = true
    await expect(new Leo87Connection(fake).readMacroStorage()).rejects.toThrow('不匹配')
  })

  it('宏读取超时后停止等待', async () => {
    vi.useFakeTimers()
    const fake = new FakeDevice()
    fake.suppressMacroResponses = true
    const assertion = expect(new Leo87Connection(fake).readMacroStorage()).rejects.toThrow('读取超时')
    await vi.advanceTimersByTimeAsync(1200)
    await assertion
    expect(fake.reports.filter(report => report[2] === 0x14)).toHaveLength(1)
  })
})
