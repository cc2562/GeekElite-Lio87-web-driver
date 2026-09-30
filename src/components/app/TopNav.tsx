import type { Ref } from 'react'
import { Database, Keyboard, Lightbulb, Plug, RefreshCw, Unplug, Zap, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type AppView = 'lighting' | 'keymap' | 'macro' | 'data'

const NAV_ITEMS: Array<{ id: AppView; label: string; icon: LucideIcon; hint: string }> = [
  { id: 'lighting', label: '灯光', icon: Lightbulb, hint: '灯效动画与逐键颜色' },
  { id: 'keymap', label: '键位', icon: Keyboard, hint: '可视化改键与宏绑定' },
  { id: 'macro', label: '宏', icon: Zap, hint: '板载宏录制与编辑' },
  { id: 'data', label: '数据', icon: Database, hint: '备份、恢复与写入预览' },
]

type TopNavProps = {
  view: AppView
  onViewChange: (view: AppView) => void
  apiReady: boolean
  hasDevice: boolean
  busy: string
  onConnect: () => void
  onReread: () => void
  onDisconnect: () => void
  /** 保存按钮插槽：由各视图把保存按钮 portal 到这里，与 header 同处一行。 */
  saveSlotRef: Ref<HTMLDivElement>
}

/** 顶部胶囊导航：品牌、视图切换、连接状态与操作，最右侧为保存按钮插槽。 */
export function TopNav({
  view,
  onViewChange,
  apiReady,
  hasDevice,
  busy,
  onConnect,
  onReread,
  onDisconnect,
  saveSlotRef,
}: TopNavProps) {
  const working = Boolean(busy)
  return (
    <header className="fixed inset-x-3 top-3 z-30 sm:inset-x-6">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 rounded-full border border-border/80 bg-card/85 px-2.5 shadow-card backdrop-blur-xl sm:gap-3 sm:px-4">
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-extrabold tracking-tight text-white shadow-md">
            L87
          </span>
          <span className="hidden font-display text-sm font-bold tracking-[0.16em] text-foreground lg:block">
            LIO87 <em className="not-italic text-primary">STUDIO</em>
          </span>
        </div>

        <nav className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-full bg-muted/70 p-1">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon
            const active = view === item.id
            return (
              <button
                key={item.id}
                type="button"
                title={item.hint}
                onClick={() => onViewChange(item.id)}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-all',
                  active
                    ? 'bg-card text-primary shadow-sm ring-1 ring-brand-200'
                    : 'text-muted-foreground hover:bg-card/70 hover:text-foreground',
                )}
              >
                <Icon className={cn('h-4 w-4', active && 'text-primary')} />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              'hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold xl:inline-flex',
              hasDevice ? 'border-success/30 bg-success/10 text-success' : 'border-border bg-muted text-muted-foreground',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', hasDevice ? 'animate-glow-pulse bg-success' : 'bg-muted-foreground/60')} />
            {hasDevice ? '设备已连接' : '等待连接'}
          </span>

          {hasDevice ? (
            <>
              <Button variant="outline" size="sm" onClick={onReread} disabled={working} className="rounded-full">
                <RefreshCw className={cn('h-3.5 w-3.5', busy === '重新读取' && 'animate-spin')} />
                <span className="hidden lg:inline">重新读取</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDisconnect}
                disabled={working}
                className="rounded-full text-muted-foreground"
              >
                <Unplug className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">断开</span>
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={onConnect} disabled={!apiReady || working} className="rounded-full">
              <Plug className="h-3.5 w-3.5" />
              {busy === '连接设备' ? '正在读取…' : '连接 Lio 87'}
            </Button>
          )}

          <div ref={saveSlotRef} className="flex items-center" />
        </div>
      </div>
    </header>
  )
}
