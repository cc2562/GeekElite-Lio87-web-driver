import { MAX_MACRO_STORAGE_SIZE, macroUsedEnd } from './macro'

const STORAGE_KEY = 'leo87:first-macro-backup:v1'

export type MacroBackup = { bytes: Uint8Array; createdAt: string }

function validateBackupBytes(bytes: Uint8Array): void {
  const usedEnd = macroUsedEnd(bytes)
  if (bytes.length !== usedEnd || bytes.length > MAX_MACRO_STORAGE_SIZE) throw new Error('宏备份长度无效')
}

export function loadMacroBackup(): MacroBackup | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { bytes: number[]; createdAt: string }
    if (!Array.isArray(parsed.bytes) || parsed.bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null
    const bytes = Uint8Array.from(parsed.bytes)
    validateBackupBytes(bytes)
    return { bytes, createdAt: parsed.createdAt }
  } catch { return null }
}

export function saveFirstMacroBackup(bytes: Uint8Array): MacroBackup {
  validateBackupBytes(bytes)
  const existing = loadMacroBackup()
  if (existing) return existing
  const createdAt = new Date().toISOString()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ bytes: Array.from(bytes), createdAt }))
  const saved = loadMacroBackup()
  if (!saved) throw new Error('无法保存首次宏备份；已阻止宏写入')
  return saved
}

export function downloadMacro(bytes: Uint8Array, name: string): void {
  validateBackupBytes(bytes)
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
