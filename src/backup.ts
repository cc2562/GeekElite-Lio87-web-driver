import { KEYMAP_SIZE, validateKeymap } from './protocol'

const STORAGE_KEY = 'leo87:first-read-backup:v1'

export type Backup = { bytes: Uint8Array; createdAt: string }

export function loadBackup(): Backup | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { bytes: number[]; createdAt: string }
    if (!Array.isArray(parsed.bytes) || parsed.bytes.length !== KEYMAP_SIZE || parsed.bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null
    return { bytes: Uint8Array.from(parsed.bytes), createdAt: parsed.createdAt }
  } catch { return null }
}

export function saveFirstBackup(bytes: Uint8Array): Backup {
  validateKeymap(bytes)
  const existing = loadBackup()
  if (existing) return existing
  const createdAt = new Date().toISOString()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ bytes: Array.from(bytes), createdAt }))
  const saved = loadBackup()
  if (!saved) throw new Error('无法保存首次读取备份；已阻止改键')
  return saved
}

export function downloadKeymap(bytes: Uint8Array, name: string): void {
  validateKeymap(bytes)
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
