import {
  BEGIN_FRAME, CURRENT_CONFIG_FRAME, END_FRAME, KEYMAP_SIZE, PRODUCT_ID, REPORT_ID, USAGE, USAGE_PAGE, VENDOR_ID,
  chunks, lightPacket, parseReadResponse, readPacket, setPacket, validateKeymap, type Lighting,
} from './protocol'
import {
  MACRO_GET, MACRO_HEADER_PROBE, MACRO_SET, macroChunks, macroPacket, macroUsedEnd, parseMacroResponse, parseMacroStorage,
} from './macro'

export type HidInputEvent = { reportId: number; data: DataView }
export type HidCollection = { usagePage: number; usage: number; inputReports: Array<{ reportId: number }>; outputReports: Array<{ reportId: number }> }
export type HidDevice = {
  vendorId: number
  productId: number
  productName: string
  opened: boolean
  collections: HidCollection[]
  open(): Promise<void>
  close(): Promise<void>
  sendReport(reportId: number, data: Uint8Array): Promise<void>
  addEventListener(type: 'inputreport', listener: (event: HidInputEvent) => void): void
  removeEventListener(type: 'inputreport', listener: (event: HidInputEvent) => void): void
}

export type HidApi = {
  requestDevice(options: { filters: Array<{ vendorId: number; productId: number; usagePage: number; usage: number }> }): Promise<HidDevice[]>
  getDevices(): Promise<HidDevice[]>
  addEventListener(type: 'disconnect', listener: (event: { device: HidDevice }) => void): void
  removeEventListener(type: 'disconnect', listener: (event: { device: HidDevice }) => void): void
}

export function hidApi(): HidApi | null {
  return (navigator as Navigator & { hid?: HidApi }).hid ?? null
}

export function isLeo87(device: HidDevice): boolean {
  return device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID && device.collections.some(collection =>
    collection.usagePage === USAGE_PAGE && collection.usage === USAGE &&
    collection.inputReports.some(report => report.reportId === REPORT_ID) &&
    collection.outputReports.some(report => report.reportId === REPORT_ID),
  )
}

export async function requestLeo87(api: HidApi): Promise<HidDevice | null> {
  const devices = await api.requestDevice({ filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID, usagePage: USAGE_PAGE, usage: USAGE }] })
  return devices.find(isLeo87) ?? null
}

export async function rememberedLeo87(api: HidApi): Promise<HidDevice | null> {
  return (await api.getDevices()).find(isLeo87) ?? null
}

export class Leo87Connection {
  readonly device: HidDevice
  private active = false

