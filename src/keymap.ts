import { recordAt, type KeyRecord } from './protocol'
import { macroTriggerDescription } from './macro'

export type Action = { id: string; label: string; record: KeyRecord; group: string }
export type KeySpec = { index: number; label: string; width?: number; gap?: number; locked?: boolean }

const keyboard = (usage: number, label: string, group = '标准按键'): Action => ({ id: `kbd-${usage.toString(16)}`, label, record: [0x20, 0, usage], group })
const modifier = (mask: number, label: string): Action => ({ id: `mod-${mask.toString(16)}`, label, record: [0x20, mask, 0], group: '修饰键' })

export const ACTIONS: Action[] = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((label, i) => keyboard(i + 0x04, label)),
  ...'1234567890'.split('').map((label, i) => keyboard(i + 0x1e, label)),
  ...[
    [0x28, 'Enter'], [0x29, 'Esc'], [0x2a, 'Backspace'], [0x2b, 'Tab'], [0x2c, 'Space'],
    [0x2d, '-'], [0x2e, '='], [0x2f, '['], [0x30, ']'], [0x31, '\\'], [0x33, ';'], [0x34, "'"],
    [0x35, '`'], [0x36, ','], [0x37, '.'], [0x38, '/'], [0x39, 'Caps Lock'],
  ].map(([usage, label]) => keyboard(usage as number, label as string)),
  ...Array.from({ length: 12 }, (_, i) => keyboard(i + 0x3a, `F${i + 1}`, '功能键')),
  ...[
    [0x46, 'Print Screen'], [0x47, 'Scroll Lock'], [0x48, 'Pause'], [0x49, 'Insert'],
    [0x4a, 'Home'], [0x4b, 'Page Up'], [0x4c, 'Delete'], [0x4d, 'End'], [0x4e, 'Page Down'],
    [0x4f, '→'], [0x50, '←'], [0x51, '↓'], [0x52, '↑'], [0x65, 'Menu'],
  ].map(([usage, label]) => keyboard(usage as number, label as string, '导航与系统')),
  modifier(0x01, '左 Ctrl'), modifier(0x02, '左 Shift'), modifier(0x04, '左 Alt'), modifier(0x08, '左 Win'),
  modifier(0x10, '右 Ctrl'), modifier(0x20, '右 Shift'), modifier(0x40, '右 Alt'),
  { id: 'media-volume-up', label: '音量 +', record: [0x30, 0xe9, 0], group: '媒体键' },
  { id: 'media-volume-down', label: '音量 −', record: [0x30, 0xea, 0], group: '媒体键' },
  { id: 'media-prev', label: '上一曲', record: [0x30, 0xb6, 0], group: '媒体键' },
  { id: 'media-next', label: '下一曲', record: [0x30, 0xb5, 0], group: '媒体键' },
]

export function actionFor(record: KeyRecord): Action | undefined {
  return ACTIONS.find(action => action.record.every((value, i) => value === record[i]))
}

export const KEY_ROWS: KeySpec[][] = [
  [
    { index: 0, label: 'Esc' }, ...Array.from({ length: 12 }, (_, i) => ({ index: i + 1, label: `F${i + 1}`, gap: [1, 5, 9].includes(i + 1) ? 0.5 : 0 })),
    { index: 13, label: 'PrtSc', gap: 0.6 }, { index: 14, label: 'ScrLk' }, { index: 15, label: 'Pause' },
  ],
  [
    { index: 16, label: '`' }, ...'1234567890'.split('').map((label, i) => ({ index: i + 17, label })),
    { index: 27, label: '-' }, { index: 28, label: '=' }, { index: 29, label: 'Backspace', width: 2 },
    { index: 30, label: 'Ins', gap: 0.6 }, { index: 31, label: 'Home' }, { index: 62, label: 'PgUp' },
  ],
  [
    { index: 32, label: 'Tab', width: 1.5 }, ...'QWERTYUIOP'.split('').map((label, i) => ({ index: i + 33, label })),
    { index: 43, label: '[' }, { index: 44, label: ']' }, { index: 45, label: '\\', width: 1.5 },
    { index: 46, label: 'Del', gap: 0.6 }, { index: 47, label: 'End' }, { index: 63, label: 'PgDn' },
  ],
  [
    { index: 48, label: 'Caps', width: 1.8 }, ...'ASDFGHJKL'.split('').map((label, i) => ({ index: i + 49, label })),
    { index: 58, label: ';' }, { index: 59, label: "'" }, { index: 61, label: 'Enter', width: 2.2 },
  ],
  [
    { index: 64, label: 'Shift', width: 2.3 }, ...'ZXCVBNM'.split('').map((label, i) => ({ index: i + 66, label })),
    { index: 73, label: ',' }, { index: 74, label: '.' }, { index: 75, label: '/' },
    { index: 76, label: 'Shift', width: 2.7 }, { index: 78, label: '↑', gap: 2.8 },
  ],
  [
    { index: 80, label: 'Ctrl', width: 1.4 }, { index: 81, label: 'Win', width: 1.3 },
    { index: 82, label: 'Alt', width: 1.3 }, { index: 86, label: 'Space', width: 6.2 },
    { index: 89, label: 'Alt', width: 1.3 }, { index: 91, label: 'Menu', width: 1.3 },
    { index: 92, label: 'Ctrl', width: 1.4 }, { index: 93, label: '←', gap: 0.6 },
    { index: 94, label: '↓' }, { index: 95, label: '→' },
  ],
]

// 记录 62/63 在 dump 中为 PageUp/PageDown，但其实体位置尚未得到确认：布局展示仍保留索引供核对。
export const DISPLAYED_INDICES = new Set(KEY_ROWS.flat().map(key => key.index).concat([83, 84, 85, 87]))

export function canEdit(_keymap: Uint8Array, index: number): boolean {
  return DISPLAYED_INDICES.has(index)
}

/** 把一条 record 转成面向用户的可读动作名。 */
export function describeRecord(record: KeyRecord): string {
  if (record[0] === 0xa0 && record[1] === 0x40 && record[2] === 0) return '音量 +'
  if (record[0] === 0xa0 && record[1] === 0x45 && record[2] === 0) return '音量 −'
  return actionFor(record)?.label ?? macroTriggerDescription(record) ?? '未知动作'
}

export function recordDescription(keymap: Uint8Array, index: number): string {
  const record = recordAt(keymap, index)
  if (index === 83 && record[0] === 0xa0 && record[1] === 0x40 && record[2] === 0) return '音量 +（内置滚轮动作）'
  if (index === 84 && record[0] === 0xa0 && record[1] === 0x45 && record[2] === 0) return '音量 −（内置滚轮动作）'
  return describeRecord(record)
}

export function keyLabel(index: number): string {
  if (index === 83) return '滚轮 · 向上'
  if (index === 84) return '滚轮 · 向下'
  if (index === 85) return '侧键 · 上一曲'
  if (index === 87) return '侧键 · 下一曲'
  return KEY_ROWS.flat().find(key => key.index === index)?.label ?? `Record ${index}`
}
