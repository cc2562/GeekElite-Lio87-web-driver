import { useState } from 'react'

import { KEY_ROWS } from '@/keymap'
import { cn } from '@/lib/utils'

import { KeyCap } from './KeyCap'
import type { KeycapState } from './keyboardHelpers'

export type SideControl = { index: number; icon: string; label: string }

export const SIDE_CONTROLS: SideControl[] = [
  { index: 83, icon: '↟', label: '滚轮上' },
  { index: 84, icon: '↡', label: '滚轮下' },
  { index: 85, icon: '◀◀', label: '上一曲' },
  { index: 87, icon: '▶▶', label: '下一曲' },
]

/**
 * 按键绑定场景下可用的侧键：滚轮（record 83/84）目前不可用，从界面隐藏，只保留侧键上一曲 / 下一曲。
 */
export const KEYMAP_SIDE_CONTROLS: SideControl[] = SIDE_CONTROLS.filter(control => control.index !== 83 && control.index !== 84)

export type KeyStateInfo = {
  label: string
  sublabel?: string
  state: KeycapState
  color?: string
  title?: string
  disabled?: boolean
}

type SkeuKeyboardProps = {
  /** 根据 record 索引与键帽原厂标签返回该键的显示信息。 */
  resolve: (index: number, defaultLabel: string) => KeyStateInfo
  /** `additive` 表示按住 Ctrl / Cmd 点击，可用于多选。 */
  onSelect: (index: number, additive: boolean) => void
  disabled?: boolean
  /** 开启后可在键盘上拖拽键帽互换绑定。 */
  enableDrag?: boolean
  onSwap?: (from: number, to: number) => void
  compact?: boolean
  className?: string
  /** 左侧独立列展示的滚轮 / 侧键；传空数组即可隐藏整列。 */
  sideControls?: SideControl[]
}

/**
 * 拟物化 87 键键盘：按真实物理布局（键宽 / 间隙）渲染键帽，左侧独立展示滚轮与侧键。
 * 支持点击选中与拖拽互换；拖拽只修改界面草稿，写入仍走「保存 → 确认 → 完整写回回读」链路。
 */
export function SkeuKeyboard({
  resolve,
  onSelect,
  disabled,
  enableDrag,
  onSwap,
  compact,
  className,
  sideControls = SIDE_CONTROLS,
}: SkeuKeyboardProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const endDrag = () => {
    setDragIndex(null)
    setOverIndex(null)
  }

  const renderKey = (index: number, defaultLabel: string, width?: number, gap?: number) => {
    const info = resolve(index, defaultLabel)
    const draggable = Boolean(enableDrag) && !disabled && !info.disabled
    return (
      <KeyCap
        key={index}
        label={info.label}
        sublabel={info.sublabel}
        width={width ?? 1}
        gap={gap}
        state={info.state}
        color={info.color}
        title={info.title}
        compact={compact}
        disabled={disabled || info.disabled}
        onClick={event => onSelect(index, event.ctrlKey || event.metaKey)}
        draggable={draggable}
        dragging={dragIndex === index}
        dropTarget={overIndex === index && dragIndex !== null && dragIndex !== index}
        onDragStart={event => {
          event.dataTransfer.effectAllowed = 'move'
          setDragIndex(index)
        }}
        onDragOver={event => {
          if (dragIndex === null) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setOverIndex(index)
        }}
        onDragLeave={() => setOverIndex(current => (current === index ? null : current))}
        onDrop={event => {
          event.preventDefault()
          if (dragIndex !== null && dragIndex !== index) onSwap?.(dragIndex, index)
          endDrag()
        }}
        onDragEnd={endDrag}
      />
    )
  }

  return (
    <div className={cn('scrollbar-thin overflow-x-auto pb-2', className)}>
      <div className={cn('flex gap-3', compact ? 'min-w-[560px]' : 'min-w-[900px]')}>
        {sideControls.length > 0 && (
          <div className="flex w-12 shrink-0 flex-col justify-center gap-1.5">
            {sideControls.map(control => {
              const info = resolve(control.index, control.label)
              const draggable = Boolean(enableDrag) && !disabled && !info.disabled
              return (
                <KeyCap
                  key={control.index}
                  label={control.icon}
                  sublabel={info.label}
                  block
                  compact={compact}
                  state={info.state}
                  title={info.title}
                  disabled={disabled || info.disabled}
                  draggable={draggable}
                  dragging={dragIndex === control.index}
                  dropTarget={overIndex === control.index && dragIndex !== null && dragIndex !== control.index}
                  onClick={event => onSelect(control.index, event.ctrlKey || event.metaKey)}
                  onDragStart={event => {
                    event.dataTransfer.effectAllowed = 'move'
                    setDragIndex(control.index)
                  }}
                  onDragOver={event => {
                    if (dragIndex === null) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setOverIndex(control.index)
                  }}
                  onDragLeave={() => setOverIndex(current => (current === control.index ? null : current))}
                  onDrop={event => {
                    event.preventDefault()
                    if (dragIndex !== null && dragIndex !== control.index) onSwap?.(dragIndex, control.index)
                    endDrag()
                  }}
                  onDragEnd={endDrag}
                />
              )
            })}
          </div>
        )}

        <div className="flex flex-1 flex-col gap-1.5">
          {KEY_ROWS.map((row, rowIndex) => (
            <div key={rowIndex} className="flex gap-1.5">
              {row.map(key => renderKey(key.index, key.label, key.width, key.gap))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
