import { AlertTriangle, Download, FileText, HardDrive, Play, Radio, Square, Trash2, Upload, Zap } from 'lucide-react'

import { PageHeader } from '@/components/app/PageHeader'
import { SaveButton, SaveSlotOutlet, type PendingChange } from '@/components/app/SaveButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Lio87Session } from '@/hooks/useLio87Session'
import { MACRO_ACTION_LIMIT, MACRO_COUNT, usageLabel } from '@/macro'
import { cn } from '@/lib/utils'

export function MacroView({ session }: { session: Lio87Session }) {
  const {
    hasDevice, busy, macroStorage, macroError, macroDiagnostic, macroBackup, macroRestore, setMacroRestore,
    selectedMacro, selectMacroSlot, selectedMacroEntry, selectedMacroActions, selectedMacroDirty, selectedSlotEditable,
    macroRaw, macroSlotDirty,
    recording, keyCounts, keyLog, keyTrace, imeComposing, tapFallback,
    startMacroRecording, stopMacroRecording, updateMacroDelay, clearMacro, saveSelectedMacro,
    restoreFromMacroBytes, loadFirstMacroBackup, importMacroFile,
    downloadCurrentMacros, downloadMacroDiagnostic, downloadFirstMacroBackup, macroFileInput,
  } = session

  const working = Boolean(busy)
  const writeBusy = busy === '写入宏'

  const changes: PendingChange[] = macroRestore
    ? [{ label: '恢复宏备份', detail: `${macroRestore.bytes.length} 字节` }]
    : selectedMacroActions.map((action, index) => ({
        label: `M${selectedMacro + 1} · ${String(index + 1).padStart(2, '0')} ${action.pressed ? '按下' : '抬起'} ${usageLabel(action.usage)}`,
        detail: `${action.delayMs} ms`,
      }))

  const canWrite = macroRestore
    ? hasDevice && Boolean(macroBackup)
    : Boolean(macroStorage) && selectedMacroDirty && !recording && Boolean(macroBackup)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="03 / ONBOARD MACRO"
        title="把一串动作，"
        highlight="交给一个键。"
        description="实时录制普通键盘事件，保存到 M1–M10，再从「键位」页面把宏绑定到任意按键。"
      >
        <Badge variant={recording ? 'destructive' : 'muted'}>
          {recording ? `正在录制 M${selectedMacro + 1}` : '未在录制'}
        </Badge>
        <Badge variant={macroStorage ? 'success' : 'warning'}>
          {macroStorage ? `${macroStorage.entryCount} 个宏槽位` : macroError ? '读取失败' : '未读取'}
        </Badge>
      </PageHeader>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-primary" />
              板载宏存储
            </CardTitle>
            <CardDescription className="mt-1.5">
              {macroStorage
                ? `已读取 ${macroStorage.entryCount} 个宏槽位`
                : macroError
                  ? '读取失败，可重新连接设备后再试'
                  : '连接设备后自动读取宏数据'}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadCurrentMacros} disabled={!macroRaw || working}>
              <Download className="h-3.5 w-3.5" />
              {macroError ? '导出原始数据' : '导出当前宏'}
            </Button>
            <Button variant="outline" size="sm" onClick={downloadMacroDiagnostic} disabled={!macroDiagnostic || working}>
              <FileText className="h-3.5 w-3.5" />
              诊断报告
            </Button>
            <Button variant="outline" size="sm" onClick={downloadFirstMacroBackup} disabled={!macroBackup || working}>
              <Download className="h-3.5 w-3.5" />
              首次备份
            </Button>
            <Button variant="outline" size="sm" onClick={loadFirstMacroBackup} disabled={!macroBackup || working}>
              载入首次备份
            </Button>
            <Button variant="outline" size="sm" onClick={() => macroFileInput.current?.click()} disabled={!hasDevice || working}>
              <Upload className="h-3.5 w-3.5" />
              导入 .bin
            </Button>
            <input
              ref={macroFileInput}
              type="file"
              accept=".bin,application/octet-stream"
              hidden
              onChange={event => {
                const file = event.target.files?.[0]
                if (file) void importMacroFile(file)
              }}
            />
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {macroRestore && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-accent px-4 py-3">
              <span className="text-sm text-accent-foreground">
                {macroRestore.title} · {macroRestore.bytes.length} 字节
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setMacroRestore(null)} disabled={working}>
                  取消
                </Button>
                <Button size="sm" onClick={() => restoreFromMacroBytes(macroRestore.bytes)} disabled={working || !macroBackup}>
                  完整写回备份
                </Button>
              </div>
            </div>
          )}

          {macroStorage ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {Array.from({ length: MACRO_COUNT }, (_, index) => {
                  const entry = macroStorage.entries[index] ?? null
                  const active = selectedMacro === index
                  const dirty = macroSlotDirty(index)
                  const count = active ? selectedMacroActions.length : entry?.actions.length ?? 0
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => selectMacroSlot(index)}
                      disabled={working || Boolean(macroRestore)}
                      className={cn(
                        'flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-all',
                        active
                          ? 'border-primary bg-accent shadow-sm ring-1 ring-primary/30'
                          : 'border-border bg-card hover:border-brand-300',
                        dirty && !active && 'border-warning/60',
                        !entry && 'border-dashed',
                        (working || macroRestore) && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <strong className="font-display text-sm">M{index + 1}</strong>
                      <span className="text-[10px] text-muted-foreground">
                        {count} / {MACRO_ACTION_LIMIT}
                      </span>
                      <small className="text-[10px] text-muted-foreground">
                        {entry ? (entry.editable ? (count ? '键盘事件' : '空宏') : '含未知内容') : '新槽位'}
                      </small>
                    </button>
                  )
                })}
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-display text-lg font-bold text-primary">M{selectedMacro + 1}</span>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold">{selectedMacroActions.length} 个动作</span>
                      <span className="text-[11px] text-muted-foreground">
                        {!selectedMacroEntry
                          ? selectedMacroDirty
                            ? '新槽位 · 有未保存更改'
                            : '新槽位 · 保存后才会写入键盘'
                          : selectedMacroEntry.editable
                            ? selectedMacroDirty
                              ? '有未保存更改'
                              : '与设备一致'
                            : '含有无法识别的内容，仅可查看'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recording ? (
                      <Button variant="destructive" size="sm" onClick={stopMacroRecording}>
                        <Square className="h-3.5 w-3.5" />
                        停止录制
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={startMacroRecording}
                        disabled={!selectedSlotEditable || working || Boolean(macroRestore)}
                      >
                        <Play className="h-3.5 w-3.5" />
                        开始录制
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearMacro}
                      disabled={!selectedSlotEditable || working || Boolean(macroRestore)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      清空
                    </Button>
                  </div>
                </div>

                {recording && (
                  <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
                    <span className="flex items-center gap-2 font-semibold">
                      <Radio className="h-3.5 w-3.5 animate-pulse" />
                      正在录制 M{selectedMacro + 1}：先点一下页面，再直接按下需要记录的普通键。修饰键、媒体键和鼠标事件不会录入。
                    </span>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
                      <span>
                        按下 {keyCounts.current.downs} · 抬起 {keyCounts.current.ups} · 记录 {keyCounts.current.recorded} ·
                        忽略 {keyCounts.current.ignored}
                      </span>
                      <code className="rounded bg-white/70 px-2 py-0.5 text-[11px]">
                        {keyTrace || '尚未收到键盘事件'}
                      </code>
                    </div>
                    {keyLog.length > 1 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer font-semibold">最近 {keyLog.length} 个键盘事件</summary>
                        <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white/70 p-2 font-mono text-[10px] leading-relaxed">
                          {keyLog.join('\n')}
                        </pre>
                      </details>
                    )}
                    {tapFallback && (
                      <p className="mt-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 leading-relaxed">
                        字母键的“按下”没有被识别到（通常是输入法拦截）。已自动按一次敲击补录；
                        若要保留真实按住时长，请切到英文输入法后重新录制。
                      </p>
                    )}
                    {imeComposing && (
                      <p className="mt-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 leading-relaxed">
                        检测到输入法正在组合输入：字母键会被输入法截走。请切到英文输入后重新录制。
                      </p>
                    )}
                  </div>
                )}

                <div className="scrollbar-thin max-h-96 overflow-y-auto">
                  {selectedMacroActions.length ? (
                    <ul className="divide-y divide-border">
                      {selectedMacroActions.map((action, index) => (
                        <li
                          key={`${index}-${action.usage}-${action.pressed}`}
                          className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs"
                        >
                          <span className="w-6 font-mono text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                          <Badge variant={action.pressed ? 'success' : 'warning'} className="w-10 justify-center">
                            {action.pressed ? '按下' : '抬起'}
                          </Badge>
                          <span className="min-w-[7rem] flex-1 font-semibold">{usageLabel(action.usage)}</span>
                          <label className="flex items-center gap-2 text-muted-foreground">
                            延时
                            <Input
                              type="number"
                              min={action.pressed ? 1 : 0}
                              max={65535}
                              value={action.delayMs}
                              disabled={!selectedSlotEditable || Boolean(macroRestore)}
                              onChange={event =>
                                updateMacroDelay(
                                  index,
                                  Math.min(65535, Math.max(action.pressed ? 1 : 0, Number(event.target.value))),
                                )
                              }
                              className="h-8 w-24"
                            />
                            ms
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      这个槽位还没有动作。点击「开始录制」，按下并松开几个键试试。
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <span className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-warning" />
                {macroError ? '宏数据读取失败，暂时无法编辑。' : '尚未读取宏数据。'}
              </span>
              {macroDiagnostic && (
                <details className="mx-auto w-full max-w-3xl text-left">
                  <summary className="cursor-pointer text-xs font-semibold text-primary">查看诊断报告</summary>
                  <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
                    {macroDiagnostic}
                  </pre>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            录制提示
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>每个槽位最多 {MACRO_ACTION_LIMIT} 条动作。</p>
          <p>保存到键盘后，才能在「键位」页面把该宏绑定到按键并设置触发方式。</p>
        </CardContent>
      </Card>

      <SaveSlotOutlet>
        <SaveButton
          changes={changes}
          onConfirm={() => {
            if (macroRestore) restoreFromMacroBytes(macroRestore.bytes)
            else saveSelectedMacro()
          }}
          disabled={!canWrite}
          busy={writeBusy}
          label="保存宏"
          dialogHint={
            macroRestore
              ? '确认后会把这份宏备份写入键盘。'
              : `确认后会把 M${selectedMacro + 1} 的 ${selectedMacroActions.length} 条动作写入键盘。`
          }
          confirmLabel="写入并校验"
          emptyHint="先录制或修改宏动作后再保存"
        />
      </SaveSlotOutlet>
    </div>
  )
}
