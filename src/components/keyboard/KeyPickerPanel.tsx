import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import { ACTIONS } from '@/keymap'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const GROUPS = [...new Set(ACTIONS.map(action => action.group))]

type KeyPickerPanelProps = {
  onPick: (actionId: string) => void
  currentActionId?: string
  disabled?: boolean
}

/**
 * 可视化可搜索键位面板：按动作分组网格展示，点击目标键完成绑定。
 * 与下拉菜单的区别在于所有候选键位同时可见、可直接点选，并支持关键词过滤。
 */
export function KeyPickerPanel({ onPick, currentActionId, disabled }: KeyPickerPanelProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return GROUPS.map(group => ({
      group,
      actions: ACTIONS.filter(
        action =>
          action.group === group &&
          (!keyword || action.label.toLowerCase().includes(keyword) || action.id.toLowerCase().includes(keyword)),
      ),
    })).filter(entry => entry.actions.length > 0)
  }, [query])

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索键位或动作，例如字母 A、F5、音量"
          className="pl-9"
          disabled={disabled}
        />
      </div>

      <div className="scrollbar-thin max-h-72 overflow-y-auto rounded-lg border border-border bg-muted/30">
        <div className="flex flex-col gap-4 p-3">
          {filtered.map(entry => (
            <div key={entry.group}>
              <div className="mb-2 flex items-center gap-2">
                <span className="font-display text-[10px] font-bold tracking-[0.18em] text-muted-foreground">
                  {entry.group}
                </span>
                <span className="text-[10px] text-muted-foreground/70">{entry.actions.length} 项</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {entry.actions.map(action => {
                  const active = action.id === currentActionId
                  return (
                    <button
                      key={action.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => onPick(action.id)}
                      title={`${action.label} · ${action.id}`}
                      className={cn(
                        'keycap h-9 min-w-[3.25rem] px-2 font-display text-[11px] font-semibold',
                        active && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                        disabled && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <span className="truncate">{action.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">没有匹配「{query}」的键位或动作。</p>
          )}
        </div>
      </div>
    </div>
  )
}
