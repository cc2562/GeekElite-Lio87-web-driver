import { memo, type CSSProperties, type DragEvent, type MouseEvent } from 'react'

import { cn } from '@/lib/utils'

import type { KeycapState } from './keyboardHelpers'

type KeyCapProps = {
  label: string
  sublabel?: string
  width?: number
  gap?: number
  state: KeycapState
  color?: string
  title?: string
  disabled?: boolean
  /** 侧键：占满所在列，不参与横向宽度分配。 */
  block?: boolean
  compact?: boolean
  dragging?: boolean
  dropTarget?: boolean
  draggable?: boolean
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void
  onDragLeave?: (event: DragEvent<HTMLButtonElement>) => void
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void
}

/** 单个拟物键帽：立体塑料质感，按下时下沉，选中 / 已更改 / 逐键颜色各自着色。 */
export const KeyCap = memo(function KeyCap({
  label,
  sublabel,
  width = 1,
  gap,
  state,
  color,
  title,
  disabled,
  block,
  compact,
  dragging,
  dropTarget,
  draggable,
  onClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: KeyCapProps) {
  const style: CSSProperties & Record<'--key-color', string | undefined> = { '--key-color': undefined }
  if (block) {
    style.width = '100%'
  } else {
    style.flex = `${width} 0 0px`
    if (gap) style.marginLeft = `${gap * 12}px`
  }
  if (state === 'colored' && color) style['--key-color'] = color

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      draggable={draggable}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      data-state={state}
      data-dragging={dragging ? 'true' : undefined}
      data-drop-target={dropTarget ? 'true' : undefined}
      style={style}
      className={cn(
        'keycap select-none',
        block ? 'h-11' : 'h-11 min-w-0',
        compact && 'keycap-compact h-7 text-[9px]',
        compact && block && 'h-7',
        'font-display text-[11px] font-semibold leading-none',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className={cn('flex min-w-0 flex-col items-center gap-0.5 px-0.5', compact && 'gap-0')}>
        <span className="w-full truncate text-center">{label}</span>
        {sublabel && (
          <span className="max-w-full truncate text-[8px] font-medium opacity-70">{sublabel}</span>
        )}
      </span>
    </button>
  )
})
