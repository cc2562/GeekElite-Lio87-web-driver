import { COLOR_MAP_SIZE, validateColorMap } from './lighting'

const STORAGE_KEY = 'leo87:color-map:v1'

/**
 * 逐键颜色表的本地工作表。
 *
 * 设备没有颜色表的读取命令（协议笔记 §16 列为待确认），因此本地记录是唯一留档：
 * 保存的不是“设备首次读取备份”，而是当前编辑中的工作表。与 keymap / 宏一致存放在
 * 当前站点的 localStorage，并支持导出 / 导入 `.bin`。
 */
export type ColorMapBackup = { bytes: Uint8Array; savedAt: string }

function isByteArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
}

export function loadColorMap(): ColorMapBackup | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { bytes: unknown; savedAt: string }
    if (!isByteArray(parsed.bytes) || parsed.bytes.length !== COLOR_MAP_SIZE) return null
    const bytes = Uint8Array.from(parsed.bytes)
    validateColorMap(bytes)
    return { bytes, savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

export function saveColorMap(bytes: Uint8Array): ColorMapBackup {
  validateColorMap(bytes)
  const savedAt = new Date().toISOString()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ bytes: Array.from(bytes), savedAt }))
  const saved = loadColorMap()
  if (!saved) throw new Error('无法保存逐键颜色表')
  return saved
}

export function downloadColorMap(bytes: Uint8Array, name: string): void {
  validateColorMap(bytes)
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 导入文件必须恰好为 384 字节；校验通过后返回副本，避免调用方继续持有原引用。 */
export function importColorMapFile(bytes: Uint8Array): Uint8Array {
  validateColorMap(bytes)
  return bytes.slice()
}
