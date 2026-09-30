/** 灯效 ID 的十六进制展示，如 `0x06`。 */
export function effectHex(id: number): string {
  return `0x${id.toString(16).padStart(2, '0').toUpperCase()}`
}

/** 本地化时间戳（24 小时制），用于备份时间等展示。 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}
