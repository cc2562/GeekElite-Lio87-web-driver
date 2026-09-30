const STORAGE_KEY = 'leo87:custom-palette:v1'

/** 我的色板上限，避免无限增长。 */
export const MAX_PALETTE_COLORS = 24

const HEX = /^#[0-9A-F]{6}$/

export type CustomPalette = { colors: string[]; savedAt: string }

/** 统一成 `#RRGGBB` 大写形式。 */
export function normalizeHex(hex: string): string {
  const value = hex.trim().toUpperCase()
  return value.startsWith('#') ? value : `#${value}`
}

/**
 * 用户自定义色板。
 *
 * 与逐键颜色表一样，设备端没有对应的存储，因此只保存在当前站点的 localStorage：
 * 记录用户在「逐键颜色」里手动加入的颜色，去重并限制数量。
 */
export function loadPalette(): CustomPalette | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { colors: unknown; savedAt: string }
    if (!Array.isArray(parsed.colors)) return null
    const colors = [...new Set(parsed.colors.filter((color): color is string => typeof color === 'string' && HEX.test(normalizeHex(color))).map(normalizeHex))]
    if (colors.length === 0) return null
    return { colors: colors.slice(0, MAX_PALETTE_COLORS), savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

/** 覆盖写入色板；返回落库后的实际内容（已去重、截断）。 */
export function savePalette(colors: string[]): CustomPalette {
  const unique = [...new Set(colors.map(normalizeHex).filter(color => HEX.test(color)))].slice(0, MAX_PALETTE_COLORS)
  const savedAt = new Date().toISOString()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ colors: unique, savedAt }))
  return { colors: unique, savedAt }
}
