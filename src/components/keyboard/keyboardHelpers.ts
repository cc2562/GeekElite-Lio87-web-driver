import { ACTIONS, actionFor, recordDescription } from '@/keymap'
import { recordAt, type Rgb } from '@/protocol'

/** 键帽上显示的原厂短标签与动作全名之间的别名映射。 */
export const labelAliases: Record<string, string> = {
  PrtSc: 'Print Screen',
  ScrLk: 'Scroll Lock',
  Ins: 'Insert',
  Del: 'Delete',
  PgUp: 'Page Up',
  PgDn: 'Page Down',
  Caps: 'Caps Lock',
}

export type KeyAppearance = { label: string; changed: boolean }

/**
 * 计算某个键位在拟物键盘上的显示文本与「已更改」状态。
 *
 * - 已绑定普通动作：显示动作名；若与键帽原厂标签不同（修饰键别名除外）则标记为已更改。
 * - 已绑定板载宏：显示 `M1` 并标记为已更改。
 * - 其余情况：沿用键帽原厂标签，仅当存在待写入草稿时标记为已更改。
 */
export function keyAppearance(
  keymap: Uint8Array | null,
  index: number,
  originalLabel: string,
  pending: boolean,
): KeyAppearance {
  if (!keymap) return { label: originalLabel, changed: false }
  const action = actionFor(recordAt(keymap, index))
  if (!action) {
    const description = recordDescription(keymap, index)
    const macro = description.match(/^(M\d+) ·/)
    return macro ? { label: macro[1], changed: true } : { label: originalLabel, changed: pending }
  }
  const expected = labelAliases[originalLabel] ?? originalLabel
  const isModifierAlias = ['Ctrl', 'Shift', 'Alt', 'Win'].includes(originalLabel) && action.label.endsWith(originalLabel)
  const changed = pending || (action.label !== expected && !isModifierAlias)
  return { label: changed ? action.label : originalLabel, changed }
}

/** `00 00 00` 视为未设置颜色。是否等于「关闭该键灯光」尚待实机确认。 */
export function isUncolored(color: Rgb): boolean {
  return color.r === 0 && color.g === 0 && color.b === 0
}

/** 键帽的视觉状态：普通 / 选中 / 已更改 / 只读 / 逐键颜色。 */
export type KeycapState = 'default' | 'selected' | 'changed' | 'locked' | 'colored'

export function resolveKeycapState(options: {
  selected: boolean
  changed?: boolean
  locked?: boolean
  color?: Rgb | null
  colorMode?: boolean
}): KeycapState {
  if (options.selected) return 'selected'
  if (options.colorMode && options.color && !isUncolored(options.color)) return 'colored'
  if (options.locked) return 'locked'
  if (options.changed) return 'changed'
  return 'default'
}

/** 侧键 / 滚轮的 record 索引与对应媒体动作。 */
export const SIDE_ACTION_IDS: Record<number, string> = {
  83: 'media-volume-up',
  84: 'media-volume-down',
  85: 'media-prev',
  87: 'media-next',
}

/**
 * 把拟物键盘上的键帽标签映射回标准动作 ID。
 * 冲突的左右修饰键统一取左键版本。
 */
export function actionIdForLabel(label: string): string | undefined {
  const target = (labelAliases[label] ?? label).toLowerCase()
  const exact = ACTIONS.find(action => action.label.toLowerCase() === target)
  if (exact) return exact.id
  return ACTIONS.find(
    action => action.group === '修饰键' && action.label.replace(/^[左右]/, '').toLowerCase() === target,
  )?.id
}
