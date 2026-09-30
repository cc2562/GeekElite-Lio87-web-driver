import { useState } from 'react'
import { Heart } from 'lucide-react'

import { NoticeBar } from '@/components/app/NoticeBar'
import { SaveSlotProvider } from '@/components/app/SaveButton'
import { TopNav, type AppView } from '@/components/app/TopNav'
import { useLio87Session } from '@/hooks/useLio87Session'
import { DataView } from '@/views/DataView'
import { KeymapView } from '@/views/KeymapView'
import { LightingView } from '@/views/LightingView'
import { MacroView } from '@/views/MacroView'

/**
 * 应用外壳：顶部胶囊导航在「灯光 / 键位 / 宏 / 数据」四个视图之间切换，
 * 所有设备会话状态由 `useLio87Session` 统一提供，各视图按需取用。
 * 各视图把自己的保存按钮 portal 到导航栏预留的插槽里，从而与 header 同处一行。
 */
export default function App() {
  const session = useLio87Session()
  const [view, setView] = useState<AppView>('lighting')
  const [saveSlot, setSaveSlot] = useState<HTMLDivElement | null>(null)

  return (
    <SaveSlotProvider value={saveSlot}>
      <div className="relative min-h-screen bg-background">
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_82%_-8%,rgba(249,115,22,0.12),transparent_52%),radial-gradient(circle_at_4%_2%,rgba(251,146,60,0.09),transparent_46%)]"
        />

        <TopNav
          view={view}
          onViewChange={setView}
          apiReady={Boolean(session.api)}
          hasDevice={session.hasDevice}
          busy={session.busy}
          onConnect={session.connect}
          onReread={session.reread}
          onDisconnect={session.disconnect}
          saveSlotRef={setSaveSlot}
        />

        <main className="mx-auto max-w-[1440px] px-4 pb-24 pt-24 sm:px-6 lg:px-8">
          {session.notice && (
            <div className="mb-6">
              <NoticeBar notice={session.notice} />
            </div>
          )}

          {view === 'lighting' && <LightingView session={session} />}
          {view === 'keymap' && <KeymapView session={session} />}
          {view === 'macro' && <MacroView session={session} />}
          {view === 'data' && <DataView session={session} />}
        </main>

        <footer className="border-t border-border bg-card/70 py-6">
          <div className="mx-auto flex max-w-[1440px] flex-col items-center gap-3 px-4 text-center text-[11px] text-muted-foreground sm:flex-row sm:justify-between sm:gap-4 sm:px-6 sm:text-left lg:px-8">
            <span className="font-display tracking-[0.16em]">LIO87 STUDIO · 非官方社区工具</span>
            <span className="flex flex-wrap items-center justify-center gap-1.5">
              <Heart className="h-3 w-3 fill-primary text-primary" />
              <span>
                由 <strong className="font-semibold text-foreground/80">DeepSeek</strong>、
                <strong className="font-semibold text-foreground/80">ChatGPT</strong> 与
                <strong className="font-semibold text-foreground/80">CC米饭</strong> 共同制作
              </span>
            </span>
            <span>数据仅在浏览器与键盘之间传输</span>
          </div>
        </footer>
      </div>
    </SaveSlotProvider>
  )
}
