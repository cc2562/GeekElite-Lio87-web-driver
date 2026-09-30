import type { ReactNode } from 'react'
import { Zap } from 'lucide-react'

import { KEY_ROWS } from '@/keymap'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'

import { KEYMAP_SIDE_CONTROLS, SkeuKeyboard, type KeyStateInfo } from './SkeuKeyboard'
import { actionIdForLabel, SIDE_ACTION_IDS } from './keyboardHelpers'

type KeyPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 点击拟物小键盘上的目标键完成绑定。 */
  onPick: (actionId: string) => void
  targetLabel?: string
  currentActionLabel?: string
  disabled?: boolean
  /** 弹窗下半部分的板载宏绑定表单（与键位编辑器共用同一份状态）。 */
  macroBinding?: ReactNode
}

/**
 * 拟物小键盘选择器：以真实键帽布局呈现整块键盘，点击任意键帽即把该键的默认动作绑定到目标 record。
 * 弹窗同时内嵌板载宏绑定表单，选中键位后可直接在这里完成「改键」或「绑宏」。
 */
export function KeyPickerDialog({
  open,
  onOpenChange,
  onPick,
  targetLabel,
  currentActionLabel,
  disabled,
  macroBinding,
}: KeyPickerDialogProps) {
  const resolve = (index: number, defaultLabel: string): KeyStateInfo => {
    const sideAction = SIDE_ACTION_IDS[index]
    const mapped = sideAction ?? actionIdForLabel(defaultLabel)
    return {
      label: defaultLabel,
      state: 'default',
      disabled: disabled || !mapped,
      title: mapped ? `绑定为 ${mapped}` : `${defaultLabel} 暂不支持绑定`,
    }
  }

  const pick = (index: number, _additive: boolean) => {
    const sideAction = SIDE_ACTION_IDS[index]
    if (sideAction) {
      onPick(sideAction)
      onOpenChange(false)
      return
    }
    const spec = KEY_ROWS.flat().find(key => key.index === index)
    const actionId = spec ? actionIdForLabel(spec.label) : undefined
    if (!actionId) return
    onPick(actionId)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>点击拟物键盘选择目标键位</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              正在为
              <Badge variant="outline" className="font-mono text-[11px]">{targetLabel ?? '未选择'}</Badge>
              设置动作
              {currentActionLabel && (
                <>
                  · 当前为
                  <Badge variant="secondary" className="text-[11px]">{currentActionLabel}</Badge>
                </>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border bg-gradient-to-b from-muted/60 to-card p-3">
          <SkeuKeyboard resolve={resolve} onSelect={pick} disabled={disabled} compact sideControls={KEYMAP_SIDE_CONTROLS} />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          点击任意键帽即可绑定并关闭弹窗；左右修饰键统一绑定左侧版本。
        </p>

        {macroBinding && (
          <>
            <Separator />
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">绑定板载宏</span>
                <span className="text-xs text-muted-foreground">不动键盘，直接把 M1–M10 的宏绑到当前键位</span>
              </div>
              {macroBinding}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
