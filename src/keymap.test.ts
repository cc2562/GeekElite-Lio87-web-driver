import { describe, expect, it } from 'vitest'
import { ACTIONS, canEdit, keyLabel, recordDescription } from './keymap'
import { replaceRecord } from './protocol'

describe('键位与滚轮映射', () => {
  it('把相邻特殊 record 83/84 展示为滚轮上下并开放编辑', () => {
    let keymap: Uint8Array = new Uint8Array(384)
    keymap = replaceRecord(keymap, 83, [0xa0, 0x40, 0])
    keymap = replaceRecord(keymap, 84, [0xa0, 0x45, 0])
    expect(keyLabel(83)).toBe('滚轮 · 向上')
    expect(keyLabel(84)).toBe('滚轮 · 向下')
    expect(recordDescription(keymap, 83)).toBe('音量 +（内置滚轮动作）')
    expect(recordDescription(keymap, 84)).toBe('音量 −（内置滚轮动作）')
    expect(canEdit(keymap, 83)).toBe(true)
    expect(canEdit(keymap, 84)).toBe(true)
  })

  it('连接读取到改过的标准 record 后按当前值显示', () => {
    let keymap: Uint8Array = new Uint8Array(384)
    keymap = replaceRecord(keymap, 49, [0x20, 0, 0x05])
    expect(recordDescription(keymap, 49)).toBe('B')
    expect(canEdit(keymap, 49)).toBe(true)
  })

  it('显示在键盘图上的未知编码也允许重新指定', () => {
    const keymap = new Uint8Array(384)
    expect(recordDescription(keymap, 62)).toContain('未知')
    expect(canEdit(keymap, 62)).toBe(true)
  })

  it('提供经过实机输出确认的音量目标动作', () => {
    expect(ACTIONS.find(action => action.id === 'media-volume-up')?.record).toEqual([0x30, 0xe9, 0])
    expect(ACTIONS.find(action => action.id === 'media-volume-down')?.record).toEqual([0x30, 0xea, 0])
  })

  it('显示普通与重复次数宏触发记录', () => {
    let keymap: Uint8Array = new Uint8Array(384)
    keymap = replaceRecord(keymap, 49, [0x70, 1, 2])
    keymap = replaceRecord(keymap, 50, [0x71, 9, 21])
    expect(recordDescription(keymap, 49)).toBe('M2 · 按下停止')
    expect(recordDescription(keymap, 50)).toBe('M10 · 播放 21 次')
  })
})
