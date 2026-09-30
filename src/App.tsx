import { useState } from 'react'
import { Globe, Heart } from 'lucide-react'

import { NoticeBar } from '@/components/app/NoticeBar'
import { SaveSlotProvider } from '@/components/app/SaveButton'
import { TopNav, type AppView } from '@/components/app/TopNav'
import { useLio87Session } from '@/hooks/useLio87Session'
import { DataView } from '@/views/DataView'
import { KeymapView } from '@/views/KeymapView'
import { LightingView } from '@/views/LightingView'
import { MacroView } from '@/views/MacroView'

const GITHUB_REPO = 'https://github.com/cc2562/GeekElite-Lio87-web-driver'
const AUTHOR_BLOG = 'https://world.ccrice.com'

/** 内联 GitHub 官方标记：lucide-react 自 v1 起不再提供品牌图标。 */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

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
          <div className="mx-auto flex max-w-[1440px] flex-col items-center gap-3 px-4 text-center text-[11px] text-muted-foreground sm:px-6 lg:px-8">
            <div className="flex w-full flex-col items-center gap-2 sm:flex-row sm:justify-between sm:gap-4 sm:text-left">
              <span className="font-display tracking-[0.16em]">LIO87 STUDIO · 非官方社区工具</span>
              <span>数据仅在浏览器与键盘之间传输</span>
            </div>

            <div className="flex w-full flex-col items-center gap-2 border-t border-border/70 pt-3 sm:flex-row sm:justify-center sm:gap-4">
              <span className="flex flex-wrap items-center justify-center gap-1.5">
                <Heart className="h-3 w-3 fill-primary text-primary" />
                <span>
                  由 <strong className="font-semibold text-foreground/80">DeepSeek</strong>、
                  <strong className="font-semibold text-foreground/80">ChatGPT</strong> 与
                  <strong className="font-semibold text-foreground/80">CC米饭</strong> 共同制作
                </span>
              </span>

              <span aria-hidden="true" className="hidden h-3 w-px bg-border sm:block" />

              <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
                <a
                  href={GITHUB_REPO}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 underline-offset-4 transition-colors hover:text-primary hover:underline"
                >
                  <GitHubMark className="h-3.5 w-3.5" />
                  GitHub 仓库
                </a>
                <a
                  href={AUTHOR_BLOG}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 underline-offset-4 transition-colors hover:text-primary hover:underline"
                >
                  <Globe className="h-3.5 w-3.5" />
                  CC米饭的博客
                </a>
              </span>
            </div>
          </div>
        </footer>
      </div>
    </SaveSlotProvider>
  )
}