  constructor(device: HidDevice) {
    if (!isLeo87(device)) throw new Error('设备不具备 Leo87 配置通道')
    this.device = device
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open()
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close()
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active) throw new Error('设备正在执行另一项操作')
    this.active = true
    try { return await operation() } finally { this.active = false }
  }

  private async receiveRead(command: 0x07 | 0x08, offset: number, length: number, timeoutMs = 1200): Promise<Uint8Array> {
    let listener: ((event: HidInputEvent) => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const response = new Promise<Uint8Array>((resolve, reject) => {
      listener = event => {
        if (event.reportId !== REPORT_ID) return
        try {
          const payload = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
          // SET/事务确认也通过 Report 4 到达；等待 GET 时忽略这些独立响应。
          if (payload[2] !== command) return
          resolve(parseReadResponse(payload, command, offset, length))
        } catch (error) {
          const header = Array.from(new Uint8Array(event.data.buffer, event.data.byteOffset, Math.min(event.data.byteLength, 7)))
            .map(value => value.toString(16).padStart(2, '0')).join(' ')
          reject(new Error(`${error instanceof Error ? error.message : String(error)}；响应头 ${header}`))
        }
      }
      this.device.addEventListener('inputreport', listener)
      timer = setTimeout(() => reject(new Error(`读取 0x${offset.toString(16).padStart(4, '0')} 超时`)), timeoutMs)
      void this.device.sendReport(REPORT_ID, readPacket(command, offset, length)).catch(reject)
    })
    try {
      return await response
    } finally {
      if (timer) clearTimeout(timer)
      if (listener) this.device.removeEventListener('inputreport', listener)
    }
  }

  private async receiveMacro(command: typeof MACRO_GET | typeof MACRO_SET, offset: number, length: number, data?: Uint8Array, timeoutMs = 1200): Promise<Uint8Array> {
    let listener: ((event: HidInputEvent) => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const request = macroPacket(command, offset, length, data)
    const response = new Promise<Uint8Array>((resolve, reject) => {
      listener = event => {
        if (event.reportId !== REPORT_ID) return
        try {
          const payload = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
          if (payload[2] !== command) return
          const received = parseMacroResponse(payload, command, offset, length)
          if (data && received.some((value, index) => value !== data[index])) throw new Error(`宏 SET 回显数据不一致：offset=0x${offset.toString(16)}`)
          resolve(received)
        } catch (error) {
          reject(error)
        }
      }
      this.device.addEventListener('inputreport', listener)
      timer = setTimeout(() => reject(new Error(`宏数据 0x${offset.toString(16).padStart(4, '0')} ${command === MACRO_GET ? '读取' : '写入'}超时`)), timeoutMs)
      void this.device.sendReport(REPORT_ID, request).catch(reject)
    })
    try {
      return await response
    } finally {
      if (timer) clearTimeout(timer)
      if (listener) this.device.removeEventListener('inputreport', listener)
    }
  }

  private async readMacroRange(length: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(length)
    for (const chunk of macroChunks(length)) bytes.set(await this.receiveMacro(MACRO_GET, chunk.offset, chunk.length), chunk.offset)
    return bytes
  }

  private async readMacroStorageUnlocked(): Promise<Uint8Array> {
    // 首次探测只取 Header 窗口。此处的解析失败会带上原始样本（MacroLayoutError.header），
    // 供页面导出与诊断使用，不在此处丢弃。
    const first = await this.receiveMacro(MACRO_GET, 0, MACRO_HEADER_PROBE)
    const usedEnd = macroUsedEnd(first)
    const bytes = new Uint8Array(usedEnd)
    bytes.set(first.slice(0, Math.min(first.length, usedEnd)))
    for (const chunk of macroChunks(usedEnd).slice(1)) bytes.set(await this.receiveMacro(MACRO_GET, chunk.offset, chunk.length), chunk.offset)
    return bytes
  }

  private async readCurrentKeymap(): Promise<Uint8Array> {
    await this.device.sendReport(REPORT_ID, BEGIN_FRAME)
    try {
      await this.device.sendReport(REPORT_ID, CURRENT_CONFIG_FRAME)
      const keymap = new Uint8Array(KEYMAP_SIZE)
      for (const { offset, length } of chunks()) keymap.set(await this.receiveRead(0x08, offset, length), offset)
      return keymap
    } finally {
      await this.device.sendReport(REPORT_ID, END_FRAME)
    }
  }

  async readKeymap(): Promise<Uint8Array> {
    return this.exclusive(async () => {
      // 原厂兼容网页在连接初始化时通过 0x08 读取当前生效配置。
      // 0x07 保留为旧固件兼容回退。
      try {
        return await this.readCurrentKeymap()
      } catch {
        const keymap = new Uint8Array(KEYMAP_SIZE)
        for (const { offset, length } of chunks()) keymap.set(await this.receiveRead(0x07, offset, length), offset)
        return keymap
      }
    })
  }

  async setLighting(lighting: Lighting): Promise<void> {
    return this.exclusive(async () => {
      await this.device.sendReport(REPORT_ID, BEGIN_FRAME)
      await this.device.sendReport(REPORT_ID, lightPacket(lighting))
      await this.device.sendReport(REPORT_ID, END_FRAME)
    })
  }

  async readMacroStorage(): Promise<Uint8Array> {
    return this.exclusive(() => this.readMacroStorageUnlocked())
  }

  async writeMacroAndVerify(storage: Uint8Array): Promise<Uint8Array> {
    parseMacroStorage(storage)
    return this.exclusive(async () => {
      // 写入前先确认目标地址范围全部可读；增长不能越过未经设备确认的范围。
      await this.readMacroRange(storage.length)
      for (const chunk of macroChunks(storage.length)) {
        const data = storage.slice(chunk.offset, chunk.offset + chunk.length)
        await this.receiveMacro(MACRO_SET, chunk.offset, chunk.length, data)
      }
      const actual = await this.readMacroStorageUnlocked()
      const mismatch = actual.length !== storage.length ? Math.min(actual.length, storage.length) : actual.findIndex((value, index) => value !== storage[index])
      if (mismatch >= 0) throw new Error(`宏写入后回读不一致，首个差异位于 0x${mismatch.toString(16).padStart(4, '0')}`)
      return actual
    })
  }

  async writeAndVerify(keymap: Uint8Array): Promise<{
    readback: Uint8Array | null
    mismatchOffset: number | null
    readError: string | null
  }> {
    validateKeymap(keymap)
    return this.exclusive(async () => {
      await this.device.sendReport(REPORT_ID, BEGIN_FRAME)
      for (const { offset, length } of chunks()) {
        await this.device.sendReport(REPORT_ID, setPacket(offset, keymap.slice(offset, offset + length)))
      }
      await this.device.sendReport(REPORT_ID, END_FRAME)
      try {
        // Commit 后重新开启读取事务，使用 0x08 获取设备当前生效配置。
        const actual = await this.readCurrentKeymap()
        const mismatchOffset = actual.findIndex((value, index) => value !== keymap[index])
        return { readback: actual, mismatchOffset: mismatchOffset < 0 ? null : mismatchOffset, readError: null }
      } catch (error) {
        return { readback: null, mismatchOffset: null, readError: error instanceof Error ? error.message : String(error) }
      }
    })
  }
}
