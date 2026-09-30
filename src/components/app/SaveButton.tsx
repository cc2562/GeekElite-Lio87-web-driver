import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Save, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type PendingChange = { label: string; detail?: string }

const SaveSlotContext = createContext<HTMLElement | null>(null)

/** 顶部胶囊导航里为保存按钮预留的插槽节点。 */
export const SaveSlotProvider = SaveSlotContext.Provider

/**
 * 把保存按钮渲染到顶部导航预留的插槽中，使保存按钮与 header 处于同一行。
 * 各视图在自己这一层计算待修改内容，因此按钮拿到的永远是最新状态。
 */
export function SaveSlotOutlet({ children }: { children: ReactNode }) {
  const slot = useContext(SaveSlotContext)
  if (!slot) return null
  return createPortal(children, slot)
}

type SaveButtonProps = {
  changes: PendingChange[]
  onConfirm: () => void
  disabled?: boolean
  busy?: boolean
  label?: string
  dialogTitle?: string
  dialogHint?: string
  confirmLabel?: string
  emptyHint?: string
}

/**
 * 保存按钮：点击后弹出确认弹窗，逐条列出本次将要修改的内容，确认后才执行写入。
 */
export function SaveButton({
  changes,
  onConfirm,
  disabled,
  busy,
  label = '保存到键盘',
  dialogTitle = '确认要修改的内容',
  dialogHint,
  confirmLabel = '确认写入',
  emptyHint = '当前没有待保存的修改',
}: SaveButtonProps) {
  const [open, setOpen] = useState(false)
  const hasChanges = changes.length > 0
  const blocked = Boolean(disabled) || Boolean(busy) || !hasChanges

  return (
    <>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                onClick={() => setOpen(true)}
                disabled={blocked}
                aria-label={label}
                className={cn('h-9 rounded-full pl-3.5 pr-4', hasChanges && !blocked && 'shadow-float')}
              >
                <Save className="h-4 w-4" />
                <span className="hidden sm:inline">{busy ? '正在写入…' : label}</span>
                {hasChanges && (
                  <span className="ml-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-white/25 px-1 text-xs font-bold">
                    {changes.length}
                  </span>
                )}
              </Button>
            </span>
          </TooltipTrigger>
          {!hasChanges && <TooltipContent side="bottom">{emptyHint}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-primary">
                <ShieldCheck className="h-4 w-4" />
              </span>
              {dialogTitle}
            </DialogTitle>
            <DialogDescription>
              {dialogHint ?? `本次将向键盘写入 ${changes.length} 项修改，确认后执行完整写入并回读校验。`}
            </DialogDescription>
          </DialogHeader>

          <div className="scrollbar-thin max-h-72 overflow-y-auto rounded-lg border border-border bg-muted/40">
            <ul className="divide-y divide-border">
              {changes.map((change, index) => (
                <li key={`${change.label}-${index}`} className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
                  <span className="font-medium text-foreground">{change.label}</span>
                  {change.detail && (
                    <code className="shrink-0 font-mono text-xs text-primary">{change.detail}</code>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
            >
              <CheckCircle2 className="h-4 w-4" />
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
